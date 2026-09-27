// Bulk driver: for a folder shaped like Songs/<Singer>/<audio file>, matches each audio file to
// an existing song (by singer folder name + filename-as-title), generates an audio-only video
// (see lib/generateVideo.js) and uploads it to YouTube as unlisted, then saves the resulting
// video id onto the song (same youtube_video_id column the web/mobile apps already read).
//
// Only fills in songs that don't already have a youtube_video_id - safe to re-run, already-done
// songs are skipped automatically.
//
// YouTube's Data API default quota is 10,000 units/day and an upload costs 1,600 units, so only
// ~6 uploads/day are possible without requesting a quota increase from Google. --limit defaults
// to 6 for that reason - raise it only if you know your quota is higher.
//
// Usage:
//   node upload-audio-videos.js "<path to Songs folder>" --dry-run   (preview matches, no video/upload)
//   node upload-audio-videos.js "<path to Songs folder>" --limit=6   (actually run, capped)
const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const postgres = require('postgres');
const { generateAudioVideo } = require('./lib/generateVideo');
const { uploadVideo } = require('./lib/youtubeClient');

const ROOT = process.argv[2];
const DRY_RUN = process.argv.includes('--dry-run');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : 6;

if (!ROOT) {
  console.error('Usage: node upload-audio-videos.js "<path to Songs folder>" [--dry-run] [--limit=N]');
  process.exit(1);
}

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.flac']);
const db = postgres(process.env.DATABASE_URL, { ssl: 'require' });

function findAudioFiles(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      const singer = ent.name;
      for (const fileEnt of fs.readdirSync(path.join(dir, ent.name), { withFileTypes: true })) {
        if (fileEnt.isFile() && AUDIO_EXTENSIONS.has(path.extname(fileEnt.name).toLowerCase())) {
          out.push({ singer, filename: fileEnt.name, full: path.join(dir, ent.name, fileEnt.name) });
        }
      }
    }
  }
  return out;
}

function titleFromFilename(filename) {
  return filename.replace(path.extname(filename), '').replace(/^\d+\s+/, '').trim();
}

async function main() {
  const files = findAudioFiles(ROOT);
  console.log(`Found ${files.length} audio files under ${ROOT}.\n`);

  let uploaded = 0, skippedHasVideo = 0, unmatched = 0, singerNotFound = 0;

  for (const f of files) {
    if (uploaded >= LIMIT) {
      console.log(`\nReached --limit=${LIMIT}, stopping (quota safety). Re-run later to continue with the rest.`);
      break;
    }

    const singerRows = await db`SELECT id, name FROM singers WHERE lower(name) = lower(${f.singer})`;
    if (!singerRows.length) {
      console.log(`SKIP (no singer "${f.singer}" in DB): ${f.singer}/${f.filename}`);
      singerNotFound++;
      continue;
    }
    const singerId = singerRows[0].id;
    const title = titleFromFilename(f.filename);

    const songRows = await db`SELECT id, title, youtube_video_id FROM songs WHERE singer_id = ${singerId} AND lower(title) = lower(${title})`;
    if (!songRows.length) {
      console.log(`UNMATCHED (no song "${title}" under ${f.singer}): ${f.singer}/${f.filename}`);
      unmatched++;
      continue;
    }
    const song = songRows[0];
    if (song.youtube_video_id) {
      console.log(`SKIP (already has a video): [${f.singer}] "${song.title}"`);
      skippedHasVideo++;
      continue;
    }

    console.log(`${DRY_RUN ? 'WOULD PROCESS' : 'Processing'}: [${f.singer}] "${song.title}" <- ${f.filename}`);
    if (DRY_RUN) { uploaded++; continue; }

    const tmpVideoPath = path.join(os.tmpdir(), `mezmurify-${song.id.replace(/[^a-z0-9]/gi, '-')}.mp4`);
    try {
      await generateAudioVideo({ title: song.title, singer: f.singer, audioPath: f.full, outputPath: tmpVideoPath });
      const videoId = await uploadVideo({
        videoPath: tmpVideoPath,
        title: `${song.title} - ${f.singer}`,
        description: `${song.title}\n${f.singer}\n\nUploaded automatically from Mezmurify's catalog (audio-only).`,
      });
      await db`UPDATE songs SET youtube_video_id = ${videoId} WHERE id = ${song.id}`;
      console.log(`  -> uploaded as https://www.youtube.com/watch?v=${videoId}`);
      uploaded++;
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
    } finally {
      fs.rmSync(tmpVideoPath, { force: true });
      fs.rmSync(tmpVideoPath.replace(/\.mp4$/, '.png'), { force: true });
    }
  }

  console.log(`\nDone: ${uploaded} ${DRY_RUN ? 'would be processed' : 'uploaded'}, ${skippedHasVideo} already had a video, ${unmatched} unmatched, ${singerNotFound} unknown singer.`);
  await db.end();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
