// Rebuilds every Sunday's OpenSong set file straight from the sunday_songs table and
// writes it into GOOGLE_DRIVE_TODAY_FOLDER_ID (My Drive/OpenSong/Sets). Meant to be run
// once, locally, right after fixing a wrong/missing GOOGLE_DRIVE_TODAY_FOLDER_ID on
// Render - it recreates the correct files in the correct folder but does not touch or
// delete anything that was written to the wrong folder while the env var was broken.
//
// Usage: node regenerate-sunday-sets.js               (every Sunday that has songs)
//        node regenerate-sunday-sets.js 2026-09-06 ... (only these dates)

require('dotenv').config();
const postgres = require('postgres');
const { getDriveClient } = require('./lib/googleDrive');
const { buildSetXml } = require('./lib/openSongSet');

const db = postgres(process.env.DATABASE_URL, { ssl: 'require' });
const FOLDER_ID = process.env.GOOGLE_DRIVE_TODAY_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID;

const requestedDates = process.argv.slice(2);

function escapeForDriveQuery(name) {
  return name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
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
  if (!FOLDER_ID) throw new Error('GOOGLE_DRIVE_TODAY_FOLDER_ID (or GOOGLE_DRIVE_FOLDER_ID) is not set in server/.env.');

  const dates = requestedDates.length
    ? requestedDates
    : (await db`SELECT DISTINCT sunday_date FROM sunday_songs ORDER BY sunday_date`).map(r => r.sunday_date.toISOString().slice(0, 10));

  if (!dates.length) {
    console.log('No Sunday sets found.');
    await db.end();
    return;
  }

  const drive = getDriveClient();

  for (const dateStr of dates) {
    const rows = await db`
      SELECT s.title, s.open_song_id, sg.name AS singer_name
      FROM sunday_songs ss
      JOIN songs s ON s.id = ss.song_id
      JOIN singers sg ON sg.id = s.singer_id
      WHERE ss.sunday_date = ${dateStr}
      ORDER BY ss.position
    `;
    if (!rows.length) {
      console.log(`${dateStr}: no songs, skipping`);
      continue;
    }

    const xml = buildSetXml(dateStr, rows.map(r => ({ openSongId: r.open_song_id, title: r.title, singerName: r.singer_name })));
    const fileName = `${dateStr}.txt`;
    const existingId = await findFile(drive, fileName, FOLDER_ID);

    if (existingId) {
      await drive.files.update({ fileId: existingId, media: { mimeType: 'text/plain', body: xml }, supportsAllDrives: true });
      console.log(`${dateStr}: updated existing file (${rows.length} songs)`);
    } else {
      await drive.files.create({
        requestBody: { name: fileName, parents: [FOLDER_ID] },
        media: { mimeType: 'text/plain', body: xml },
        supportsAllDrives: true,
        fields: 'id',
      });
      console.log(`${dateStr}: created new file (${rows.length} songs)`);
    }
  }

  await db.end();
}

main().catch(err => {
  console.error('Regenerate failed:', err);
  process.exit(1);
});
