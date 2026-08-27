require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const sql = require('mssql');

const dbConfig = {
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { trustServerCertificate: true, encrypt: false }
};

const OUT_DIR = path.join(__dirname, 'export');

(async () => {
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const pool = await new sql.ConnectionPool(dbConfig).connect();

    const singers = (await pool.request().query(
      `SELECT Id, Name, AmharicName FROM dbo.Singers ORDER BY Id`
    )).recordset;

    const songs = (await pool.request().query(
      `SELECT Id, SingerId, Title, Lyrics, Language, OpenSongID, YoutubeVideoId, MediaUrl,
              OpenSongFormat, ViewCount, LikeCount, LoveCount, HahaCount, WowCount, SadCount, AngryCount
       FROM dbo.Songs ORDER BY Id`
    )).recordset;

    const comments = (await pool.request().query(
      `SELECT Id, SongId, Author, Comment, CreatedAt FROM dbo.SongComments ORDER BY Id`
    )).recordset;

    fs.writeFileSync(path.join(OUT_DIR, 'singers.json'), JSON.stringify(singers, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, 'songs.json'), JSON.stringify(songs, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, 'song_comments.json'), JSON.stringify(comments, null, 2));

    await pool.close();

    console.log(`Exported: ${singers.length} singers, ${songs.length} songs, ${comments.length} comments.`);

    // Building the verification sample happens in a separate process (see
    // generate-verify-sample.js) deliberately: reading songs.json back from within
    // the very process that just wrote it was observed to sometimes disagree with
    // what every other process subsequently reads from the same file on disk.
    execFileSync(process.execPath, [path.join(__dirname, 'generate-verify-sample.js')], { stdio: 'inherit' });
  } catch (err) {
    console.error('Export failed:', err.message);
    process.exitCode = 1;
  }
})();
