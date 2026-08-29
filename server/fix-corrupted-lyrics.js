// One-off: cleans up import-era corruption found in a handful of songs' lyrics -
// stray leftover <poem>/<u> tag fragments, mangled repeat-count markers (<3, <2>, etc.),
// and (for 9 songs) an entire wiki-template metadata block (artist/album/track/etc.)
// that got imported as if it were part of the lyrics, at the start, end, or spliced
// into the middle of the real lyrics.
//
// Regenerates open_song_format from the cleaned lyrics afterward so they stay in sync.
//
// Usage:
//   node fix-corrupted-lyrics.js --dry-run   (prints before/after, changes nothing)
//   node fix-corrupted-lyrics.js             (applies the fixes)

require('dotenv').config();
const postgres = require('postgres');
const { buildLyricsAndFormat } = require('./lib/lyricsFormat');

const db = postgres(process.env.DATABASE_URL, { ssl: 'require' });
const DRY_RUN = process.argv.includes('--dry-run');

// Each fix receives the song's current raw lyrics and returns the cleaned lyrics.
const FIXES = {
  // --- stray leftover tag fragments / mangled repeat markers ---
  1086: lyrics => lyrics.replace('<poem>\n', ''),
  2415: lyrics => lyrics.replace('<poem>\n', '').replace(/\n<\/poem$/, ''),
  2660: lyrics => lyrics.replace('<poem>\n', ''),
  2912: lyrics => lyrics.replace(/^poem>\n+/, '').replace(/\n+\/poem>$/, ''),
  1651: lyrics => lyrics.replace('u>ታማኝ', 'ታማኝ'),
  3276: lyrics => lyrics.split('ንገስ</u > (3x)').join('ንገስ (3x)'),
  1675: lyrics => lyrics.split('<u> </u> ').join(''),
  1187: lyrics => lyrics.replace('ለካ< (2x)', 'ለካ (2x)'),
  2927: lyrics => lyrics.replace(/ማች<(\s*\n)/, 'ማች$1'),
  3493: lyrics => lyrics.replace('ማች > ', 'ማች '),
  3089: lyrics => lyrics.split('ቤትህ<3').join('ቤትህ'),
  3941: lyrics => lyrics.split('ዋጀ <3').join('ዋጀ'),
  4073: lyrics => lyrics.replace('የሚያይ<2>', 'የሚያይ'),
  3539: lyrics => lyrics.split('…>').join('…').split('...>').join('...'),

  // --- leaked wiki-template metadata blocks (artist/album/track/etc.) ---
  2924: lyrics => lyrics.slice(lyrics.indexOf('ኧረ ምን ይባል')),
  2029: lyrics => lyrics.slice(lyrics.indexOf('|Lyrics=') + '|Lyrics='.length),
  3404: lyrics => lyrics.slice(lyrics.indexOf('የመሞቴን ዜና ሊሰማ')),
  2254: lyrics =>
    lyrics.slice(lyrics.indexOf('አንተን ሳላይህ'), lyrics.indexOf('|ዘማሪ=አቤኔዘር')).trim(),
  1326: lyrics => lyrics.slice(lyrics.indexOf('እመሰክራለሁ ጌታ ማዳንህን')),
  1744: lyrics => lyrics.slice(lyrics.indexOf('የመጎብኛዬ ወራት ሲመጣ')),
  1918: lyrics => {
    const start = lyrics.indexOf('በድል ላይ ድልን ይዞ አሸንፎ የወጣ');
    const end = lyrics.indexOf('/ የውዳሴ መዝሙር /');
    return lyrics.slice(start, end === -1 ? undefined : end).trim();
  },
  3201: lyrics => lyrics.slice(lyrics.indexOf('ድንጋይየነበረ')),
  2805: lyrics => lyrics.slice(lyrics.indexOf('ኢየሱስ አለቴ ነህ ተደግፌሃለሁ')),
};

async function main() {
  const ids = Object.keys(FIXES).map(Number);
  const rows = await db`SELECT id, open_song_id, title, lyrics FROM songs WHERE open_song_id = ANY(${ids})`;
  const byId = new Map(rows.map(r => [r.open_song_id, r]));

  const missing = ids.filter(id => !byId.has(id));
  if (missing.length) console.warn('Not found in DB (skipping):', missing);

  for (const openSongId of ids) {
    const row = byId.get(openSongId);
    if (!row) continue;
    const fix = FIXES[openSongId];
    const cleaned = fix(row.lyrics).trim();

    console.log(`\n===== #${openSongId} ${row.title} =====`);
    if (cleaned === row.lyrics.trim()) {
      console.log('(no change - fix produced identical text, check the anchor)');
      continue;
    }
    console.log('--- BEFORE (first/last 100 chars) ---');
    console.log(row.lyrics.slice(0, 100).replace(/\n/g, '\\n') + ' ... ' + row.lyrics.slice(-100).replace(/\n/g, '\\n'));
    console.log('--- AFTER (first/last 100 chars) ---');
    console.log(cleaned.slice(0, 100).replace(/\n/g, '\\n') + ' ... ' + cleaned.slice(-100).replace(/\n/g, '\\n'));

    if (!DRY_RUN) {
      const { lyrics: newLyrics, openSongFormat } = buildLyricsAndFormat(cleaned);
      await db`UPDATE songs SET lyrics = ${newLyrics}, open_song_format = ${openSongFormat} WHERE id = ${row.id}`;
      console.log('-> updated in database.');
    }
  }

  if (DRY_RUN) console.log('\n--dry-run: no changes written.');
  await db.end();
}

main().catch(err => {
  console.error('Fix failed:', err);
  process.exit(1);
});
