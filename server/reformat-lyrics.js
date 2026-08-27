// One-off: restructure Lyrics and populate OpenSongFormat for every song.
//
// Rule: if a song's Lyrics has 6 or more non-blank lines and currently has NO blank
// line at all, insert a blank line after every 4 lines (this becomes the new Lyrics).
// Songs that already have blank-line-separated stanzas are left as-is.
//
// OpenSongFormat is then built from the (possibly newly-blanked) Lyrics: split into
// stanzas on blank lines, then any stanza longer than 4 lines is further split into
// 4-line chunks. Each resulting chunk becomes its own tag, [V1], [V2], [V3], ...
// Every lyric line is prefixed with a single leading space; [Vn] tag lines are not.
//
// Usage: node reformat-lyrics.js
require('dotenv').config();
const sql = require('mssql');

const dbConfig = {
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { trustServerCertificate: true, encrypt: false }
};

function restructure(lyrics) {
  const rawLines = (lyrics || '').replace(/\r\n/g, '\n').split('\n');
  const hasBlankLine = rawLines.some(l => l.trim() === '');
  const nonBlankCount = rawLines.filter(l => l.trim() !== '').length;

  let lines = rawLines;
  if (!hasBlankLine && nonBlankCount >= 6) {
    const chunks = [];
    for (let i = 0; i < rawLines.length; i += 4) {
      chunks.push(rawLines.slice(i, i + 4).join('\n'));
    }
    lines = chunks.join('\n\n').split('\n');
  }

  const newLyrics = lines.join('\n').trim();

  const stanzas = newLyrics
    .split(/\n\s*\n/)
    .map(s => s.split('\n').filter(l => l.trim() !== ''))
    .filter(stanza => stanza.length);

  // A stanza longer than 4 lines becomes multiple verse tags, 4 lines each.
  const verses = [];
  stanzas.forEach(stanza => {
    for (let i = 0; i < stanza.length; i += 4) {
      verses.push(stanza.slice(i, i + 4));
    }
  });

  const out = [];
  verses.forEach((verse, idx) => {
    out.push(`[V${idx + 1}]`);
    verse.forEach(l => out.push(` ${l}`));
  });

  return { lyrics: newLyrics, openSongFormat: out.join('\n') };
}

async function main() {
  const pool = await sql.connect(dbConfig);
  const all = await pool.request().query('SELECT Id, Lyrics FROM dbo.Songs');
  console.log(`Processing ${all.recordset.length} songs...`);

  let updated = 0, restructured = 0;
  for (const row of all.recordset) {
    const before = row.Lyrics || '';
    const { lyrics, openSongFormat } = restructure(before);
    if (lyrics !== before) restructured++;

    const req = pool.request();
    req.input('Id', sql.NVarChar(400), row.Id);
    req.input('Lyrics', sql.NVarChar(sql.MAX), lyrics);
    req.input('OpenSongFormat', sql.NVarChar(sql.MAX), openSongFormat);
    await req.query('UPDATE dbo.Songs SET Lyrics = @Lyrics, OpenSongFormat = @OpenSongFormat WHERE Id = @Id');
    updated++;
    if (updated % 200 === 0) console.log(`  ${updated}/${all.recordset.length}`);
  }

  console.log(`DONE. updated=${updated} (blank-lines-inserted for ${restructured} songs)`);
  await pool.close();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
