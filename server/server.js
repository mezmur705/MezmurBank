require('dotenv').config();
const path = require('path');
const express = require('express');
const postgres = require('postgres');
const { requireSupabaseUser, verifySupabaseToken } = require('./lib/supabaseAuth');
const { getDriveClient } = require('./lib/googleDrive');
const { buildOpenSongXml } = require('./lib/openSongXml');
const { buildSlideGroup, buildSetXml } = require('./lib/openSongSet');
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
             s.title, s.lyrics, s.language, s.open_song_format, s.youtube_video_id, s.media_url,
             s.source_name, s.source_url, s.created_at
      FROM songs s
      JOIN singers sg ON s.singer_id = sg.id
      ORDER BY sg.name, s.title
    `;
    res.json(rows.map(r => ({ id: r.id, openSongId: r.open_song_id, singerId: r.singer_id, singer: r.singer, singerAmharic: r.singer_amharic, title: r.title, lyrics: r.lyrics, language: r.language, openSongFormat: r.open_song_format, youtubeVideoId: r.youtube_video_id, mediaUrl: r.media_url, sourceName: r.source_name, sourceUrl: r.source_url, createdAt: r.created_at })));
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

// "Exported Files" in the account menu is meant to show the Sunday set files
// (named YYYY-MM-DD.txt by regenerateSundaySetFile) - not the per-singer folders
// that per-song Drive exports create in GOOGLE_DRIVE_FOLDER_ID, and not whatever
// unrelated legacy content also happens to sit in the same folder.
const SUNDAY_FILE_NAME_RE = /^\d{4}-\d{2}-\d{2}\.txt$/;

app.get('/api/drive-exports', async (req, res) => {
  try {
    const drive = getDriveClient();
    const folderId = process.env.GOOGLE_DRIVE_TODAY_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID;
    const result = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      orderBy: 'createdTime desc',
      fields: 'files(id, name, webViewLink, createdTime)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const files = (result.data.files ?? []).filter(f => SUNDAY_FILE_NAME_RE.test(f.name));
    res.json(files);
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

// The upcoming Sunday's set file is named by that Sunday's date - if today is
// already Sunday, that counts as the "next possible Sunday" rather than rolling
// over to the following week.
function nextSundayDate(from = new Date()) {
  const d = new Date(from);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? 0 : 7 - day));
  return d.toISOString().slice(0, 10);
}

// A signed-in user can add to the nearest upcoming Sunday's list; only an admin can
// target a specific date further out, and only within the next month.
function isValidSundayWithinMonth(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.getUTCDay() !== 0) return false;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const max = new Date(today);
  max.setUTCDate(max.getUTCDate() + 31);
  return d >= today && d <= max;
}

async function regenerateSundaySetFile(drive, dateStr) {
  const rows = await db`
    SELECT s.title, s.open_song_id, sg.name AS singer_name
    FROM sunday_songs ss
    JOIN songs s ON s.id = ss.song_id
    JOIN singers sg ON sg.id = s.singer_id
    WHERE ss.sunday_date = ${dateStr}
    ORDER BY ss.position
  `;
  const xml = buildSetXml(dateStr, rows.map(r => ({ openSongId: r.open_song_id, title: r.title, singerName: r.singer_name })));
  const folderId = process.env.GOOGLE_DRIVE_TODAY_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID;
  const fileName = `${dateStr}.txt`;
  const existingId = await findDriveFile(drive, fileName, folderId);
  if (existingId) {
    await drive.files.update({ fileId: existingId, media: { mimeType: 'text/plain', body: xml }, supportsAllDrives: true });
  } else {
    await drive.files.create({
      requestBody: { name: fileName, parents: [folderId] },
      media: { mimeType: 'text/plain', body: xml },
      supportsAllDrives: true,
      fields: 'id',
    });
  }
  return dateStr;
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

    // Adding to the Sunday set is best-effort - a failure here (e.g. a transient Drive
    // error) must not make the browser think the song file itself failed to export.
    // Non-admins can add songs any day through the target Sunday itself; once that day
    // has passed (Monday onward), the set is considered final until admin reopens it,
    // so only an admin can still add to it.
    let sundayDate = null;
    let sundayError = null;
    try {
      const targetDate = nextSundayDate();
      const alreadyOnSunday = await db`SELECT 1 FROM sunday_songs WHERE song_id = ${req.params.id} AND sunday_date = ${targetDate}`;
      const isSundayToday = new Date().getUTCDay() === 0;
      if (!alreadyOnSunday.length && !isSundayToday && !(await isAdminRequest(req))) {
        sundayError = 'The Sunday Songs list is locked until next Sunday - ask an admin to add this song.';
      } else {
        if (!alreadyOnSunday.length) {
          const [{ max_pos }] = await db`SELECT COALESCE(MAX(position), 0) AS max_pos FROM sunday_songs WHERE sunday_date = ${targetDate}`;
          await db`INSERT INTO sunday_songs (song_id, sunday_date, position) VALUES (${req.params.id}, ${targetDate}, ${max_pos + 1})`;
        }
        sundayDate = await regenerateSundaySetFile(drive, targetDate);
      }
    } catch (sundayErr) {
      console.error('Sunday set update failed:', sundayErr);
      sundayError = sundayErr.message;
    }

    res.json({ ok: true, fileId: file.data.id, webViewLink: file.data.webViewLink, updated: !!existingFileId, sundayDate, sundayError });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Admin-only: add a song directly to a specific upcoming Sunday's list (up to a month
// out), for planning ahead rather than only ever adding to the nearest Sunday.
app.post('/api/sunday-songs', requireAdmin, async (req, res) => {
  const { songId, date } = req.body || {};
  if (!songId || !isValidSundayWithinMonth(date)) {
    return res.status(400).json({ error: 'songId and a Sunday date within the next month are required' });
  }
  try {
    const song = await db`SELECT 1 FROM songs WHERE id = ${songId}`;
    if (!song.length) return res.status(404).json({ error: 'Song not found' });
    const already = await db`SELECT 1 FROM sunday_songs WHERE song_id = ${songId} AND sunday_date = ${date}`;
    if (!already.length) {
      const [{ max_pos }] = await db`SELECT COALESCE(MAX(position), 0) AS max_pos FROM sunday_songs WHERE sunday_date = ${date}`;
      await db`INSERT INTO sunday_songs (song_id, sunday_date, position) VALUES (${songId}, ${date}, ${max_pos + 1})`;
    }
    await regenerateSundaySetFile(getDriveClient(), date);
    res.json({ ok: true, date });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sunday-songs', async (req, res) => {
  try {
    const date = isValidSundayWithinMonth(req.query.date) ? req.query.date : nextSundayDate();
    const rows = await db`
      SELECT ss.song_id, ss.position, s.title, s.open_song_id, sg.name AS singer_name
      FROM sunday_songs ss
      JOIN songs s ON s.id = ss.song_id
      JOIN singers sg ON sg.id = s.singer_id
      WHERE ss.sunday_date = ${date}
      ORDER BY ss.position
    `;
    res.json({
      date,
      songs: rows.map(r => ({ songId: r.song_id, position: r.position, title: r.title, openSongId: r.open_song_id, singer: r.singer_name })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/sunday-songs/order', requireAdmin, async (req, res) => {
  const songIds = Array.isArray(req.body?.songIds) ? req.body.songIds : [];
  const date = isValidSundayWithinMonth(req.body?.date) ? req.body.date : nextSundayDate();
  if (!songIds.length) return res.status(400).json({ error: 'songIds is required' });
  try {
    const current = await db`SELECT song_id FROM sunday_songs WHERE sunday_date = ${date}`;
    const currentIds = new Set(current.map(r => r.song_id));
    if (songIds.length !== currentIds.size || !songIds.every(id => currentIds.has(id))) {
      return res.status(400).json({ error: 'songIds must match the current Sunday set exactly' });
    }
    await db.begin(async tx => {
      for (let i = 0; i < songIds.length; i++) {
        await tx`UPDATE sunday_songs SET position = ${i + 1} WHERE song_id = ${songIds[i]} AND sunday_date = ${date}`;
      }
    });
    await regenerateSundaySetFile(getDriveClient(), date);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sunday-songs/:songId', requireAdmin, async (req, res) => {
  const date = isValidSundayWithinMonth(req.query.date) ? req.query.date : nextSundayDate();
  try {
    await db.begin(async tx => {
      await tx`DELETE FROM sunday_songs WHERE song_id = ${req.params.songId} AND sunday_date = ${date}`;
      const remaining = await tx`SELECT song_id FROM sunday_songs WHERE sunday_date = ${date} ORDER BY position`;
      for (let i = 0; i < remaining.length; i++) {
        await tx`UPDATE sunday_songs SET position = ${i + 1} WHERE song_id = ${remaining[i].song_id} AND sunday_date = ${date}`;
      }
    });
    await regenerateSundaySetFile(getDriveClient(), date);
    res.json({ ok: true });
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
