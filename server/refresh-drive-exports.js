// Re-uploads the Drive-exported OpenSong XML file for a specific set of songs whose
// lyrics/open_song_format changed after the initial bulk export, without touching
// anything else in the Drive folder. Updates the existing file in place if found,
// otherwise creates it.
//
// Usage: node refresh-drive-exports.js 1086 1187 1326 ... (open_song_ids)

require('dotenv').config();
const postgres = require('postgres');
const { getDriveClient } = require('./lib/googleDrive');
const { buildOpenSongXml } = require('./lib/openSongXml');

const db = postgres(process.env.DATABASE_URL, { ssl: 'require' });
const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

const ids = process.argv.slice(2).map(Number);

function escapeForDriveQuery(name) {
  return name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findFolder(drive, name, parentId) {
  const escaped = escapeForDriveQuery(name);
  const list = await drive.files.list({
    q: `'${parentId}' in parents and name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return list.data.files && list.data.files[0] ? list.data.files[0].id : null;
}

async function findFile(drive, name, parentId) {
  const escaped = escapeForDriveQuery(name);
  const list = await drive.files.list({
    q: `'${parentId}' in parents and name = '${escaped}' and trashed = false`,
    fields: 'files(id)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return list.data.files && list.data.files[0] ? list.data.files[0].id : null;
}

async function main() {
  if (!ids.length) throw new Error('Pass one or more open_song_ids as arguments.');
  if (!ROOT_FOLDER_ID) throw new Error('GOOGLE_DRIVE_FOLDER_ID is not set.');

  const drive = getDriveClient();
  const rows = await db`
    SELECT s.open_song_id, s.title, s.open_song_format, sg.name AS singer_name
    FROM songs s
    JOIN singers sg ON s.singer_id = sg.id
    WHERE s.open_song_id = ANY(${ids})
  `;

  for (const row of rows) {
    const fileName = `${row.open_song_id}_${row.title}.txt`;
    const xml = buildOpenSongXml({
      title: row.title,
      singerName: row.singer_name,
      openSongId: row.open_song_id,
      lyricsBody: row.open_song_format,
    });

    const folderId = await findFolder(drive, row.singer_name, ROOT_FOLDER_ID);
    if (!folderId) {
      console.log(`No Drive folder for singer "${row.singer_name}" - skipping #${row.open_song_id}`);
      continue;
    }

    const fileId = await findFile(drive, fileName, folderId);
    if (fileId) {
      await drive.files.update({
        fileId,
        media: { mimeType: 'text/plain', body: xml },
        supportsAllDrives: true,
      });
      console.log(`Updated existing file: ${fileName}`);
    } else {
      await drive.files.create({
        requestBody: { name: fileName, parents: [folderId] },
        media: { mimeType: 'text/plain', body: xml },
        supportsAllDrives: true,
        fields: 'id',
      });
      console.log(`Created new file (none existed): ${fileName}`);
    }
  }

  await db.end();
}

main().catch(err => {
  console.error('Refresh failed:', err);
  process.exit(1);
});
