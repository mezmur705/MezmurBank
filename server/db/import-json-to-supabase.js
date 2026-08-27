require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const postgres = require('postgres');

const EXPORT_DIR = path.join(__dirname, 'export');
const CHUNK_SIZE = 500;

function songHash(id, lyrics) {
  return crypto.createHash('sha256').update(id + ' ' + lyrics).digest('hex');
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });

(async () => {
  try {
    const singers = JSON.parse(fs.readFileSync(path.join(EXPORT_DIR, 'singers.json'), 'utf8'));
    const songs = JSON.parse(fs.readFileSync(path.join(EXPORT_DIR, 'songs.json'), 'utf8'));
    const comments = JSON.parse(fs.readFileSync(path.join(EXPORT_DIR, 'song_comments.json'), 'utf8'));
    const verifySample = JSON.parse(fs.readFileSync(path.join(EXPORT_DIR, 'verify-sample.json'), 'utf8'));

    await sql.begin(async sql => {
      for (const batch of chunk(singers, CHUNK_SIZE)) {
        const rows = batch.map(s => ({
          id: s.Id,
          name: s.Name,
          amharic_name: s.AmharicName ?? null
        }));
        await sql`insert into public.singers ${sql(rows)}`;
      }

      for (const batch of chunk(songs, CHUNK_SIZE)) {
        const rows = batch.map(s => ({
          id: s.Id,
          singer_id: s.SingerId,
          title: s.Title,
          lyrics: s.Lyrics,
          language: s.Language,
          open_song_id: s.OpenSongID,
          youtube_video_id: s.YoutubeVideoId ?? null,
          media_url: s.MediaUrl ?? null,
          open_song_format: s.OpenSongFormat ?? null,
          view_count: s.ViewCount ?? 0,
          like_count: s.LikeCount ?? 0,
          love_count: s.LoveCount ?? 0,
          haha_count: s.HahaCount ?? 0,
          wow_count: s.WowCount ?? 0,
          sad_count: s.SadCount ?? 0,
          angry_count: s.AngryCount ?? 0
        }));
        await sql`insert into public.songs ${sql(rows)}`;
      }

      for (const batch of chunk(comments, CHUNK_SIZE)) {
        const rows = batch.map(c => ({
          id: c.Id,
          song_id: c.SongId,
          author: c.Author,
          comment: c.Comment,
          created_at: c.CreatedAt,
          user_id: null
        }));
        await sql`insert into public.song_comments ${sql(rows)}`;
      }
    });

    // Reseed identity/serial sequences past the explicit ids we just inserted.
    await sql`select setval(pg_get_serial_sequence('public.singers', 'id'), coalesce((select max(id) from public.singers), 1))`;
    await sql`select setval(pg_get_serial_sequence('public.song_comments', 'id'), coalesce((select max(id) from public.song_comments), 1))`;
    await sql`select setval('public.open_song_id_seq', coalesce((select max(open_song_id) from public.songs), 0) + 1, false)`;

    // Row-count verification.
    const [{ count: singerCount }] = await sql`select count(*)::int from public.singers`;
    const [{ count: songCount }] = await sql`select count(*)::int from public.songs`;
    const [{ count: commentCount }] = await sql`select count(*)::int from public.song_comments`;

    console.log('Row counts (Postgres vs. exported JSON):');
    console.log(`  singers:  ${singerCount} / ${singers.length}`);
    console.log(`  songs:    ${songCount} / ${songs.length}`);
    console.log(`  comments: ${commentCount} / ${comments.length}`);

    const countsMatch = singerCount === singers.length && songCount === songs.length && commentCount === comments.length;
    if (!countsMatch) {
      console.error('Row count mismatch — investigate before treating migration as complete.');
      process.exitCode = 1;
    }

    // Lyrics hash spot-check against the sample captured at export time.
    let hashFailures = 0;
    for (const { id, hash } of verifySample) {
      const [row] = await sql`select lyrics from public.songs where id = ${id}`;
      if (!row) {
        console.error(`  MISSING in Postgres: ${id}`);
        hashFailures++;
        continue;
      }
      const actualHash = songHash(id, row.lyrics);
      if (actualHash !== hash) {
        console.error(`  HASH MISMATCH: ${id}`);
        hashFailures++;
      }
    }
    console.log(`Lyrics hash spot-check: ${verifySample.length - hashFailures}/${verifySample.length} passed.`);
    if (hashFailures > 0) process.exitCode = 1;

    if (countsMatch && hashFailures === 0) {
      console.log('Migration verified OK.');
    }
  } catch (err) {
    console.error('Import failed:', err.message);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
})();
