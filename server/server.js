require('dotenv').config();
const path = require('path');
const express = require('express');
const postgres = require('postgres');
const { requireSupabaseUser, verifySupabaseToken } = require('./lib/supabaseAuth');
const { getDriveClient } = require('./lib/googleDrive');
const { buildOpenSongXml } = require('./lib/openSongXml');
const { buildSlideGroup, buildTodaySetXml } = require('./lib/openSongSet');
const { buildLyricsAndFormat } = require('./lib/lyricsFormat');

const app = express();
const PORT = process.env.PORT || 3000;

const db = postgres(process.env.DATABASE_URL, { ssl: 'require' });

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

// Emails in ADMIN_EMAILS get admin rights on the web app just by signing in with Google -
// there is no separate admin password.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

async function isAdminRequest(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || !ADMIN_EMAILS.length) return false;
  try {
    const payload = await verifySupabaseToken(token);
    return !!payload.email && ADMIN_EMAILS.includes(payload.email.toLowerCase());
  } catch {
    return false;
  }
}

function requireAdmin(req, res, next) {
  isAdminRequest(req).then(ok => {
    if (!ok) return res.status(401).json({ error: 'Not signed in as admin' });
    next();
  });
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/pptxgenjs', express.static(path.join(__dirname, 'node_modules/pptxgenjs/dist')));
app.use('/vendor/jszip', express.static(path.join(__dirname, 'node_modules/jszip/dist')));

// mezmurify.com is fronted by a Hostinger CDN that was caching API responses (observed:
// identical body/ETag/Date across requests with different bearer tokens on the export-drive
// endpoint, meaning every caller got the first response verbatim). API responses are
// per-request/per-user and must never be cached by an intermediary.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.get('/api/admin/status', async (req, res) => {
  res.json({ isAdmin: await isAdminRequest(req) });
});

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

app.get('/api/mezmurs', async (req, res) => {
  try {
    const rows = await db`
      SELECT s.id, s.open_song_id, sg.id AS singer_id, sg.name AS singer, sg.amharic_name AS singer_amharic,
             s.title, s.lyrics, s.language, s.open_song_format, s.youtube_video_id, s.media_url
      FROM songs s
      JOIN singers sg ON s.singer_id = sg.id
      ORDER BY sg.name, s.title
    `;
    res.json(rows.map(r => ({ id: r.id, openSongId: r.open_song_id, singerId: r.singer_id, singer: r.singer, singerAmharic: r.singer_amharic, title: r.title, lyrics: r.lyrics, language: r.language, openSongFormat: r.open_song_format, youtubeVideoId: r.youtube_video_id, mediaUrl: r.media_url })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mezmurs', requireAdmin, async (req, res) => {
  const songs = Array.isArray(req.body?.songs) ? req.body.songs : [];
  if (!songs.length) return res.status(400).json({ error: 'No songs provided' });
  try {
    await db.begin(async tx => {
      const singerIdCache = new Map();
      let nextOpenSongId = null;
      for (const song of songs) {
        let singerId = singerIdCache.get(song.singer);
        if (singerId === undefined) {
          singerId = await upsertSinger(tx, song.singer);
          singerIdCache.set(song.singer, singerId);
        }
        const id = `${slugify(song.singer)}__${slugify(song.title)}`;
        const language = song.language || detectLanguage(song.title, song.lyrics);
        const { lyrics, openSongFormat } = buildLyricsAndFormat(song.lyrics);

        let openSongId = song.openSongId || song.OpenSongID || null;
        if (openSongId == null) {
          // No ID supplied (e.g. the "Add Song" form) - keep an existing song's current
          // ID untouched, or hand a brand-new song the next free number in sequence.
          const existing = await tx`SELECT open_song_id FROM songs WHERE id = ${id}`;
          if (existing.length) {
            openSongId = existing[0].open_song_id;
          } else {
            if (nextOpenSongId === null) {
              const [{ max_id }] = await tx`SELECT MAX(open_song_id) AS max_id FROM songs`;
              nextOpenSongId = (max_id || 0) + 1;
            }
            openSongId = nextOpenSongId++;
          }
        }

        await tx`
          INSERT INTO songs (id, singer_id, title, lyrics, language, open_song_id, open_song_format)
          VALUES (${id}, ${singerId}, ${song.title}, ${lyrics}, ${language}, ${openSongId}, ${openSongFormat})
          ON CONFLICT (id) DO UPDATE SET
            singer_id = EXCLUDED.singer_id, title = EXCLUDED.title, lyrics = EXCLUDED.lyrics,
            language = EXCLUDED.language, open_song_id = EXCLUDED.open_song_id, open_song_format = EXCLUDED.open_song_format
        `;
      }
    });
    res.json({ ok: true, count: songs.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/singers', async (req, res) => {
  try {
    const rows = await db`SELECT id, name, amharic_name FROM singers ORDER BY name`;
    res.json(rows.map(r => ({ id: r.id, name: r.name, amharicName: r.amharic_name })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/singers', requireAdmin, async (req, res) => {
  const name = (req.body?.name || '').toString().trim();
  const amharicName = (req.body?.amharicName || '').toString().trim() || null;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const rows = await db`
      INSERT INTO singers (name, amharic_name) VALUES (${name}, ${amharicName})
      RETURNING id, name, amharic_name
    `;
    res.json({ id: rows[0].id, name: rows[0].name, amharicName: rows[0].amharic_name });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A singer with that name already exists' });
    }
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/singers/:id', requireAdmin, async (req, res) => {
  const name = (req.body?.name || '').toString().trim();
  const amharicName = (req.body?.amharicName || '').toString().trim() || null;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const result = await db`
      UPDATE singers SET name = ${name}, amharic_name = ${amharicName} WHERE id = ${Number(req.params.id)}
    `;
    if (!result.count) return res.status(404).json({ error: 'Singer not found' });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') {
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
    const existing = await db`SELECT singer_id FROM songs WHERE id = ${req.params.id}`;
    if (!existing.length) return res.status(404).json({ error: 'Song not found' });
    const finalSingerId = singerId || existing[0].singer_id;
    const finalLanguage = language || detectLanguage(title, rawLyrics);
    const { lyrics, openSongFormat } = buildLyricsAndFormat(rawLyrics);

    await db`
      UPDATE songs SET singer_id = ${finalSingerId}, title = ${title}, lyrics = ${lyrics}, language = ${finalLanguage},
        open_song_format = ${openSongFormat}, youtube_video_id = ${youtubeVideoId}, media_url = ${mediaUrl}
      WHERE id = ${req.params.id}
    `;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const REACTION_COLUMNS = { like: 'like_count', love: 'love_count', haha: 'haha_count', wow: 'wow_count', sad: 'sad_count', angry: 'angry_count' };

function statsFromRow(row) {
  return {
    viewCount: row.view_count,
    reactions: {
      like: row.like_count, love: row.love_count, haha: row.haha_count,
      wow: row.wow_count, sad: row.sad_count, angry: row.angry_count
    }
  };
}

app.get('/api/mezmurs/:id/stats', async (req, res) => {
  try {
    const rows = await db`
      SELECT view_count, like_count, love_count, haha_count, wow_count, sad_count, angry_count
      FROM songs WHERE id = ${req.params.id}
    `;
    if (!rows.length) return res.status(404).json({ error: 'Song not found' });
    res.json(statsFromRow(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mezmurs/:id/view', async (req, res) => {
  try {
    const rows = await db`
      UPDATE songs SET view_count = view_count + 1
      WHERE id = ${req.params.id}
      RETURNING view_count, like_count, love_count, haha_count, wow_count, sad_count, angry_count
    `;
    if (!rows.length) return res.status(404).json({ error: 'Song not found' });
    res.json(statsFromRow(rows[0]));
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
    // column is only ever one of the fixed REACTION_COLUMNS values above, never user input.
    const rows = await db.unsafe(`
      UPDATE songs SET ${column} = ${column} + 1
      WHERE id = $1
      RETURNING view_count, like_count, love_count, haha_count, wow_count, sad_count, angry_count
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Song not found' });
    res.json(statsFromRow(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/mezmurs/:id/comments', async (req, res) => {
  try {
    const rows = await db`
      SELECT id, author, comment, created_at FROM song_comments WHERE song_id = ${req.params.id} ORDER BY created_at DESC
    `;
    res.json(rows.map(r => ({ id: r.id, author: r.author, comment: r.comment, createdAt: r.created_at })));
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
    const songExists = await db`SELECT 1 FROM songs WHERE id = ${req.params.id}`;
    if (!songExists.length) return res.status(404).json({ error: 'Song not found' });

    const rows = await db`
      INSERT INTO song_comments (song_id, author, comment)
      VALUES (${req.params.id}, ${author}, ${comment})
      RETURNING id, author, comment, created_at
    `;
    const row = rows[0];
    res.json({ id: row.id, author: row.author, comment: row.comment, createdAt: row.created_at });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drive-exports', async (req, res) => {
  try {
    const drive = getDriveClient();
    const result = await drive.files.list({
      q: `'${process.env.GOOGLE_DRIVE_FOLDER_ID}' in parents and trashed = false`,
      orderBy: 'createdTime desc',
      fields: 'files(id, name, webViewLink, createdTime)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    res.json(result.data.files ?? []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Matches the <root folder>/<Singer>/<OpenSongID>_<Title>.txt layout used by the bulk
// export scripts (export-all-to-drive.js, refresh-drive-exports.js), so a single-song
// export from the web app lands next to - and is recognized as a re-export of - files
// created by those scripts rather than piling up flat duplicates in the root folder.
function escapeForDriveQuery(name) {
  return name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findOrCreateDriveFolder(drive, name, parentId) {
  const escaped = escapeForDriveQuery(name);
  const list = await drive.files.list({
    q: `'${parentId}' in parents and name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (list.data.files && list.data.files.length) return list.data.files[0].id;

  const created = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    supportsAllDrives: true,
    fields: 'id',
  });
  return created.data.id;
}

async function findDriveFile(drive, name, parentId) {
  const escaped = escapeForDriveQuery(name);
  const list = await drive.files.list({
    q: `'${parentId}' in parents and name = '${escaped}' and trashed = false`,
    fields: 'files(id)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return list.data.files && list.data.files[0] ? list.data.files[0].id : null;
}

app.post('/api/mezmurs/:id/export-drive', requireSupabaseUser, async (req, res) => {
  try {
    const rows = await db`
      SELECT s.title, s.open_song_id, s.open_song_format, sg.name AS singer_name
      FROM songs s
      JOIN singers sg ON s.singer_id = sg.id
      WHERE s.id = ${req.params.id}
    `;
    if (!rows.length) return res.status(404).json({ error: 'Song not found' });
    const { title, open_song_id, open_song_format, singer_name } = rows[0];
    const xml = buildOpenSongXml({ title, singerName: singer_name, openSongId: open_song_id, lyricsBody: open_song_format });
    const fileName = `${open_song_id}_${title}.txt`;

    const drive = getDriveClient();
    const folderId = await findOrCreateDriveFolder(drive, singer_name, process.env.GOOGLE_DRIVE_FOLDER_ID);
    const existingFileId = await findDriveFile(drive, fileName, folderId);

    if (existingFileId) {
      await drive.files.delete({ fileId: existingFileId, supportsAllDrives: true });
    }
    const file = await drive.files.create({
      requestBody: { name: fileName, parents: [folderId] },
      media: { mimeType: 'text/plain', body: xml },
      supportsAllDrives: true,
      fields: 'id, webViewLink',
    });

    const slideGroup = buildSlideGroup({ openSongId: open_song_id, title, singerName: singer_name });
    const todayFolderId = process.env.GOOGLE_DRIVE_TODAY_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID;
    const todayFileId = await findDriveFile(drive, 'Today.txt', todayFolderId);
    let existingTodayXml = '';
    if (todayFileId) {
      const existing = await drive.files.get({ fileId: todayFileId, alt: 'media' }, { responseType: 'text' });
      existingTodayXml = existing.data;
    }
    const todayXml = buildTodaySetXml(existingTodayXml, slideGroup);
    if (todayFileId) {
      await drive.files.update({
        fileId: todayFileId,
        media: { mimeType: 'text/plain', body: todayXml },
        supportsAllDrives: true,
      });
    } else {
      await drive.files.create({
        requestBody: { name: 'Today.txt', parents: [todayFolderId] },
        media: { mimeType: 'text/plain', body: todayXml },
        supportsAllDrives: true,
        fields: 'id',
      });
    }

    res.json({ ok: true, fileId: file.data.id, webViewLink: file.data.webViewLink, updated: !!existingFileId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/mezmurs/:id/youtube', async (req, res) => {
  try {
    const found = await db`
      SELECT s.title, s.lyrics, s.youtube_video_id, sg.name AS singer
      FROM songs s
      JOIN singers sg ON s.singer_id = sg.id
      WHERE s.id = ${req.params.id}
    `;
    if (!found.length) return res.status(404).json({ error: 'Song not found' });
    const song = found[0];

    // Already resolved (empty string means "searched, nothing found" - don't retry).
    if (song.youtube_video_id !== null) {
      return res.json({ videoId: song.youtube_video_id || null, configured: true });
    }

    if (!process.env.YOUTUBE_API_KEY) {
      return res.json({ videoId: null, configured: false });
    }

    const query = `${song.singer} ${firstLyricLines(song.lyrics, 7)}`;
    const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${encodeURIComponent(query)}&key=${process.env.YOUTUBE_API_KEY}`;
    const ytRes = await fetch(apiUrl);
    const ytData = await ytRes.json();
    if (!ytRes.ok) {
      console.error('YouTube API error:', ytData.error?.message || ytRes.status);
      return res.json({ videoId: null, configured: true, error: ytData.error?.message });
    }
    const videoId = ytData.items?.[0]?.id?.videoId || '';

    await db`UPDATE songs SET youtube_video_id = ${videoId} WHERE id = ${req.params.id}`;

    res.json({ videoId: videoId || null, configured: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/mezmurs/:id', requireAdmin, async (req, res) => {
  try {
    await db`DELETE FROM songs WHERE id = ${req.params.id}`;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Mezmurify server running at http://localhost:${PORT}`));
