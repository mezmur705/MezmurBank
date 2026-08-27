// One-off bulk import: reads an OpenSong-style folder tree (Songs/<Singer>/<song files>)
// directly from disk and loads it into the Mezmurify database, bypassing the browser upload UI.
// Usage: node import-from-folder.js "H:\My Drive\OpenSong\Songs"
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

const ROOT = process.argv[2];
if (!ROOT) {
  console.error('Usage: node import-from-folder.js "<path to Songs folder>"');
  process.exit(1);
}

const dbConfig = {
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { trustServerCertificate: true, encrypt: false }
};

function slugify(str) {
  return (str || '').toString().toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'x';
}

const ETHIOPIC_PATTERN = new RegExp('[\\u1200-\\u137F\\u1380-\\u139F\\u2D80-\\u2DDF\\uAB00-\\uAB2F]');
function detectLanguage(title, lyrics) {
  return ETHIOPIC_PATTERN.test(`${title} ${lyrics}`) ? 'Amharic' : 'English';
}

function unescapeXml(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
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

function parseSongFile(raw, fallbackTitle) {
  const xmlLyrics = extractTag(raw, 'lyrics');
  if (xmlLyrics) {
    const xmlTitle = extractTag(raw, 'title');
    return { title: xmlTitle || fallbackTitle, lyrics: cleanLyrics(xmlLyrics) };
  }
  // Not OpenSong XML (or missing <lyrics>) - treat the whole file as plain lyrics text.
  return { title: fallbackTitle, lyrics: cleanLyrics(raw) };
}

async function upsertSinger(pool, cache, name) {
  if (cache.has(name)) return cache.get(name);
  const selectReq = pool.request();
  selectReq.input('Name', sql.NVarChar(300), name);
  const existing = await selectReq.query('SELECT Id FROM dbo.Singers WHERE Name = @Name');
  let id;
  if (existing.recordset.length) {
    id = existing.recordset[0].Id;
  } else {
    const insertReq = pool.request();
    insertReq.input('Name', sql.NVarChar(300), name);
    const inserted = await insertReq.query('INSERT INTO dbo.Singers (Name) OUTPUT inserted.Id VALUES (@Name)');
    id = inserted.recordset[0].Id;
  }
  cache.set(name, id);
  return id;
}

async function main() {
  console.log(`Scanning ${ROOT} ...`);
  const pool = await sql.connect(dbConfig);
  const singerDirs = fs.readdirSync(ROOT, { withFileTypes: true }).filter(d => d.isDirectory());
  console.log(`Found ${singerDirs.length} singer folders.`);

  const existingIds = await pool.request().query("SELECT OpenSongID FROM dbo.Songs WHERE OpenSongID IS NOT NULL");
  const usedOpenSongIds = new Set(existingIds.recordset.map(row => String(row.OpenSongID)));
  let nextOpenSongId = existingIds.recordset.reduce((max, row) => {
    const value = Number(row.OpenSongID);
    return Number.isSafeInteger(value) && value !== 9999 ? Math.max(max, value) : max;
  }, 1000) + 1;

  function allocateOpenSongId() {
    while (usedOpenSongIds.has(String(nextOpenSongId))) nextOpenSongId++;
    const allocated = String(nextOpenSongId++);
    usedOpenSongIds.add(allocated);
    return allocated;
  }

  const singerIdCache = new Map();
  let processed = 0, imported = 0, skipped = 0, errors = 0;
  const startTime = Date.now();

  for (const dirEnt of singerDirs) {
    const singerName = dirEnt.name;
    const singerPath = path.join(ROOT, singerName);
    let files;
    try {
      files = fs.readdirSync(singerPath, { withFileTypes: true })
        .filter(f => f.isFile() && f.name.toLowerCase().endsWith('.txt'));
    } catch (err) {
      console.error(`ERROR reading folder ${singerPath}: ${err.message}`);
      continue;
    }
    if (!files.length) continue;

    const singerId = await upsertSinger(pool, singerIdCache, singerName);

    for (const fileEnt of files) {
      processed++;
      const filePath = path.join(singerPath, fileEnt.name);
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const openSongIdMatch = fileEnt.name.match(/^(\d+)\s+/);
        const parsedOpenSongId = openSongIdMatch ? openSongIdMatch[1] : null;
        const openSongId = !parsedOpenSongId || parsedOpenSongId === '9999'
          ? allocateOpenSongId()
          : parsedOpenSongId;
        usedOpenSongIds.add(openSongId);
        const fallbackTitle = fileEnt.name.replace(/\.txt$/i, '').replace(/^\d+\s+/, '').trim();
        const { title, lyrics } = parseSongFile(raw, fallbackTitle);
        if (!lyrics) { skipped++; continue; }
        const language = detectLanguage(title, lyrics);
        const id = `${slugify(singerName)}__${slugify(title)}`;
        const req = pool.request();
        req.input('Id', sql.NVarChar(400), id);
        req.input('SingerId', sql.Int, singerId);
        req.input('Title', sql.NVarChar(400), title);
        req.input('Lyrics', sql.NVarChar(sql.MAX), lyrics);
        req.input('Language', sql.NVarChar(50), language);
        req.input('OpenSongID', sql.Int, Number(openSongId));
        await req.query(`
          MERGE dbo.Songs AS target
          USING (SELECT @Id AS Id) AS src
          ON target.Id = src.Id
          WHEN MATCHED THEN UPDATE SET SingerId = @SingerId, Title = @Title, Lyrics = @Lyrics, Language = @Language, OpenSongID = @OpenSongID
          WHEN NOT MATCHED THEN INSERT (Id, SingerId, Title, Lyrics, Language, OpenSongID) VALUES (@Id, @SingerId, @Title, @Lyrics, @Language, @OpenSongID);
        `);
        imported++;
      } catch (err) {
        errors++;
        console.error(`ERROR ${filePath}: ${err.message}`);
      }
      if (processed % 50 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`Progress: ${processed} processed, ${imported} imported, ${skipped} skipped, ${errors} errors (${elapsed}s elapsed)`);
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`DONE in ${elapsed}s. processed=${processed} imported=${imported} skipped=${skipped} errors=${errors}`);
  await pool.close();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
