require('dotenv').config();
const path = require('path');
const express = require('express');
const postgres = require('postgres');
const zlib = require('zlib');
const { promisify } = require('util');
const gzipAsync = promisify(zlib.gzip);
const { verifySupabaseToken } = require('./lib/supabaseAuth');
const { getDriveClient } = require('./lib/googleDrive');
const { buildOpenSongXml } = require('./lib/openSongXml');
const { buildSlideGroup, buildSetXml } = require('./lib/openSongSet');
const { buildSundayHtml } = require('./lib/sundayHtml');
const { buildLyricsAndFormat } = require('./lib/lyricsFormat');
const { sendNotificationEmail } = require('./lib/mailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Render sits behind its own proxy (and Cloudflare in front of that), so without this,
// req.ip resolves to the proxy's internal address instead of the real caller - trust the
// X-Forwarded-For chain so req.ip is the actual visitor (used for the YouTube-link-change
// notification email below; nothing security-sensitive keys off req.ip).
app.set('trust proxy', true);

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
// Parenthetical repeat/ad-lib markers (e.g. "(2x)", "(እህህ)") are stripped and the line count
// kept short - a long, noisy query matches nothing on YouTube even when the video exists.
function firstLyricLines(lyrics, count) {
  return (lyrics || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/^\[[^\]]*\]$/.test(line))
    .map(line => line.replace(/\([^)]*\)/g, '').trim())
    .filter(Boolean)
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
function parseEmailList(value) {
  return (value || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}
const ADMIN_EMAILS = parseEmailList(process.env.ADMIN_EMAILS);

async function requestEmail(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const payload = await verifySupabaseToken(token);
    return payload.email ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function isAdminRequest(req) {
  if (!ADMIN_EMAILS.length) return false;
  const email = await requestEmail(req);
  return !!email && ADMIN_EMAILS.includes(email);
}

// Admins can do everything; other signed-in users get whatever an admin granted their email
// on the Manage Access page (user_permissions table).
async function getPermissions(req) {
  const email = await requestEmail(req);
  if (!email) return { email: null, isAdmin: false, canAddSongs: false, canEditSongs: false, canAddSingers: false, canExport: false };
  if (ADMIN_EMAILS.includes(email)) return { email, isAdmin: true, canAddSongs: true, canEditSongs: true, canAddSingers: true, canExport: true };
  const rows = await db`SELECT can_add_songs, can_edit_songs, can_add_singers, can_export FROM user_permissions WHERE email = ${email}`;
  const row = rows[0];
  return {
    email,
    isAdmin: false,
    canAddSongs: !!row?.can_add_songs,
    canEditSongs: !!row?.can_edit_songs,
    canAddSingers: !!row?.can_add_singers,
    canExport: !!row?.can_export,
  };
}

function requireAdmin(req, res, next) {
  isAdminRequest(req).then(ok => {
    if (!ok) return res.status(401).json({ error: 'Not signed in as admin' });
    next();
  });
}

const PERMISSION_LABELS = { canAddSongs: 'add songs', canEditSongs: 'edit songs', canAddSingers: 'add singers', canExport: 'export to OpenSong' };

// Leaves the caller's permissions on req.permissions for routes that need finer checks.
function requirePermission(name) {
  return (req, res, next) => {
    getPermissions(req)
      .then(permissions => {
        if (!permissions[name]) {
          return res.status(403).json({ error: `Your account is not allowed to ${PERMISSION_LABELS[name]}. Ask an admin for access.` });
        }
        req.permissions = permissions;
        next();
      })
      .catch(err => {
        console.error(err);
        res.status(500).json({ error: err.message });
      });
  };
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
  try {
    const { isAdmin, canAddSongs, canEditSongs, canAddSingers, canExport } = await getPermissions(req);
    res.json({ isAdmin, canAddSongs, canEditSongs, canAddSingers, canExport });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function permissionRowToJson(r) {
  return { email: r.email, canAddSongs: r.can_add_songs, canEditSongs: r.can_edit_songs, canAddSingers: r.can_add_singers, canExport: r.can_export };
}

app.get('/api/admin/permissions', requireAdmin, async (req, res) => {
  try {
    const rows = await db`SELECT email, can_add_songs, can_edit_songs, can_add_singers, can_export FROM user_permissions ORDER BY email`;
    res.json(rows.map(permissionRowToJson));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/permissions', requireAdmin, async (req, res) => {
  const email = (req.body?.email || '').toString().trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  const canAddSongs = !!req.body?.canAddSongs;
  const canEditSongs = !!req.body?.canEditSongs;
  const canAddSingers = !!req.body?.canAddSingers;
  const canExport = !!req.body?.canExport;
  try {
    const rows = await db`
      INSERT INTO user_permissions (email, can_add_songs, can_edit_songs, can_add_singers, can_export)
      VALUES (${email}, ${canAddSongs}, ${canEditSongs}, ${canAddSingers}, ${canExport})
      ON CONFLICT (email) DO UPDATE SET
        can_add_songs = EXCLUDED.can_add_songs, can_edit_songs = EXCLUDED.can_edit_songs,
        can_add_singers = EXCLUDED.can_add_singers, can_export = EXCLUDED.can_export
      RETURNING email, can_add_songs, can_edit_songs, can_add_singers, can_export
    `;
    res.json(permissionRowToJson(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/permissions/:email', requireAdmin, async (req, res) => {
  try {
    await db`DELETE FROM user_permissions WHERE email = ${req.params.email.toLowerCase()}`;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
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

// The full song list (with lyrics) is ~12 MB, and every web/mobile load used to pull it from
// Supabase again - enough to blow through the free plan's egress quota. So it's kept in
// memory as the ready-to-send JSON (plus a pre-gzipped copy - ~12 MB shrinks to a fraction,
// compressed once here rather than per request) and only re-fetched after a write or once the TTL
// lapses (the TTL covers the import/maintenance scripts, which write to the DB directly and
// bypass this server, so it bounds how stale the list can get).
const MEZMURS_CACHE_TTL_MS = 15 * 60 * 1000;
let mezmursCache = { entry: null, loadedAt: 0, version: 0, pending: null, pendingVersion: 0 };

function invalidateMezmursCache() {
  mezmursCache.version++;
  mezmursCache.entry = null;
}

// Any successful write invalidates the cache - except these, which never touch the data
// /api/mezmurs returns and happen constantly (invalidating on them would defeat the cache).
const NON_INVALIDATING_WRITES = /^\/mezmurs\/[^/]+\/(view|react|comments)$/;
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && !NON_INVALIDATING_WRITES.test(req.path)) {
    // On 'finish' (not up front) so a concurrent read can't re-cache the pre-write data
    // after we've cleared it.
    // Only on success: a rejected write (401/400...) changed nothing, and unauthenticated
    // callers must not be able to keep busting the cache by spamming failing requests.
    res.on('finish', () => { if (res.statusCode < 400) invalidateMezmursCache(); });
  }
  next();
});

async function loadMezmursEntry() {
  // LEFT JOIN (not JOIN) so a singer with no songs yet - e.g. one just added via "Add
  // Singer" - still gets a row and shows up in the app instead of being invisible until
  // their first song is saved.
  const rows = await db`
    SELECT sg.id AS singer_id, sg.name AS singer, sg.amharic_name AS singer_amharic,
           s.id, s.open_song_id, s.title, s.lyrics, s.language, s.open_song_format,
           s.youtube_video_id, s.media_url, s.source_name, s.source_url, s.created_at
    FROM singers sg
    LEFT JOIN songs s ON s.singer_id = sg.id
    ORDER BY (sg.name = 'main'), sg.name, s.title
  `;
  const raw = Buffer.from(JSON.stringify(rows.map(r => ({ id: r.id, openSongId: r.open_song_id, singerId: r.singer_id, singer: r.singer, singerAmharic: r.singer_amharic, title: r.title, lyrics: r.lyrics, language: r.language, openSongFormat: r.open_song_format, youtubeVideoId: r.youtube_video_id, mediaUrl: r.media_url, sourceName: r.source_name, sourceUrl: r.source_url, createdAt: r.created_at }))));
  return { raw, gzip: await gzipAsync(raw) };
}

async function getMezmursEntry() {
  const cache = mezmursCache;
  if (cache.entry && Date.now() - cache.loadedAt < MEZMURS_CACHE_TTL_MS) return cache.entry;
  // Concurrent requests during a reload share one query instead of each hitting Supabase.
  // A pending query that started before a write is stale - don't let post-write requests join it.
  if (!cache.pending || cache.pendingVersion !== cache.version) {
    const startVersion = cache.version;
    const pending = loadMezmursEntry().then(entry => {
      // A write landed while we were querying - serve this result once, but don't keep it.
      if (cache.version === startVersion) {
        cache.entry = entry;
        cache.loadedAt = Date.now();
      }
      return entry;
    }).finally(() => { if (cache.pending === pending) cache.pending = null; });
    cache.pending = pending;
    cache.pendingVersion = startVersion;
  }
  return cache.pending;
}

app.get('/api/mezmurs', async (req, res) => {
  try {
    const { raw, gzip } = await getMezmursEntry();
    // Caches/CDNs in front must keep the plain and gzipped variants apart.
    res.set('Vary', 'Accept-Encoding').type('application/json');
    if (req.acceptsEncodings('gzip') === 'gzip') res.set('Content-Encoding', 'gzip').send(gzip);
    else res.send(raw);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Non-admins (granted "add songs" on the Manage Access page) can only create new songs: no
// overwriting an existing one, no picking OpenSong IDs, and a new singer only if they were
// also granted "add singers". Admins keep the old upsert behavior (used by folder upload).
class ForbiddenError extends Error {}

app.post('/api/mezmurs', requirePermission('canAddSongs'), async (req, res) => {
  const songs = Array.isArray(req.body?.songs) ? req.body.songs : [];
  if (!songs.length) return res.status(400).json({ error: 'No songs provided' });
  const { isAdmin, canAddSingers } = req.permissions;
  try {
    const savedIds = [];
    const createdSongs = [];
    await db.begin(async tx => {
      const singerIdCache = new Map();
      let nextOpenSongId = null;
      for (const song of songs) {
        let singerId = singerIdCache.get(song.singer);
        if (singerId === undefined) {
          if (!canAddSingers) {
            const found = await tx`SELECT id FROM singers WHERE lower(name) = lower(${song.singer})`;
            if (!found.length) throw new ForbiddenError(`Singer "${song.singer}" doesn't exist yet, and your account is not allowed to add singers. Ask an admin to add the singer first.`);
          }
          singerId = await upsertSinger(tx, song.singer);
          singerIdCache.set(song.singer, singerId);
        }
        const id = `${slugify(song.singer)}__${slugify(song.title)}`;
        const language = song.language || detectLanguage(song.title, song.lyrics);
        const { lyrics, openSongFormat } = buildLyricsAndFormat(song.lyrics);

        const existing = await tx`SELECT open_song_id FROM songs WHERE id = ${id}`;
        if (existing.length && !isAdmin) throw new ForbiddenError(`"${song.title}" by ${song.singer} already exists. Only an admin can change an existing song.`);
        if (!existing.length) createdSongs.push({ id, title: song.title, singer: song.singer });

        let openSongId = isAdmin ? (song.openSongId || song.OpenSongID || null) : null;
        if (openSongId == null) {
          // No ID supplied (e.g. the "Add Song" form) - keep an existing song's current
          // ID untouched, or hand a brand-new song the next free number in sequence.
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
        savedIds.push(id);
      }
    });
    res.json({ ok: true, count: songs.length });
    // Fired after responding - a slow/rate-limited Drive export must never delay saving.
    exportSongsToDriveInBackground(savedIds).catch(err => console.error('Background Drive export batch failed:', err));
    if (!isAdmin && createdSongs.length) {
      notifySongsAdded(req, req.permissions.email, createdSongs).catch(err => console.error('New-song email failed:', err));
    }
  } catch (err) {
    if (err instanceof ForbiddenError) return res.status(403).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/singers', async (req, res) => {
  try {
    const rows = await db`SELECT id, name, amharic_name FROM singers ORDER BY (name = 'main'), name`;
    res.json(rows.map(r => ({ id: r.id, name: r.name, amharicName: r.amharic_name })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/singers', requirePermission('canAddSingers'), async (req, res) => {
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

app.put('/api/mezmurs/:id', requirePermission('canEditSongs'), async (req, res) => {
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
    const existing = await db`
      SELECT s.singer_id, s.title, s.lyrics, s.language, s.youtube_video_id, s.media_url, sg.name AS singer_name
      FROM songs s JOIN singers sg ON sg.id = s.singer_id WHERE s.id = ${req.params.id}
    `;
    if (!existing.length) return res.status(404).json({ error: 'Song not found' });
    const finalSingerId = singerId || existing[0].singer_id;
    const finalLanguage = language || detectLanguage(title, rawLyrics);
    const { lyrics, openSongFormat } = buildLyricsAndFormat(rawLyrics);

    await db`
      UPDATE songs SET singer_id = ${finalSingerId}, title = ${title}, lyrics = ${lyrics}, language = ${finalLanguage},
        open_song_format = ${openSongFormat}, youtube_video_id = ${youtubeVideoId}, media_url = ${mediaUrl},
        youtube_candidates = NULL
      WHERE id = ${req.params.id}
    `;
    res.json({ ok: true });
    // Fired after responding - a slow/rate-limited Drive export must never delay saving.
    exportSongsToDriveInBackground([req.params.id]).catch(err => console.error('Background Drive export failed:', err));
    if (!req.permissions.isAdmin) {
      const before = existing[0];
      const changed = [
        before.title !== title && 'title',
        before.singer_id !== finalSingerId && 'singer',
        before.language !== finalLanguage && 'language',
        before.lyrics !== lyrics && 'lyrics',
        (before.youtube_video_id || null) !== (youtubeVideoId || null) && 'YouTube link',
        (before.media_url || null) !== mediaUrl && 'media link',
      ].filter(Boolean);
      notifySongEdited(req, req.permissions.email, req.params.id, before, title, changed).catch(err => console.error('Song-edit email failed:', err));
    }
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
  // Undoing a reaction (tapping the same emoji again) decrements instead of incrementing.
  // GREATEST floors at 0 so a stale/duplicate remove request can't push a count negative.
  const delta = req.body?.remove ? `GREATEST(${column} - 1, 0)` : `${column} + 1`;
  try {
    // column/delta are only ever built from the fixed REACTION_COLUMNS values above, never
    // user input directly.
    const rows = await db.unsafe(`
      UPDATE songs SET ${column} = ${delta}
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

// Exports a single song's OpenSong file to <GOOGLE_DRIVE_FOLDER_ID>/<Singer>/<OpenSongID>_<Title>.txt,
// replacing any existing file for that song. Shared by the manual "export to Drive" button and the
// automatic export triggered whenever a song is added or edited.
async function exportSongFileToDrive(drive, songId) {
  const rows = await db`
    SELECT s.title, s.open_song_id, s.open_song_format, sg.name AS singer_name
    FROM songs s
    JOIN singers sg ON s.singer_id = sg.id
    WHERE s.id = ${songId}
  `;
  if (!rows.length) return null;
  const { title, open_song_id, open_song_format, singer_name } = rows[0];
  const xml = buildOpenSongXml({ title, singerName: singer_name, openSongId: open_song_id, lyricsBody: open_song_format });
  const fileName = `${open_song_id}_${title}.txt`;

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
  return { fileId: file.data.id, webViewLink: file.data.webViewLink, updated: !!existingFileId };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fire-and-forget: exports each song's file one at a time (small delay between calls, same
// as export-all-to-drive.js) so saving many songs at once - e.g. the admin folder upload -
// doesn't fire an unbounded burst of Drive API calls or make the save request wait on Drive.
// Errors are logged, never thrown - a Drive hiccup must never be mistaken for a save failure.
async function exportSongsToDriveInBackground(songIds) {
  if (!process.env.GOOGLE_DRIVE_FOLDER_ID) return;
  const drive = getDriveClient();
  for (const songId of songIds) {
    try {
      await exportSongFileToDrive(drive, songId);
    } catch (err) {
      console.error(`Background Drive export failed for song "${songId}":`, err.message);
    }
    await sleep(150);
  }
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

async function upsertDriveFile(drive, fileName, folderId, mimeType, body) {
  const existingId = await findDriveFile(drive, fileName, folderId);
  if (existingId) {
    await drive.files.update({ fileId: existingId, media: { mimeType, body }, supportsAllDrives: true });
    return existingId;
  }
  const created = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body },
    supportsAllDrives: true,
    fields: 'id',
  });
  return created.data.id;
}

async function regenerateSundaySetFile(drive, dateStr) {
  const rows = await db`
    SELECT s.title, s.open_song_id, s.lyrics, s.youtube_video_id, sg.name AS singer_name
    FROM sunday_songs ss
    JOIN songs s ON s.id = ss.song_id
    JOIN singers sg ON sg.id = s.singer_id
    WHERE ss.sunday_date = ${dateStr}
    ORDER BY ss.position
  `;
  const xml = buildSetXml(dateStr, rows.map(r => ({ openSongId: r.open_song_id, title: r.title, singerName: r.singer_name })));
  const folderId = process.env.GOOGLE_DRIVE_TODAY_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID;
  await upsertDriveFile(drive, `${dateStr}.txt`, folderId, 'text/plain', xml);

  // Offline lyrics handout next to the OpenSong set - best-effort, so a failure here never
  // blocks the set file the projector depends on.
  try {
    const html = buildSundayHtml(dateStr, rows.map(r => ({
      openSongId: r.open_song_id, title: r.title, singerName: r.singer_name, youtubeVideoId: r.youtube_video_id, lyrics: r.lyrics,
    })));
    const htmlFileId = await upsertDriveFile(drive, `Sunday-Songs-${dateStr}.html`, folderId, 'text/html', html);
    // Anyone with the link can open it - members shouldn't need Drive access to read lyrics.
    await drive.permissions.create({ fileId: htmlFileId, requestBody: { type: 'anyone', role: 'reader' }, supportsAllDrives: true });
  } catch (err) {
    console.error(`Sunday HTML handout failed for ${dateStr}:`, err.message);
  }
  return dateStr;
}

app.post('/api/mezmurs/:id/export-drive', requirePermission('canExport'), async (req, res) => {
  try {
    const drive = getDriveClient();
    const exported = await exportSongFileToDrive(drive, req.params.id);
    if (!exported) return res.status(404).json({ error: 'Song not found' });
    const { fileId, webViewLink, updated } = exported;

    // Adding to the Sunday set is best-effort - a failure here (e.g. a transient Drive
    // error) must not make the browser think the song file itself failed to export.
    // Anyone allowed to export adds to the upcoming Sunday's list, any day of the week
    // through that Sunday itself (nextSundayDate rolls over to the following week on Monday).
    let sundayDate = null;
    let sundayError = null;
    try {
      const targetDate = nextSundayDate();
      const alreadyOnSunday = await db`SELECT 1 FROM sunday_songs WHERE song_id = ${req.params.id} AND sunday_date = ${targetDate}`;
      if (!alreadyOnSunday.length) {
        const [{ max_pos }] = await db`SELECT COALESCE(MAX(position), 0) AS max_pos FROM sunday_songs WHERE sunday_date = ${targetDate}`;
        await db`INSERT INTO sunday_songs (song_id, sunday_date, position) VALUES (${req.params.id}, ${targetDate}, ${max_pos + 1})`;
      }
      sundayDate = await regenerateSundaySetFile(drive, targetDate);
    } catch (sundayErr) {
      console.error('Sunday set update failed:', sundayErr);
      sundayError = sundayErr.message;
    }

    res.json({ ok: true, fileId, webViewLink, updated, sundayDate, sundayError });
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
      SELECT ss.song_id, ss.position, s.title, s.open_song_id, s.youtube_video_id, sg.name AS singer_name
      FROM sunday_songs ss
      JOIN songs s ON s.id = ss.song_id
      JOIN singers sg ON sg.id = s.singer_id
      WHERE ss.sunday_date = ${date}
      ORDER BY ss.position
    `;
    res.json({
      date,
      songs: rows.map(r => ({ songId: r.song_id, position: r.position, title: r.title, openSongId: r.open_song_id, singer: r.singer_name, youtubeVideoId: r.youtube_video_id })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Exporters (who build the Sunday list) may reorder too, but only the nearest Sunday's list -
// planning further-out Sundays stays admin-only.
app.put('/api/sunday-songs/order', requirePermission('canExport'), async (req, res) => {
  const songIds = Array.isArray(req.body?.songIds) ? req.body.songIds : [];
  const date = req.permissions.isAdmin && isValidSundayWithinMonth(req.body?.date) ? req.body.date : nextSundayDate();
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
      SELECT s.title, s.youtube_video_id, s.youtube_candidates, sg.name AS singer
      FROM songs s
      JOIN singers sg ON s.singer_id = sg.id
      WHERE s.id = ${req.params.id}
    `;
    if (!found.length) return res.status(404).json({ error: 'Song not found' });
    const song = found[0];

    // Already admin-confirmed (empty string means "searched, nothing found" - don't retry).
    if (song.youtube_video_id !== null) {
      return res.json({ videoId: song.youtube_video_id || null, candidates: [], configured: true, confirmed: true });
    }

    // Already searched before (cached on first open) - don't burn quota searching again.
    if (song.youtube_candidates !== null) {
      return res.json({ videoId: null, candidates: song.youtube_candidates, configured: true, confirmed: false });
    }

    if (!process.env.YOUTUBE_API_KEY) {
      return res.json({ videoId: null, candidates: [], configured: false, confirmed: false });
    }

    const query = `${song.title} ${song.singer}`;
    const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=2&q=${encodeURIComponent(query)}&key=${process.env.YOUTUBE_API_KEY}`;
    const ytRes = await fetch(apiUrl);
    const ytData = await ytRes.json();
    if (!ytRes.ok) {
      console.error('YouTube API error:', ytData.error?.message || ytRes.status);
      return res.json({ videoId: null, candidates: [], configured: true, confirmed: false, error: ytData.error?.message });
    }
    const candidates = (ytData.items || [])
      .filter(item => item.id?.videoId)
      .map(item => ({
        videoId: item.id.videoId,
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails?.default?.url || null,
      }));

    await db`UPDATE songs SET youtube_candidates = ${JSON.stringify(candidates)} WHERE id = ${req.params.id}`;

    res.json({ videoId: null, candidates, configured: true, confirmed: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Best-effort caller identity for the notification email below - a real email if signed in,
// otherwise just the IP. Never throws: an unverifiable/missing token must not block the
// (now unauthenticated) confirm endpoint itself.
async function identifyRequester(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = await verifySupabaseToken(token);
      if (payload.email) return payload.email;
    } catch {}
  }
  return `anonymous (${req.ip})`;
}

// Emails the admin inbox whenever a song's YouTube link changes - added because the confirm
// endpoint below is temporarily open to everyone, not just admins, so this is the only way to
// notice a bad edit. Fire-and-forget from the route; failures are logged, never surfaced to
// the caller.
async function notifyYoutubeLinkChange(req, songId, videoId) {
  const requester = await identifyRequester(req);
  const rows = await db`
    SELECT s.title, sg.name AS singer_name FROM songs s JOIN singers sg ON sg.id = s.singer_id WHERE s.id = ${songId}
  `;
  const song = rows[0];
  // Matches the web app's own songShareLink() format (index.html) - loading this URL jumps
  // straight to the song via the ?song= query param handling near the bottom of that file.
  const songLink = `${req.protocol}://${req.get('host')}/?song=${encodeURIComponent(songId)}`;
  const subject = `YouTube link updated: ${song ? song.title : songId}`;
  const text = [
    `Song: ${song ? `${song.title} - ${song.singer_name}` : songId}`,
    `Link: ${songLink}`,
    `New video: ${videoId ? `https://www.youtube.com/watch?v=${videoId}` : '(none - marked as no video)'}`,
    `Updated by: ${requester}`,
    `Time: ${new Date().toISOString()}`,
  ].join('\n');
  await sendNotificationEmail(subject, text);
}

// Emails the admin inbox when a non-admin adds songs, so new additions can be reviewed.
async function notifySongsAdded(req, addedBy, songs) {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const subject = songs.length === 1
    ? `New song added: ${songs[0].title} - ${songs[0].singer}`
    : `${songs.length} new songs added`;
  const text = [
    ...songs.map(s => `${s.title} - ${s.singer}\n${baseUrl}/?song=${encodeURIComponent(s.id)}`),
    '',
    `Added by: ${addedBy}`,
    `Time: ${new Date().toISOString()}`,
  ].join('\n');
  await sendNotificationEmail(subject, text);
}

// Emails the admin inbox when a non-admin edits a song, with the old title/lyrics so a bad
// edit can be undone by hand.
async function notifySongEdited(req, editedBy, songId, before, newTitle, changed) {
  const link = `${req.protocol}://${req.get('host')}/?song=${encodeURIComponent(songId)}`;
  const text = [
    `Song: ${newTitle} - ${before.singer_name}`,
    `Link: ${link}`,
    `Changed: ${changed.length ? changed.join(', ') : 'nothing (saved without changes)'}`,
    `Edited by: ${editedBy}`,
    `Time: ${new Date().toISOString()}`,
    '',
    '--- Before the edit ---',
    `Title: ${before.title}`,
    `YouTube: ${before.youtube_video_id ? `https://www.youtube.com/watch?v=${before.youtube_video_id}` : '(none)'}`,
    'Lyrics:',
    before.lyrics,
  ].join('\n');
  await sendNotificationEmail(`Song edited: ${newTitle}`, text);
}

// Saves a YouTube video as the song's confirmed link, the field everyone else sees. Three
// ways it can be called:
//   - no "videoId" key at all: promote the cached auto-search suggestion (plain confirm button)
//   - "videoId": "<link or id>": save that one directly (pasted by the user)
//   - "videoId": "" (present but empty): reviewer confirmed none of the results is the right
//     video, or none exists - same "reviewed, nothing found" state the old auto-search used to
//     write, so it stops nagging for review on every visit.
// TEMPORARILY open to everyone, no sign-in required (previously requireAdmin) - user asked to
// open YouTube-link editing to all users for the moment. Restore requireAdmin when done.
app.post('/api/mezmurs/:id/youtube/confirm', async (req, res) => {
  try {
    if (req.body && 'videoId' in req.body) {
      const raw = (req.body.videoId || '').toString().trim();
      if (!raw) {
        await db`UPDATE songs SET youtube_video_id = '', youtube_suggested_id = '' WHERE id = ${req.params.id}`;
        res.json({ videoId: null, confirmed: true });
        notifyYoutubeLinkChange(req, req.params.id, null).catch(err => console.error('YouTube link email failed:', err));
        return;
      }
      const manualVideoId = extractYoutubeId(raw);
      if (!manualVideoId) return res.status(400).json({ error: 'Could not recognize that YouTube link/ID' });
      await db`UPDATE songs SET youtube_video_id = ${manualVideoId}, youtube_suggested_id = ${manualVideoId} WHERE id = ${req.params.id}`;
      res.json({ videoId: manualVideoId, confirmed: true });
      notifyYoutubeLinkChange(req, req.params.id, manualVideoId).catch(err => console.error('YouTube link email failed:', err));
      return;
    }

    const found = await db`SELECT youtube_suggested_id FROM songs WHERE id = ${req.params.id}`;
    if (!found.length) return res.status(404).json({ error: 'Song not found' });
    const suggested = found[0].youtube_suggested_id;
    if (suggested === null) return res.status(400).json({ error: 'No YouTube suggestion to confirm for this song' });

    await db`UPDATE songs SET youtube_video_id = ${suggested} WHERE id = ${req.params.id}`;
    res.json({ videoId: suggested || null, confirmed: true });
    notifyYoutubeLinkChange(req, req.params.id, suggested || null).catch(err => console.error('YouTube link email failed:', err));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Emails the deleted song's full details so an accidental delete can be restored by hand.
async function notifySongDeleted(req, song) {
  const text = [
    `Song: ${song.title} - ${song.singer_name}`,
    `OpenSong ID: #${song.open_song_id}`,
    `Song ID: ${song.id}`,
    `Language: ${song.language}`,
    `YouTube: ${song.youtube_video_id ? `https://www.youtube.com/watch?v=${song.youtube_video_id}` : '(none)'}`,
    `Media link: ${song.media_url || '(none)'}`,
    `Deleted by: ${await identifyRequester(req)}`,
    `Time: ${new Date().toISOString()}`,
    '',
    '--- Lyrics ---',
    song.lyrics,
  ].join('\n');
  await sendNotificationEmail(`Song deleted: #${song.open_song_id} ${song.title}`, text);
}

app.delete('/api/mezmurs/:id', requireAdmin, async (req, res) => {
  try {
    const rows = await db`
      DELETE FROM songs s USING singers sg
      WHERE s.id = ${req.params.id} AND sg.id = s.singer_id
      RETURNING s.id, s.title, s.lyrics, s.language, s.open_song_id, s.youtube_video_id, s.media_url, sg.name AS singer_name
    `;
    res.json({ ok: true });
    if (rows.length) notifySongDeleted(req, rows[0]).catch(err => console.error('Song-delete email failed:', err));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Mezmurify server running at http://localhost:${PORT}`));
