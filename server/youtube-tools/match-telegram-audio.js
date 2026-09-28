// Read-only reconciliation for a messy, flat folder of downloaded audio files (unlike the tidy
// Songs/<Singer>/ shape upload-audio-videos.js expects). Filenames here are inconsistent -
// transliterated singer names, junk tokens (quality markers, channel tags, "New"/"Official"/
// "Lyrics"/year numbers), some files with no identifying info at all ("Track01.mp3"). This
// proposes best-guess matches against the DB for human review - it does NOT touch anything.
//
// Usage: node match-telegram-audio.js "<folder>"
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');
const { matchFile } = require('./lib/matchAudio');

const DIR = process.argv[2];
if (!DIR) { console.error('Usage: node match-telegram-audio.js "<folder>"'); process.exit(1); }

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.opus', '.wav', '.aac']);
const db = postgres(process.env.DATABASE_URL, { ssl: 'require' });

async function main() {
  const entries = fs.readdirSync(DIR, { withFileTypes: true });
  const files = entries.filter(e => e.isFile() && AUDIO_EXT.has(path.extname(e.name).toLowerCase()));
  console.log(`${files.length} audio candidate(s) in ${DIR}\n`);

  const singers = await db`SELECT id, name FROM singers`;
  const songs = await db`SELECT s.id, s.title, s.singer_id, s.youtube_video_id, sg.name AS singer FROM songs s JOIN singers sg ON sg.id = s.singer_id`;

  for (const f of files) {
    const base = f.name.replace(path.extname(f.name), '');
    const matches = matchFile(base, singers, songs);

    console.log('='.repeat(90));
    console.log(`File: ${f.name}`);

    if (!matches.length) {
      console.log('  NO SINGER MATCH - needs manual review');
      continue;
    }

    for (const { singer, scoredSongs } of matches) {
      const best = scoredSongs[0];
      console.log(`  Singer match: "${singer.name}" (${scoredSongs.length} song(s) in catalog)`);
      if (best && best.score >= 0.75) {
        console.log(`    BEST TITLE GUESS (${(best.score * 100).toFixed(0)}%): "${best.title}" ${best.youtube_video_id ? '[already has a video - would be skipped]' : '[no video yet]'}`);
      } else {
        console.log('    No confident title match - top candidates:');
        scoredSongs.slice(0, 3).forEach(s => console.log(`      ${(s.score * 100).toFixed(0)}%: "${s.title}" ${s.youtube_video_id ? '(has video)' : '(no video)'}`));
      }
    }
  }

  await db.end();
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
