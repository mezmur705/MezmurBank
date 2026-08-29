// One-off bulk export: every song in the database -> Google Drive, organized as
// <root folder>/<Singer>/<OpenSongID>_<Title>.txt, each file in real OpenSong XML format.
// Safe to re-run: skips any song whose file already exists in its singer's folder.
//
// Usage:
//   node export-all-to-drive.js            (export everything)
//   node export-all-to-drive.js --limit 20 (export only the first 20 songs, for a test run)

require('dotenv').config();
const postgres = require('postgres');
const { getDriveClient } = require('./lib/googleDrive');
const { buildOpenSongXml } = require('./lib/openSongXml');

const db = postgres(process.env.DATABASE_URL, { ssl: 'require' });
const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

const limitArgIndex = process.argv.indexOf('--limit');
const LIMIT = limitArgIndex !== -1 ? parseInt(process.argv[limitArgIndex + 1], 10) : null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Drive API calls occasionally hit transient rate-limit/server errors under bulk load.
async function withRetry(fn, { retries = 5, baseDelay = 500 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.code || err.response?.status;
      if (attempt >= retries || ![429, 500, 503].includes(status)) throw err;
      const delay = baseDelay * 2 ** attempt;
      console.warn(`  (retrying after ${status} error, attempt ${attempt + 1}, waiting ${delay}ms)`);
      await sleep(delay);
    }
  }
}

function escapeForDriveQuery(name) {
  return name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findOrCreateFolder(drive, name, parentId) {
  const escaped = escapeForDriveQuery(name);
  const list = await withRetry(() =>
    drive.files.list({
      q: `'${parentId}' in parents and name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
  );
  if (list.data.files && list.data.files.length) return list.data.files[0].id;

  const created = await withRetry(() =>
    drive.files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
      supportsAllDrives: true,
      fields: 'id',
    })
  );
  return created.data.id;
}

async function fileExists(drive, name, parentId) {
  const escaped = escapeForDriveQuery(name);
  const list = await withRetry(() =>
    drive.files.list({
      q: `'${parentId}' in parents and name = '${escaped}' and trashed = false`,
      fields: 'files(id)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
  );
  return !!(list.data.files && list.data.files.length);
}

async function main() {
  if (!ROOT_FOLDER_ID) throw new Error('GOOGLE_DRIVE_FOLDER_ID is not set in server/.env.');
  const drive = getDriveClient();

  let rows = await db`
    SELECT s.id, s.title, s.open_song_id, s.open_song_format, sg.name AS singer_name
    FROM songs s
    JOIN singers sg ON s.singer_id = sg.id
    ORDER BY sg.name, s.title
  `;
  if (LIMIT) rows = rows.slice(0, LIMIT);

  const bySinger = new Map();
  rows.forEach(row => {
    if (!bySinger.has(row.singer_name)) bySinger.set(row.singer_name, []);
    bySinger.get(row.singer_name).push(row);
  });

  console.log(`Found ${rows.length} songs across ${bySinger.size} singers.${LIMIT ? ` (limited to ${LIMIT})` : ''}`);

  let exported = 0;
  let skipped = 0;
  const failures = [];

  for (const [singerName, songs] of bySinger) {
    let folderId;
    try {
      folderId = await findOrCreateFolder(drive, singerName, ROOT_FOLDER_ID);
    } catch (err) {
      console.error(`Could not create/find folder for singer "${singerName}": ${err.message}`);
      failures.push({ singer: singerName, song: null, error: err.message });
      continue;
    }

    for (const song of songs) {
      const fileName = `${song.open_song_id}_${song.title}.txt`;
      try {
        if (await fileExists(drive, fileName, folderId)) {
          skipped++;
          continue;
        }
        const xml = buildOpenSongXml({
          title: song.title,
          singerName,
          openSongId: song.open_song_id,
          lyricsBody: song.open_song_format,
        });
        await withRetry(() =>
          drive.files.create({
            requestBody: { name: fileName, parents: [folderId] },
            media: { mimeType: 'text/plain', body: xml },
            supportsAllDrives: true,
            fields: 'id',
          })
        );
        exported++;
        if (exported % 25 === 0) console.log(`  ...exported ${exported} so far`);
        await sleep(150);
      } catch (err) {
        console.error(`Failed to export "${fileName}" for ${singerName}: ${err.message}`);
        failures.push({ singer: singerName, song: song.title, error: err.message });
      }
    }
    console.log(`Done: ${singerName} (${songs.length} songs)`);
  }

  console.log('\n--- Summary ---');
  console.log(`Exported: ${exported}`);
  console.log(`Skipped (already existed): ${skipped}`);
  console.log(`Failed: ${failures.length}`);
  if (failures.length) {
    console.log('Failures:');
    failures.forEach(f => console.log(`  - ${f.singer}${f.song ? ' / ' + f.song : ''}: ${f.error}`));
  }

  await db.end();
}

main().catch(err => {
  console.error('Export failed:', err);
  process.exit(1);
});
