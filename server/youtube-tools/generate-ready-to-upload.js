// Generates audio-only videos for manual upload (bypasses the YouTube Data API's upload quota
// entirely, since you upload these yourself through youtube.com/YouTube Studio). Does NOT call
// the YouTube API and does NOT touch the database - purely local file generation.
//
// Only processes files matchFile() could at least guess a singer for (title is best-effort and
// may be wrong/unconfirmed - verify by ear before uploading, then link the real song afterward
// using the app's "paste a YouTube link" feature).
//
// Usage: node generate-ready-to-upload.js "<source audio folder>" "<output folder>"
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const os = require('os');
const path = require('path');
const postgres = require('postgres');
const { matchFile } = require('./lib/matchAudio');
const { generateAudioVideo } = require('./lib/generateVideo');

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
  console.error('Usage: node generate-ready-to-upload.js "<source audio folder>" "<output folder>"');
  process.exit(1);
}

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.opus', '.wav', '.aac']);
const db = postgres(process.env.DATABASE_URL, { ssl: 'require' });

// ffmpeg writes its output by seeking back partway through to finalize the mp4 header - Google
// Drive's virtual/streaming filesystem (a mapped drive like I:\) doesn't support that well, and
// every attempt to write ffmpeg output directly there failed (or hung for many minutes before
// failing) with a garbled "Failed to reallocate parser buffer" error, even though the exact same
// source files encode instantly to a local path. So: always generate to a local temp folder,
// then copy the finished file over to OUT (wherever that is, Drive or not) once ffmpeg is done
// writing/seeking on a real local disk.
const STAGING_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mezmurify-video-'));

function sanitizeFilename(str) {
  return str.replace(/[<>:"/\\|?*#]/g, '').replace(/\s+/g, ' ').trim();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const entries = fs.readdirSync(SRC, { withFileTypes: true });
  const files = entries.filter(e => e.isFile() && AUDIO_EXT.has(path.extname(e.name).toLowerCase()));
  console.log(`${files.length} audio candidate(s) in ${SRC}\n`);

  const singers = await db`SELECT id, name FROM singers`;
  const songs = await db`SELECT s.id, s.title, s.singer_id, s.youtube_video_id, sg.name AS singer FROM songs s JOIN singers sg ON sg.id = s.singer_id`;
  await db.end();

  const reportRows = ['output_file\tsinger\tbest_guess_title\tconfidence_pct\ttarget_already_has_video\tsource_file'];
  let generated = 0, skippedNoSinger = 0, failed = 0;

  for (const f of files) {
    const base = f.name.replace(path.extname(f.name), '');
    const matches = matchFile(base, singers, songs);

    if (!matches.length) {
      console.log(`SKIP (no singer match): ${f.name}`);
      skippedNoSinger++;
      continue;
    }

    // Only the top singer guess (matchFile already ranks/limits fuzzy fallback to 1; an exact
    // match can return several - just take the first, they're all equally exact).
    const { singer, scoredSongs } = matches[0];
    const best = scoredSongs[0];
    const cardTitle = best ? best.title : base;

    const outName = sanitizeFilename(`${singer.name} - ${base}`) + '.mp4';
    const stagedPath = path.join(STAGING_DIR, outName);
    const finalPath = path.join(OUT, outName);

    console.log(`Generating: [${singer.name}] "${cardTitle}" (${best ? (best.score * 100).toFixed(0) : 0}% guess) <- ${f.name}`);
    try {
      await generateAudioVideo({ title: cardTitle, singer: singer.name, audioPath: path.join(SRC, f.name), outputPath: stagedPath });
      fs.copyFileSync(stagedPath, finalPath);
      fs.rmSync(stagedPath, { force: true });
      fs.rmSync(stagedPath.replace(/\.mp4$/, '.png'), { force: true });
      generated++;
      reportRows.push([
        outName, singer.name, cardTitle,
        best ? (best.score * 100).toFixed(0) : '0',
        best && best.youtube_video_id ? 'yes' : 'no',
        f.name,
      ].join('\t'));
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      failed++;
    }
  }

  const reportPath = path.join(OUT, '_report.tsv');
  fs.writeFileSync(reportPath, reportRows.join('\n'));
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });

  console.log(`\nDone: ${generated} generated, ${skippedNoSinger} skipped (no singer match), ${failed} failed.`);
  console.log(`Report: ${reportPath}`);
  console.log(`Videos in: ${OUT}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
