// Batch job: for every song folder under the Telegram media backup, reads the first non-blank
// line of its lyrics .txt file as the song title, looks that title up in dbo.Songs, and — when
// a match exists — uploads the folder's mp3 to a Google Drive folder (as "<Singer>_<Title>.mp3")
// and stores the resulting Drive link in dbo.Songs.MediaUrl.
//
// Requires drive-auth-setup.js to have been run once already (produces google-oauth-token.json).
// Usage: node match-and-upload-media.js ["H:\My Drive\backup\Telegram\media"] [--force] [--dry-run]
// --dry-run: only matches titles against dbo.Songs and logs what would happen; no Drive upload,
// no MediaUrl write, and the Drive client isn't even initialized.
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const sql = require('mssql');
const { google } = require('googleapis');

const MEDIA_DIR = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : (process.env.TELEGRAM_MEDIA_DIR || 'H:\\My Drive\\backup\\Telegram\\media');
const FORCE = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');

const CLIENT_PATH = path.resolve(__dirname, process.env.GOOGLE_OAUTH_CLIENT_PATH || 'google-oauth-client.json');
const TOKEN_PATH = path.resolve(__dirname, process.env.GOOGLE_OAUTH_TOKEN_PATH || 'google-oauth-token.json');
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;

const dbConfig = {
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { trustServerCertificate: true, encrypt: false },
  requestTimeout: 30000,
  connectionTimeout: 30000
};

function getDriveClient() {
  if (!fs.existsSync(CLIENT_PATH)) throw new Error(`Missing OAuth client file: ${CLIENT_PATH}. Run drive-auth-setup.js first.`);
  if (!fs.existsSync(TOKEN_PATH)) throw new Error(`Missing OAuth token file: ${TOKEN_PATH}. Run drive-auth-setup.js first.`);
  const clientJson = JSON.parse(fs.readFileSync(CLIENT_PATH, 'utf8'));
  const { client_id, client_secret } = clientJson.installed || clientJson.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret);
  oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')));
  return google.drive({ version: 'v3', auth: oAuth2Client });
}

// Some files use an explicit "Title : ..." / "Artist : ..." labeled format instead of the
// "#hashtag" convention below. When present, it's unambiguous, so prefer it.
function extractLabeledTitle(raw) {
  const match = raw.match(/^\s*Title\s*:\s*(.+?)\s*$/im);
  return match ? match[1].trim() : null;
}

// Otherwise, the first non-blank line looks like "🎼#አምላኬ_አምላኬ", "#ተመስገን", or "ባማረ:ቅኔ": leading
// emoji/symbols, an optional '#', then the title with '_' or ':' standing in for spaces. A line
// starting with 🎤 tags the singer, not the title, and has no separate title line to extract.
function extractTitleFromFirstLine(raw) {
  const labeled = extractLabeledTitle(raw);
  if (labeled) return labeled;

  const lines = raw.split(/\r?\n/);
  const firstLine = lines.find(line => line.trim().length > 0) || '';
  if (firstLine.trim().startsWith('🎤')) return '';
  return firstLine
    .trim()
    .replace(/^[^\p{L}\p{N}#]+/u, '')
    .replace(/#/g, '')
    .replace(/[_:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// dbo.Songs.Title is always stored as "<Amharic title> (<Latin transliteration>)" — strip that
// suffix so it can be compared against the plain Amharic title pulled from the lyrics file.
function normalizeTitle(title) {
  return (title || '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeFileNamePart(value) {
  return (value || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

// Loads every song once and indexes by normalized title, rather than one round-trip per folder:
// faster, and sidesteps SQL Server's linguistic LIKE/`=` behavior on Ethiopic script by doing the
// comparison in JS instead.
async function loadSongIndex(pool) {
  const result = await pool.request().query(`
    SELECT s.Id, s.Title, s.MediaUrl, si.Name AS SingerName
    FROM dbo.Songs s
    JOIN dbo.Singers si ON si.Id = s.SingerId
  `);
  const index = new Map();
  let duplicates = 0;
  for (const row of result.recordset) {
    const key = normalizeTitle(row.Title);
    if (index.has(key)) { duplicates++; continue; }
    index.set(key, row);
  }
  if (duplicates) console.log(`Note: ${duplicates} song(s) share a normalized title with another song; only the first is used for matching.`);
  return index;
}

async function updateMediaUrl(pool, id, mediaUrl) {
  const req = pool.request();
  req.input('Id', sql.NVarChar(400), id);
  req.input('MediaUrl', sql.NVarChar(1000), mediaUrl);
  await req.query('UPDATE dbo.Songs SET MediaUrl = @MediaUrl WHERE Id = @Id');
}

async function uploadToDrive(drive, mp3Path, fileName) {
  const response = await drive.files.create({
    requestBody: { name: fileName, parents: DRIVE_FOLDER_ID ? [DRIVE_FOLDER_ID] : undefined },
    media: { mimeType: 'audio/mpeg', body: fs.createReadStream(mp3Path) },
    fields: 'id, webViewLink'
  });
  return response.data.webViewLink;
}

async function main() {
  if (!DRIVE_FOLDER_ID) {
    console.error('Missing DRIVE_FOLDER_ID in server\\.env');
    process.exit(1);
  }
  if (!fs.existsSync(MEDIA_DIR)) {
    console.error(`Media directory does not exist: ${MEDIA_DIR}`);
    process.exit(1);
  }

  const drive = DRY_RUN ? null : getDriveClient();
  const pool = await sql.connect(dbConfig);
  if (DRY_RUN) console.log('--- DRY RUN: no Drive uploads, no MediaUrl writes ---');

  const songIndex = await loadSongIndex(pool);
  console.log(`Loaded ${songIndex.size} songs from dbo.Songs`);

  const songDirs = fs.readdirSync(MEDIA_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
  console.log(`Found ${songDirs.length} folders under ${MEDIA_DIR}`);

  let matched = 0, uploaded = 0, skippedExisting = 0, unmatched = 0, errors = 0;
  const unmatchedTitles = [];

  for (const dirEnt of songDirs) {
    const songDir = path.join(MEDIA_DIR, dirEnt.name);
    let files;
    try {
      files = fs.readdirSync(songDir, { withFileTypes: true }).filter(f => f.isFile());
    } catch (err) {
      console.error(`ERROR reading ${songDir}: ${err.message}`);
      errors++;
      continue;
    }
    const txtFile = files.find(f => f.name.toLowerCase().endsWith('.txt'));
    const mp3File = files.find(f => f.name.toLowerCase().endsWith('.mp3'));
    if (!txtFile || !mp3File) continue;

    try {
      const raw = fs.readFileSync(path.join(songDir, txtFile.name), 'utf8');
      const title = extractTitleFromFirstLine(raw);
      if (!title) continue;

      const song = songIndex.get(normalizeTitle(title));
      if (!song) {
        unmatched++;
        unmatchedTitles.push(`${dirEnt.name} -> "${title}"`);
        continue;
      }
      matched++;

      if (song.MediaUrl && !FORCE) {
        skippedExisting++;
        console.log(`SKIP (already has MediaUrl): ${title}`);
        continue;
      }

      const fileName = `${sanitizeFileNamePart(song.SingerName)}_${sanitizeFileNamePart(song.Title)}.mp3`;
      const mp3Path = path.join(songDir, mp3File.name);

      if (DRY_RUN) {
        console.log(`WOULD UPLOAD: ${dirEnt.name} -> "${fileName}" (Song.Id=${song.Id})`);
        continue;
      }

      const mediaUrl = await uploadToDrive(drive, mp3Path, fileName);
      await updateMediaUrl(pool, song.Id, mediaUrl);
      uploaded++;
      console.log(`UPLOADED: ${fileName} -> ${mediaUrl}`);
    } catch (err) {
      errors++;
      console.error(`ERROR ${songDir}: ${err.message}`);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Matched: ${matched} | Uploaded: ${uploaded} | Skipped (already had MediaUrl): ${skippedExisting} | Unmatched: ${unmatched} | Errors: ${errors}`);
  if (unmatchedTitles.length) {
    console.log('\nUnmatched titles:');
    unmatchedTitles.forEach(line => console.log(`  ${line}`));
  }

  try {
    await pool.close();
  } catch (err) {
    console.error(`Warning: pool.close() failed: ${err.message}`);
  }
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exitCode = 1;
});
