// Batch job: for songs missing a YoutubeVideoId, searches YouTube by the first 2 lyric lines
// alone, ranks the candidate videos by view count (default) or recency, and writes a text file
// listing the chosen link per song for manual review. dbo.Songs is only written to when run with
// --apply.
//
// The singer's Latin name is deliberately left out of the query: testing showed that mixing
// Latin script (an English singer name) with Amharic script (the lyric line) in one YouTube
// search collapses the result count to zero, in every word order and with/without quoting, even
// though each half alone returns real matches. Only ~16% of singers have an AmharicName on file,
// so that's not a reliable substitute either.
//
// Usage: node find-youtube-links.js [--sort=views|latest] [--limit=25] [--all] [--force] [--apply]
//   --sort=views   (default) pick the most-viewed candidate
//   --sort=latest  pick the most recently published candidate
//   --limit=N      max songs to process this run (default 25). YouTube search quota is expensive:
//                  100 units per song searched, default daily project quota is 10,000 units, so
//                  roughly 100 searches/day before the API starts rejecting requests.
//   --all          consider every song, not just ones with YoutubeVideoId IS NULL
//   --force        with --all, also re-search songs whose YoutubeVideoId is '' (a prior "no result")
//   --apply        after writing the review file, also save the chosen YoutubeVideoId into dbo.Songs
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const sql = require('mssql');

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.find(a => a.startsWith(`--${name}=`)) || `--${name}=${fallback}`).split('=')[1];
const SORT = flag('sort', 'views');
const LIMIT = Number(flag('limit', 25));
const INCLUDE_ALL = args.includes('--all');
const FORCE = args.includes('--force');
const APPLY = args.includes('--apply');
const REPORT_PATH = path.join(__dirname, 'youtube-review.txt');

const dbConfig = {
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { trustServerCertificate: true, encrypt: false },
  requestTimeout: 30000,
  connectionTimeout: 30000
};

async function searchCandidates(query) {
  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5&q=${encodeURIComponent(query)}&key=${process.env.YOUTUBE_API_KEY}`;
  const searchRes = await fetch(searchUrl);
  const searchData = await searchRes.json();
  if (!searchRes.ok) throw new Error(searchData.error?.message || `search HTTP ${searchRes.status}`);
  const ids = (searchData.items || []).map(item => item.id?.videoId).filter(Boolean);
  if (!ids.length) return [];

  // search.list doesn't return view counts; a follow-up videos.list call does (cheap: 1 unit).
  const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${ids.join(',')}&key=${process.env.YOUTUBE_API_KEY}`;
  const statsRes = await fetch(statsUrl);
  const statsData = await statsRes.json();
  if (!statsRes.ok) throw new Error(statsData.error?.message || `videos HTTP ${statsRes.status}`);

  return (statsData.items || []).map(v => ({
    videoId: v.id,
    title: v.snippet.title,
    channel: v.snippet.channelTitle,
    publishedAt: v.snippet.publishedAt,
    viewCount: Number(v.statistics?.viewCount || 0)
  }));
}

function pickBest(candidates, sort) {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => sort === 'latest'
    ? new Date(b.publishedAt) - new Date(a.publishedAt)
    : b.viewCount - a.viewCount);
  return sorted[0];
}

// Mirrors server.js's firstLyricLines(): first non-blank, non-section-tag lines of the lyric sheet.
function firstLyricLines(lyrics, count) {
  return (lyrics || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/^\[[^\]]*\]$/.test(line))
    .slice(0, count)
    .join(' ');
}

async function loadTargets(pool) {
  const result = await pool.request().query(`
    SELECT s.Id, s.Title, s.Lyrics, s.YoutubeVideoId, sg.Name AS SingerName
    FROM dbo.Songs s
    JOIN dbo.Singers sg ON sg.Id = s.SingerId
    ORDER BY s.Id
  `);
  return result.recordset.filter(row => {
    if (INCLUDE_ALL) return true;
    if (FORCE) return row.YoutubeVideoId === null || row.YoutubeVideoId === '';
    return row.YoutubeVideoId === null;
  });
}

async function saveYoutubeId(pool, id, videoId) {
  const req = pool.request();
  req.input('Id', sql.NVarChar(400), id);
  req.input('VideoId', sql.NVarChar(20), videoId);
  await req.query('UPDATE dbo.Songs SET YoutubeVideoId = @VideoId WHERE Id = @Id');
}

async function main() {
  if (!process.env.YOUTUBE_API_KEY) {
    console.error('Missing YOUTUBE_API_KEY in server\\.env');
    process.exitCode = 1;
    return;
  }
  if (!['views', 'latest'].includes(SORT)) {
    console.error(`Invalid --sort value "${SORT}" (use "views" or "latest")`);
    process.exitCode = 1;
    return;
  }

  const pool = await sql.connect(dbConfig);
  const allTargets = await loadTargets(pool);
  const targets = allTargets.slice(0, LIMIT);
  console.log(`${allTargets.length} song(s) match the target filter; processing ${targets.length} (--limit=${LIMIT}).`);
  if (APPLY) console.log('--apply is set: dbo.Songs.YoutubeVideoId will be updated as each song resolves.');
  else console.log('Review-only run: no database writes. Re-run with --apply once you\'ve checked youtube-review.txt.');

  const lines = [];
  lines.push(`YouTube link review — sort=${SORT} — generated ${new Date().toISOString()}`);
  lines.push('='.repeat(70));

  let resolved = 0, noResults = 0, errors = 0;

  for (const song of targets) {
    const query = firstLyricLines(song.Lyrics, 2);
    lines.push('');
    lines.push(`Song.Id: ${song.Id}`);
    lines.push(`Title: ${song.Title}`);
    lines.push(`Singer: ${song.SingerName}`);
    lines.push(`Search query: ${query}`);

    try {
      const candidates = await searchCandidates(query);
      const best = pickBest(candidates, SORT);

      if (!best) {
        lines.push('Result: NO RESULTS');
        noResults++;
        if (APPLY) await saveYoutubeId(pool, song.Id, '');
        console.log(`NO RESULTS: ${song.Title}`);
        continue;
      }

      lines.push(`CHOSEN: ${best.videoId} | "${best.title}" | ${best.channel} | views=${best.viewCount} | published=${best.publishedAt}`);
      lines.push(`URL: https://www.youtube.com/watch?v=${best.videoId}`);
      const others = candidates.filter(c => c.videoId !== best.videoId);
      if (others.length) {
        lines.push('Other candidates:');
        others.forEach(c => lines.push(`  ${c.videoId} | "${c.title}" | ${c.channel} | views=${c.viewCount} | published=${c.publishedAt}`));
      }
      resolved++;
      console.log(`CHOSEN: ${song.Title} -> ${best.videoId} (views=${best.viewCount})`);

      if (APPLY) await saveYoutubeId(pool, song.Id, best.videoId);
    } catch (err) {
      lines.push(`ERROR: ${err.message}`);
      errors++;
      console.error(`ERROR searching "${song.Title}": ${err.message}`);
    }
  }

  lines.push('');
  lines.push('='.repeat(70));
  lines.push(`Summary: resolved=${resolved} noResults=${noResults} errors=${errors} of ${targets.length} processed`);

  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');
  console.log(`\nReview file written to ${REPORT_PATH}`);
  console.log(`Resolved: ${resolved} | No results: ${noResults} | Errors: ${errors}`);

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
