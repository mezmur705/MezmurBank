// One-off: imports OpenSong files from the local backup folder whose filename was never
// assigned a real OpenSong ID (still prefixed "9999"), found anywhere under Songs/ - both
// root-level orphans (no singer folder -> singer 'main', matching the app's convention for
// songs with no identified singer) and files inside Songs/<Singer>/ (singer = folder name).
//
// Cross-checked by hand against the existing ~3200-song catalog first (see chat history for
// the full reconciliation): about a third of these files turned out to be backup copies of
// songs already imported (sometimes under a slightly different spelling), plus one pair of
// files that are internal duplicates of each other. Those are called out explicitly below
// rather than silently re-imported/overwritten. A live title check is also run as a second
// safety net, so a song already in the DB under an exact-matching title is skipped even if it
// isn't in the explicit list.
//
// Usage:
//   node import-opensong-9999-songs.js --dry-run   (prints what would happen, changes nothing)
//   node import-opensong-9999-songs.js             (applies the import)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');
const { buildLyricsAndFormat } = require('./lib/lyricsFormat');

const ROOT = 'I:\\My Drive\\OpenSong_backup\\Songs';
const db = postgres(process.env.DATABASE_URL, { ssl: 'require' });
const DRY_RUN = process.argv.includes('--dry-run');

// Confirmed (by comparing actual lyrics content, not just titles) to be backup copies of
// songs already in the DB, or junk/empty stubs. Keyed by path relative to ROOT.
const EXPLICIT_SKIP = new Set([
  '9999 ኣንተማ ትልቅ ነህ (Antema Tilk Neh)', // root orphan, <lyrics> is empty - a blanked-out stub
  "Ezra Tena\\9999 ኣንተማ ትልቅ ነህ (Antema Tilk Neh)", // has real content, but it's the same song already in the DB (only a one-character ኣ/አ spelling difference in the title)
  '9999 የሱስ ከፍሎታል (Yesus Keflotal)', // identical lyrics to the file below - keeping the fuller title instead
]);

// Bethlehem 'Betty' Wolde and Bethlehem 'Betty' Tezera are the same singer (confirmed: other
// songs in the Wolde folder already exist in the DB under the Tezera singer row - Tezera looks
// to be a later rename that this backup folder never picked up). Route Wolde's genuinely-new
// songs to the existing Tezera singer instead of creating a duplicate singer.
const SINGER_OVERRIDE = {
  "Bethlehem 'Betty' Wolde\\9999 እግዚአብሔር ያለዉ (Egziabher Yalew)": "Bethlehem 'Betty' Tezera",
  "Bethlehem 'Betty' Wolde\\9999  እረኛዬ (Eregnaye)": "Bethlehem 'Betty' Tezera",
};

// This file's title happens to match an existing song's title exactly, but the lyrics are
// completely different (confirmed by hand) - a different song that just shares a common
// Amharic gospel phrase as its title ("My Shepherd"). The live title-based dup check below
// would otherwise wrongly skip it as an "already imported" duplicate.
const SKIP_DUP_TITLE_CHECK = new Set([
  "Bethlehem 'Betty' Wolde\\9999  እረኛዬ (Eregnaye)",
]);

// This file's internal <title> tag is wrong (a stale copy-paste from a sibling file in the same
// folder - it says "Misganachinin Enabezalen", a different, already-imported song by the same
// singer). Trust the filename instead.
const TITLE_OVERRIDE = {
  "Endalkachew 'Enawa' Hawaz\\9999  ኦ ክብር (Oh Kibir)": 'ኦ ክብር (Oh Kibir)',
};

function unescapeXml(str) {
  return str
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}
function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? unescapeXml(m[1]).trim() : '';
}
// Strips OpenSong chord lines (leading '.') and bare section tags like [V1], [C], [Chorus].
function cleanLyrics(raw) {
  return raw
    .split(/\r?\n/)
    .filter(line => !/^\s*\.\S/.test(line))
    .map(line => line.trim())
    .filter(line => !/^\[[^\]]*\]$/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function slugify(str) {
  return (str || '').toString().toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'x';
}
const ETHIOPIC_PATTERN = new RegExp('[\\u1200-\\u137F\\u1380-\\u139F\\u2D80-\\u2DDF\\uAB00-\\uAB2F]');
function detectLanguage(title, lyrics) {
  return ETHIOPIC_PATTERN.test(`${title} ${lyrics}`) ? 'Amharic' : 'English';
}

function findFiles(dir, relBase) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = relBase ? path.join(relBase, ent.name) : ent.name;
    if (ent.isDirectory()) {
      out.push(...findFiles(path.join(dir, ent.name), rel));
    } else if (ent.isFile() && ent.name.startsWith('9999')) {
      out.push({ folder: relBase || null, rel, full: path.join(dir, ent.name) });
    }
  }
  return out;
}

async function upsertSinger(tx, cache, name) {
  if (cache.has(name)) return cache.get(name);
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
  const id = rows[0].id;
  cache.set(name, id);
  return id;
}

async function main() {
  const files = findFiles(ROOT, null);
  console.log(`Found ${files.length} files starting with 9999.\n`);

  let nextOpenSongId = null;
  const singerIdCache = new Map();
  let imported = 0, skippedDup = 0, skippedExplicit = 0;

  await db.begin(async tx => {
    for (const f of files) {
      if (EXPLICIT_SKIP.has(f.rel)) {
        console.log(`SKIP (explicit): ${f.rel}`);
        skippedExplicit++;
        continue;
      }

      const raw = fs.readFileSync(f.full, 'utf8');
      const rawTitle = extractTag(raw, 'title').replace(/^9999\s+/, '').trim();
      const title = TITLE_OVERRIDE[f.rel] || rawTitle;
      const author = extractTag(raw, 'author').replace(/\s*\(#\d+\)\s*$/, '').trim();
      const lyricsRaw = cleanLyrics(extractTag(raw, 'lyrics'));

      const singerName = SINGER_OVERRIDE[f.rel]
        || (f.folder ? f.folder : (author && author.toLowerCase() !== 'powerpoint' ? author : 'main'));

      const existingTitle = SKIP_DUP_TITLE_CHECK.has(f.rel)
        ? []
        : await tx`SELECT id, title FROM songs WHERE lower(title) = lower(${title})`;
      if (existingTitle.length) {
        console.log(`SKIP (already in DB as "${existingTitle[0].title}", id=${existingTitle[0].id}): ${f.rel}`);
        skippedDup++;
        continue;
      }

      if (!lyricsRaw) {
        console.log(`SKIP (empty lyrics): ${f.rel}`);
        skippedExplicit++;
        continue;
      }

      const singerId = await upsertSinger(tx, singerIdCache, singerName);
      const language = detectLanguage(title, lyricsRaw);
      const { lyrics, openSongFormat } = buildLyricsAndFormat(lyricsRaw);
      const id = `${slugify(singerName)}__${slugify(title)}`;

      const idCollision = await tx`SELECT id FROM songs WHERE id = ${id}`;
      if (idCollision.length) {
        console.log(`SKIP (id "${id}" already exists under a different title - needs manual look): ${f.rel}`);
        skippedExplicit++;
        continue;
      }

      if (nextOpenSongId === null) {
        const [{ max_id }] = await tx`SELECT MAX(open_song_id) AS max_id FROM songs`;
        nextOpenSongId = (max_id || 0) + 1;
      }
      const openSongId = nextOpenSongId++;

      console.log(`IMPORT [${openSongId}] [${singerName}] "${title}" (id=${id})`);
      imported++;

      if (DRY_RUN) continue;

      await tx`
        INSERT INTO songs (id, singer_id, title, lyrics, language, open_song_id, open_song_format, source_name, source_url)
        VALUES (${id}, ${singerId}, ${title}, ${lyrics}, ${language}, ${openSongId}, ${openSongFormat}, NULL, NULL)
      `;
    }
  });

  console.log(`\n${DRY_RUN ? 'Dry run complete' : 'Import complete'}: ${imported} imported, ${skippedDup} skipped (already in DB by title), ${skippedExplicit} skipped (explicit/empty/id-collision).`);
  await db.end();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
