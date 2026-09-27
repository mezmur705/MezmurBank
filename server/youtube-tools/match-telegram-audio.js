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

const DIR = process.argv[2];
if (!DIR) { console.error('Usage: node match-telegram-audio.js "<folder>"'); process.exit(1); }

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.opus', '.wav', '.aac']);
const db = postgres(process.env.DATABASE_URL, { ssl: 'require' });

// Tokens that appear in downloaded-audio filenames but carry no identifying info.
const JUNK_WORDS = new Set([
  'new', 'official', 'lyrics', 'video', 'amharic', 'ethiopian', 'gospel', 'song', 'mezmur',
  'protestant', 'with', 'of', 'ft', 'the', 'harvest', 'is', 'plentiful', 'old', 'volume', 'vol',
  'track', 'mp3', 'mstudioconvert', 'hd', 'mez',
]);

function tokenize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/@\S+/g, ' ') // @channel_name tags
    .replace(/#\d+/g, ' ')
    .replace(/\d{3,4}p\b/g, ' ') // 360p, 144p, 128k-style quality markers
    .replace(/\d{2,4}k\b/g, ' ')
    .replace(/20\d{2}/g, ' ') // bare years
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .filter(w => !JUNK_WORDS.has(w))
    .filter(w => !/^\d+$/.test(w))
    .filter(w => /[ሀ-፿]/.test(w) || w.length > 2); // keep any Amharic token; Latin tokens need length > 2
}

// DB titles are "Amharic script (Latin transliteration)" - filenames are hand-typed Latin
// transliterations with no standard spelling, so plain token overlap misses most real matches.
// Pull just the transliteration out of a title (falls back to the whole title if there's no
// parenthetical) and compare it to the filename with a normalized-edit-distance similarity,
// which tolerates the inevitable spelling drift ("Tasblgnaleh" vs "Tasebignaleh"-ish).
function transliteration(title) {
  const m = title.match(/\(([^)]+)\)/);
  return (m ? m[1] : title).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function similarity(a, b) {
  if (!a.length && !b.length) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

// Best-effort "does `needle` appear approximately inside `haystack`", since the filename
// usually still has the singer name/track number/quality tag surrounding the actual title.
// Slides a needle-length(+/-2) window across the haystack and keeps the best similarity found.
function bestSubstringSimilarity(haystack, needle) {
  if (!needle.length) return 0;
  if (!haystack.length) return 0;
  let best = 0;
  for (let len = Math.max(1, needle.length - 2); len <= needle.length + 2; len++) {
    for (let start = 0; start <= haystack.length - len; start++) {
      const sim = similarity(haystack.slice(start, start + len), needle);
      if (sim > best) best = sim;
    }
  }
  return best;
}

async function main() {
  const entries = fs.readdirSync(DIR, { withFileTypes: true });
  const files = entries.filter(e => e.isFile() && AUDIO_EXT.has(path.extname(e.name).toLowerCase()));
  console.log(`${files.length} audio candidate(s) in ${DIR}\n`);

  const singers = await db`SELECT id, name FROM singers`;
  const songs = await db`SELECT s.id, s.title, s.singer_id, s.youtube_video_id, sg.name AS singer FROM songs s JOIN singers sg ON sg.id = s.singer_id`;

  for (const f of files) {
    const base = f.name.replace(path.extname(f.name), '');
    const fileTokens = tokenize(base);

    const rawFilenameForSinger = base.toLowerCase().replace(/[^a-z0-9]+/g, '');

    // Singer guess: prefer an exact token match (all of the singer's name tokens present
    // somewhere in the filename, order-independent) - cheap and precise. Fall back to fuzzy
    // substring similarity on the singer's full name, to tolerate spelling drift like
    // "Getenet" vs the DB's "Getnet".
    const exactSingerMatches = singers.filter(s => {
      const nameTokens = tokenize(s.name);
      if (!nameTokens.length) return false;
      return nameTokens.every(t => fileTokens.includes(t));
    });
    const singerMatches = exactSingerMatches.length ? exactSingerMatches : singers
      .map(s => ({ ...s, _sim: bestSubstringSimilarity(rawFilenameForSinger, s.name.toLowerCase().replace(/[^a-z0-9]+/g, '')) }))
      .filter(s => s._sim >= 0.8)
      .sort((a, b) => b._sim - a._sim)
      .slice(0, 1);

    console.log('='.repeat(90));
    console.log(`File: ${f.name}`);

    if (!singerMatches.length) {
      console.log('  NO SINGER MATCH - needs manual review');
      continue;
    }

    const rawFilename = base.toLowerCase().replace(/[^a-z0-9]+/g, '');

    for (const singer of singerMatches) {
      const candidateSongs = songs.filter(s => s.singer_id === singer.id);
      const scored = candidateSongs
        .map(s => ({ ...s, score: bestSubstringSimilarity(rawFilename, transliteration(s.title)) }))
        .sort((a, b) => b.score - a.score);

      const best = scored[0];
      console.log(`  Singer match: "${singer.name}" (${candidateSongs.length} song(s) in catalog)`);
      if (best && best.score >= 0.75) {
        console.log(`    BEST TITLE GUESS (${(best.score * 100).toFixed(0)}%): "${best.title}" ${best.youtube_video_id ? '[already has a video - would be skipped]' : '[no video yet]'}`);
      } else {
        console.log('    No confident title match - top candidates:');
        scored.slice(0, 3).forEach(s => console.log(`      ${(s.score * 100).toFixed(0)}%: "${s.title}" ${s.youtube_video_id ? '(has video)' : '(no video)'}`));
      }
    }
  }

  await db.end();
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
