// One-off: imports a hand-picked, manually-copied set of songs from wikimezmur.org
// (CC BY-SA licensed) into the database, with attribution (source_name/source_url)
// so the required credit can be shown in both apps.
//
// Every entry below was copied by a human browsing wikimezmur.org directly - this
// script never fetches that site itself. Add one object per song to songsToImport,
// then run with --dry-run first to review before committing.
//
// Usage:
//   node import-wikimezmur-songs.js --dry-run   (prints what would happen, changes nothing)
//   node import-wikimezmur-songs.js             (applies the import)

require('dotenv').config();
const postgres = require('postgres');
const { buildLyricsAndFormat } = require('./lib/lyricsFormat');

const db = postgres(process.env.DATABASE_URL, { ssl: 'require' });
const DRY_RUN = process.argv.includes('--dry-run');

// Add one entry per song here. `title` should follow the existing
// "Amharic Title (Transliteration)" convention used throughout the database.
const songsToImport = [
  // { title: 'ጌታዬን አከብራለሁ (Gietayien Akebralehu)', singer: 'Singer Name', lyrics: `...`, sourceUrl: 'https://wikimezmur.org/...' },
];

function slugify(str) {
  return (str || '').toString().toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'x';
}

const ETHIOPIC_PATTERN = new RegExp('[\\u1200-\\u137F\\u1380-\\u139F\\u2D80-\\u2DDF\\uAB00-\\uAB2F]');
function detectLanguage(title, lyrics) {
  return ETHIOPIC_PATTERN.test(`${title} ${lyrics}`) ? 'Amharic' : 'English';
}

async function upsertSinger(tx, name) {
  const rows = await tx`
    WITH ins AS (
      INSERT INTO singers (name) VALUES (${name})
      ON CONFLICT (lower(name)) DO NOTHING
      RETURNING id
    )
    SELECT id FROM ins
    UNION ALL
    SELECT id FROM singers WHERE lower(name) = lower(${name})
    LIMIT 1
  `;
  return rows[0].id;
}

async function main() {
  if (!songsToImport.length) {
    console.log('songsToImport is empty - add song entries at the top of this file first.');
    return;
  }

  let nextOpenSongId = null;

  await db.begin(async tx => {
    for (const song of songsToImport) {
      const singerId = await upsertSinger(tx, song.singer);
      const id = `${slugify(song.singer)}__${slugify(song.title)}`;
      const language = detectLanguage(song.title, song.lyrics);
      const { lyrics, openSongFormat } = buildLyricsAndFormat(song.lyrics);

      const existing = await tx`SELECT open_song_id FROM songs WHERE id = ${id}`;
      let openSongId;
      if (existing.length) {
        openSongId = existing[0].open_song_id;
      } else {
        if (nextOpenSongId === null) {
          const [{ max_id }] = await tx`SELECT MAX(open_song_id) AS max_id FROM songs`;
          nextOpenSongId = (max_id || 0) + 1;
        }
        openSongId = nextOpenSongId++;
      }

      console.log(`${existing.length ? 'Update' : 'Insert'}: [${openSongId}] ${song.title} - ${song.singer} (id=${id})`);

      if (DRY_RUN) continue;

      await tx`
        INSERT INTO songs (id, singer_id, title, lyrics, language, open_song_id, open_song_format, source_name, source_url)
        VALUES (${id}, ${singerId}, ${song.title}, ${lyrics}, ${language}, ${openSongId}, ${openSongFormat}, 'WikiMezmur', ${song.sourceUrl})
        ON CONFLICT (id) DO UPDATE SET
          singer_id = EXCLUDED.singer_id, title = EXCLUDED.title, lyrics = EXCLUDED.lyrics,
          language = EXCLUDED.language, open_song_format = EXCLUDED.open_song_format,
          source_name = EXCLUDED.source_name, source_url = EXCLUDED.source_url
      `;
    }
  });

  console.log(`\n${DRY_RUN ? 'Dry run complete' : 'Import complete'}: ${songsToImport.length} song(s) processed.`);
  await db.end();
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
