// Self-contained HTML handout for one Sunday's set: every song's lyrics plus its YouTube
// link, in set order. No scripts, fonts, or images - it opens and reads fully offline (only
// the YouTube links need a connection), for when the app can't load the library on a weak
// church network.
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatSundayDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// songs: [{ openSongId, title, singerName, youtubeVideoId, lyrics }] in set order.
function buildSundayHtml(dateStr, songs) {
  const pad = id => (id == null ? '----' : String(id).padStart(4, '0'));
  const toc = songs.map((s, i) => `
      <li><a href="#song-${i + 1}"><span class="num">${pad(s.openSongId)}</span> ${escapeHtml(s.title)}</a></li>`).join('');
  const body = songs.map((s, i) => `
    <section class="song" id="song-${i + 1}">
      <h2><span class="num">${i + 1}. #${pad(s.openSongId)}</span> ${escapeHtml(s.title)}</h2>
      <p class="singer">${escapeHtml(s.singerName)}</p>
      ${s.youtubeVideoId
        ? `<a class="yt" href="https://www.youtube.com/watch?v=${encodeURIComponent(s.youtubeVideoId)}">▶ Watch on YouTube</a>`
        : '<span class="yt none">No YouTube link</span>'}
      <div class="lyrics">${escapeHtml(s.lyrics)}</div>
      <a class="top" href="#top">↑ Back to list</a>
    </section>`).join('');

  return `<!doctype html>
<html lang="am">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sunday Songs ${escapeHtml(dateStr)}</title>
<style>
  :root { --bg: #ffffff; --fg: #1a202c; --muted: #718096; --card: #f7fafc; --line: #e2e8f0; --accent: #c53030; --link: #2b6cb0; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #121212; --fg: #f1f1f1; --muted: #a0a0a0; --card: #1e1e1e; --line: #333333; --accent: #ff6b6b; --link: #90cdf4; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font-family: system-ui, -apple-system, "Segoe UI", "Noto Sans Ethiopic", "Nyala", sans-serif; line-height: 1.5; }
  main { max-width: 760px; margin: 0 auto; padding: 16px; }
  h1 { font-size: 1.4rem; margin: 8px 0 2px; }
  .date { color: var(--muted); margin: 0 0 16px; }
  ol.toc { padding-left: 0; list-style: none; margin: 0 0 24px; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  ol.toc li + li { border-top: 1px solid var(--line); }
  ol.toc a { display: block; padding: 10px 12px; color: var(--fg); text-decoration: none; }
  .num { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 0.85em; }
  .song { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-bottom: 20px; }
  .song h2 { font-size: 1.2rem; margin: 0; }
  .singer { color: var(--muted); margin: 2px 0 10px; }
  .yt { display: inline-block; background: var(--accent); color: #fff; text-decoration: none; padding: 6px 12px; border-radius: 6px; font-weight: 600; font-size: 0.9rem; }
  .yt.none { background: transparent; color: var(--muted); padding: 0; font-weight: 400; }
  .lyrics { white-space: pre-line; font-size: 15pt; line-height: 1.6; margin-top: 14px; }
  .top { display: inline-block; margin-top: 12px; color: var(--link); font-size: 0.9rem; }
</style>
</head>
<body>
<main id="top">
  <h1>Sunday Songs</h1>
  <p class="date">${escapeHtml(formatSundayDate(dateStr))} · ${songs.length} songs</p>
  <ol class="toc">${toc}
  </ol>${body}
</main>
</body>
</html>
`;
}

module.exports = { buildSundayHtml };
