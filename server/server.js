require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const sql = require('mssql');

const app = express();
const PORT = process.env.PORT || 3000;

const dbConfig = {
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { trustServerCertificate: true, encrypt: false }
};

let poolPromise;
function getPool() {
  if (!poolPromise) {
    const pool = new sql.ConnectionPool(dbConfig);
    pool.on('error', err => {
      console.error('SQL pool error, will reconnect on next request:', err.message);
      poolPromise = null;
    });
    poolPromise = pool.connect().catch(err => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

function slugify(str) {
  return (str || '').toString().toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'x';
}

// Ethiopic, Ethiopic Supplement, Ethiopic Extended, Ethiopic Extended-A Unicode blocks.
const ETHIOPIC_PATTERN = new RegExp('[\\u1200-\\u137F\\u1380-\\u139F\\u2D80-\\u2DDF\\uAB00-\\uAB2F]');
function detectLanguage(title, lyrics) {
  return ETHIOPIC_PATTERN.test(`${title} ${lyrics}`) ? 'Amharic' : 'English';
}

// First few non-blank, non-section-tag lines of a lyric sheet - used as YouTube search text.
function firstLyricLines(lyrics, count) {
  return (lyrics || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/^\[[^\]]*\]$/.test(line))
    .slice(0, count)
    .join(' ');
}

// Normalizes Lyrics (inserts a blank line every 4 lines when a song has 6+ lines and no
// blank line at all) and rebuilds OpenSongFormat from it: stanzas split on blank lines,
// any stanza over 4 lines further split into 4-line chunks, each chunk tagged [V1], [V2], ...
// with a single leading space before every lyric line. Mirrors server/reformat-lyrics.js.
function buildLyricsAndFormat(lyrics) {
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

// Accepts a pasted YouTube URL (watch/embed/shorts/youtu.be) or a bare 11-char video ID.
// Returns the video ID, or undefined if non-empty input didn't match any known format.
function extractYoutubeId(input) {
  const trimmed = (input || '').toString().trim();
  if (!trimmed) return null;
  const m = trimmed.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  return undefined;
}

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Not signed in as admin' });
  next();
}

app.use(express.json({ limit: '10mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(express.static(path.join(__dirname, '..')));
app.use('/vendor/pptxgenjs', express.static(path.join(__dirname, 'node_modules/pptxgenjs/dist')));
app.use('/vendor/jszip', express.static(path.join(__dirname, 'node_modules/jszip/dist')));

app.get('/api/admin/status', (req, res) => {
  res.json({ isAdmin: !!req.session.isAdmin });
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password && password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Incorrect password' });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

async function upsertSinger(tx, name) {
  const selectReq = new sql.Request(tx);
  selectReq.input('Name', sql.NVarChar(300), name);
  const existing = await selectReq.query('SELECT Id FROM dbo.Singers WHERE Name = @Name');
  if (existing.recordset.length) return existing.recordset[0].Id;
  const insertReq = new sql.Request(tx);
  insertReq.input('Name', sql.NVarChar(300), name);
  const inserted = await insertReq.query('INSERT INTO dbo.Singers (Name) OUTPUT inserted.Id VALUES (@Name)');
  return inserted.recordset[0].Id;
}

app.get('/api/mezmurs', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT s.Id, s.OpenSongID, sg.Id AS SingerId, sg.Name AS Singer, sg.AmharicName AS SingerAmharic, s.Title, s.Lyrics, s.Language, s.OpenSongFormat, s.YoutubeVideoId, s.MediaUrl
      FROM dbo.Songs s
      JOIN dbo.Singers sg ON s.SingerId = sg.Id
      ORDER BY sg.Name, s.Title
    `);
    res.json(result.recordset.map(r => ({ id: r.Id, openSongId: r.OpenSongID, singerId: r.SingerId, singer: r.Singer, singerAmharic: r.SingerAmharic, title: r.Title, lyrics: r.Lyrics, language: r.Language, openSongFormat: r.OpenSongFormat, youtubeVideoId: r.YoutubeVideoId, mediaUrl: r.MediaUrl })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mezmurs', requireAdmin, async (req, res) => {
  const songs = Array.isArray(req.body?.songs) ? req.body.songs : [];
  if (!songs.length) return res.status(400).json({ error: 'No songs provided' });
  try {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const singerIdCache = new Map();
      for (const song of songs) {
        let singerId = singerIdCache.get(song.singer);
        if (singerId === undefined) {
          singerId = await upsertSinger(tx, song.singer);
          singerIdCache.set(song.singer, singerId);
        }
        const id = `${slugify(song.singer)}__${slugify(song.title)}`;
        const language = song.language || detectLanguage(song.title, song.lyrics);
        const { lyrics, openSongFormat } = buildLyricsAndFormat(song.lyrics);
        const request = new sql.Request(tx);
        request.input('Id', sql.NVarChar(400), id);
        request.input('SingerId', sql.Int, singerId);
        request.input('Title', sql.NVarChar(400), song.title);
        request.input('Lyrics', sql.NVarChar(sql.MAX), lyrics);
        request.input('Language', sql.NVarChar(50), language);
        request.input('OpenSongID', sql.NVarChar(50), song.openSongId || song.OpenSongID || null);
        request.input('OpenSongFormat', sql.NVarChar(sql.MAX), openSongFormat);
        await request.query(`
          MERGE dbo.Songs AS target
          USING (SELECT @Id AS Id) AS src
          ON target.Id = src.Id
          WHEN MATCHED THEN UPDATE SET SingerId = @SingerId, Title = @Title, Lyrics = @Lyrics, Language = @Language, OpenSongID = @OpenSongID, OpenSongFormat = @OpenSongFormat
          WHEN NOT MATCHED THEN INSERT (Id, SingerId, Title, Lyrics, Language, OpenSongID, OpenSongFormat) VALUES (@Id, @SingerId, @Title, @Lyrics, @Language, @OpenSongID, @OpenSongFormat);
        `);
      }
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
    res.json({ ok: true, count: songs.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/singers', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT Id, Name, AmharicName FROM dbo.Singers ORDER BY Name');
    res.json(result.recordset.map(r => ({ id: r.Id, name: r.Name, amharicName: r.AmharicName })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/singers/:id', requireAdmin, async (req, res) => {
  const name = (req.body?.name || '').toString().trim();
  const amharicName = (req.body?.amharicName || '').toString().trim() || null;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const pool = await getPool();
    const request = pool.request();
    request.input('Id', sql.Int, Number(req.params.id));
    request.input('Name', sql.NVarChar(300), name);
    request.input('AmharicName', sql.NVarChar(300), amharicName);
    const result = await request.query('UPDATE dbo.Singers SET Name = @Name, AmharicName = @AmharicName WHERE Id = @Id');
    if (!result.rowsAffected[0]) return res.status(404).json({ error: 'Singer not found' });
    res.json({ ok: true });
  } catch (err) {
    if (err.number === 2627 || err.number === 2601) {
      return res.status(409).json({ error: 'A singer with that name already exists' });
    }
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/mezmurs/:id', requireAdmin, async (req, res) => {
  const title = (req.body?.title || '').toString().trim();
  const rawLyrics = (req.body?.lyrics || '').toString();
  const language = req.body?.language;
  const singerId = req.body?.singerId ? Number(req.body.singerId) : null;
  if (!title || !rawLyrics.trim()) return res.status(400).json({ error: 'Title and lyrics are required' });

  // Empty input resets to NULL, which re-triggers auto-search on next view.
  const youtubeVideoId = extractYoutubeId(req.body?.youtubeInput);
  if (youtubeVideoId === undefined) return res.status(400).json({ error: 'Could not recognize that YouTube link/ID' });
  const mediaUrl = (req.body?.mediaUrl || '').toString().trim() || null;

  try {
    const pool = await getPool();
    const lookup = pool.request();
    lookup.input('Id', sql.NVarChar(400), req.params.id);
    const existing = await lookup.query('SELECT SingerId FROM dbo.Songs WHERE Id = @Id');
    if (!existing.recordset.length) return res.status(404).json({ error: 'Song not found' });
    const finalSingerId = singerId || existing.recordset[0].SingerId;
    const finalLanguage = language || detectLanguage(title, rawLyrics);
    const { lyrics, openSongFormat } = buildLyricsAndFormat(rawLyrics);

    const request = pool.request();
    request.input('Id', sql.NVarChar(400), req.params.id);
    request.input('SingerId', sql.Int, finalSingerId);
    request.input('Title', sql.NVarChar(400), title);
    request.input('Lyrics', sql.NVarChar(sql.MAX), lyrics);
    request.input('Language', sql.NVarChar(50), finalLanguage);
    request.input('OpenSongFormat', sql.NVarChar(sql.MAX), openSongFormat);
    request.input('YoutubeVideoId', sql.NVarChar(20), youtubeVideoId);
    request.input('MediaUrl', sql.NVarChar(1000), mediaUrl);
    await request.query(`
      UPDATE dbo.Songs SET SingerId = @SingerId, Title = @Title, Lyrics = @Lyrics, Language = @Language,
        OpenSongFormat = @OpenSongFormat, YoutubeVideoId = @YoutubeVideoId, MediaUrl = @MediaUrl
      WHERE Id = @Id
    `);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const REACTION_COLUMNS = { like: 'LikeCount', love: 'LoveCount', haha: 'HahaCount', wow: 'WowCount', sad: 'SadCount', angry: 'AngryCount' };

function statsFromRow(row) {
  return {
    viewCount: row.ViewCount,
    reactions: {
      like: row.LikeCount, love: row.LoveCount, haha: row.HahaCount,
      wow: row.WowCount, sad: row.SadCount, angry: row.AngryCount
    }
  };
}

app.get('/api/mezmurs/:id/stats', async (req, res) => {
  try {
    const pool = await getPool();
    const request = pool.request();
    request.input('Id', sql.NVarChar(400), req.params.id);
    const result = await request.query(`
      SELECT ViewCount, LikeCount, LoveCount, HahaCount, WowCount, SadCount, AngryCount
      FROM dbo.Songs WHERE Id = @Id
    `);
    if (!result.recordset.length) return res.status(404).json({ error: 'Song not found' });
    res.json(statsFromRow(result.recordset[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mezmurs/:id/view', async (req, res) => {
  try {
    const pool = await getPool();
    const request = pool.request();
    request.input('Id', sql.NVarChar(400), req.params.id);
    const result = await request.query(`
      UPDATE dbo.Songs SET ViewCount = ViewCount + 1
      OUTPUT inserted.ViewCount, inserted.LikeCount, inserted.LoveCount, inserted.HahaCount, inserted.WowCount, inserted.SadCount, inserted.AngryCount
      WHERE Id = @Id
    `);
    if (!result.recordset.length) return res.status(404).json({ error: 'Song not found' });
    res.json(statsFromRow(result.recordset[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mezmurs/:id/react', async (req, res) => {
  const type = req.body?.type;
  const column = REACTION_COLUMNS[type];
  if (!column) return res.status(400).json({ error: 'Invalid reaction type' });
  try {
    const pool = await getPool();
    const request = pool.request();
    request.input('Id', sql.NVarChar(400), req.params.id);
    const result = await request.query(`
      UPDATE dbo.Songs SET ${column} = ${column} + 1
      OUTPUT inserted.ViewCount, inserted.LikeCount, inserted.LoveCount, inserted.HahaCount, inserted.WowCount, inserted.SadCount, inserted.AngryCount
      WHERE Id = @Id
    `);
    if (!result.recordset.length) return res.status(404).json({ error: 'Song not found' });
    res.json(statsFromRow(result.recordset[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/mezmurs/:id/comments', async (req, res) => {
  try {
    const pool = await getPool();
    const request = pool.request();
    request.input('Id', sql.NVarChar(400), req.params.id);
    const result = await request.query(`
      SELECT Id, Author, Comment, CreatedAt FROM dbo.SongComments WHERE SongId = @Id ORDER BY CreatedAt DESC
    `);
    res.json(result.recordset.map(r => ({ id: r.Id, author: r.Author, comment: r.Comment, createdAt: r.CreatedAt })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mezmurs/:id/comments', async (req, res) => {
  const author = (req.body?.author || '').toString().trim().slice(0, 200) || 'Anonymous';
  const comment = (req.body?.comment || '').toString().trim().slice(0, 2000);
  if (!comment) return res.status(400).json({ error: 'Comment text is required' });
  try {
    const pool = await getPool();
    const songCheck = pool.request();
    songCheck.input('Id', sql.NVarChar(400), req.params.id);
    const songExists = await songCheck.query('SELECT 1 FROM dbo.Songs WHERE Id = @Id');
    if (!songExists.recordset.length) return res.status(404).json({ error: 'Song not found' });

    const request = pool.request();
    request.input('SongId', sql.NVarChar(400), req.params.id);
    request.input('Author', sql.NVarChar(200), author);
    request.input('Comment', sql.NVarChar(2000), comment);
    const result = await request.query(`
      INSERT INTO dbo.SongComments (SongId, Author, Comment)
      OUTPUT inserted.Id, inserted.Author, inserted.Comment, inserted.CreatedAt
      VALUES (@SongId, @Author, @Comment)
    `);
    const row = result.recordset[0];
    res.json({ id: row.Id, author: row.Author, comment: row.Comment, createdAt: row.CreatedAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/mezmurs/:id/youtube', async (req, res) => {
  try {
    const pool = await getPool();
    const lookup = pool.request();
    lookup.input('Id', sql.NVarChar(400), req.params.id);
    const found = await lookup.query(`
      SELECT s.Title, s.Lyrics, s.YoutubeVideoId, sg.Name AS Singer
      FROM dbo.Songs s
      JOIN dbo.Singers sg ON s.SingerId = sg.Id
      WHERE s.Id = @Id
    `);
    if (!found.recordset.length) return res.status(404).json({ error: 'Song not found' });
    const song = found.recordset[0];

    // Already resolved (empty string means "searched, nothing found" - don't retry).
    if (song.YoutubeVideoId !== null) {
      return res.json({ videoId: song.YoutubeVideoId || null, configured: true });
    }

    if (!process.env.YOUTUBE_API_KEY) {
      return res.json({ videoId: null, configured: false });
    }

    const query = `${song.Singer} ${firstLyricLines(song.Lyrics, 7)}`;
    const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${encodeURIComponent(query)}&key=${process.env.YOUTUBE_API_KEY}`;
    const ytRes = await fetch(apiUrl);
    const ytData = await ytRes.json();
    if (!ytRes.ok) {
      console.error('YouTube API error:', ytData.error?.message || ytRes.status);
      return res.json({ videoId: null, configured: true, error: ytData.error?.message });
    }
    const videoId = ytData.items?.[0]?.id?.videoId || '';

    const save = pool.request();
    save.input('Id', sql.NVarChar(400), req.params.id);
    save.input('VideoId', sql.NVarChar(20), videoId);
    await save.query('UPDATE dbo.Songs SET YoutubeVideoId = @VideoId WHERE Id = @Id');

    res.json({ videoId: videoId || null, configured: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/mezmurs/:id', requireAdmin, async (req, res) => {
  try {
    const pool = await getPool();
    const request = pool.request();
    request.input('Id', sql.NVarChar(400), req.params.id);
    await request.query('DELETE FROM dbo.Songs WHERE Id = @Id');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Mezmurify server running at http://localhost:${PORT}`));
