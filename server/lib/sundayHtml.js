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
// downloadUrl (optional): adds a "Download for offline" link - used when served by the website.
function buildSundayHtml(dateStr, songs, { downloadUrl } = {}) {
  const pad = id => (id == null ? '----' : String(id).padStart(4, '0'));
  // Collapsed by default: tap a song to open its lyrics. name="song" makes it an accordion
  // (opening one closes the others) in browsers that support it; older ones just allow several.
  const body = songs.map((s, i) => `
    <details class="song" name="song">
      <summary>
        <span class="num">${i + 1}. #${pad(s.openSongId)}</span>
        <span class="title">${escapeHtml(s.title)}</span>
        <span class="singer">${escapeHtml(s.singerName)}</span>
      </summary>
      <div class="content">
      ${s.youtubeVideoId
        ? `<a class="thumb" href="https://www.youtube.com/watch?v=${encodeURIComponent(s.youtubeVideoId)}">
        <img src="https://img.youtube.com/vi/${encodeURIComponent(s.youtubeVideoId)}/mqdefault.jpg" alt="▶ Watch on YouTube" loading="lazy" width="320" height="180">
        <span class="play">▶</span>
      </a>
      <a class="yt" href="https://www.youtube.com/watch?v=${encodeURIComponent(s.youtubeVideoId)}">▶ Watch on YouTube</a>`
        : '<span class="yt none">No YouTube link</span>'}
        <div class="lyrics">${escapeHtml(s.lyrics)}</div>
      </div>
    </details>`).join('');

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
  .num { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 0.85em; }
  .song { background: var(--card); border: 1px solid var(--line); border-radius: 10px; margin-bottom: 10px; }
  .song summary { list-style: none; cursor: pointer; padding: 12px 40px 12px 14px; position: relative; }
  .song summary::-webkit-details-marker { display: none; }
  .song summary::after { content: '▾'; position: absolute; right: 14px; top: 50%; transform: translateY(-50%); color: var(--muted); font-size: 1.2rem; }
  .song[open] summary::after { content: '▴'; }
  .song[open] summary { border-bottom: 1px solid var(--line); }
  .song .title { display: block; font-size: 1.1rem; font-weight: 600; }
  .song .singer { display: block; color: var(--muted); font-size: 0.9rem; }
  .content { padding: 14px; }
  .thumb { position: relative; display: block; max-width: 320px; aspect-ratio: 16 / 9; margin-bottom: 8px; border-radius: 8px; overflow: hidden; background: var(--line); }
  .thumb img { display: block; width: 100%; height: 100%; object-fit: cover; color: var(--muted); }
  .thumb .play { position: absolute; inset: 0; margin: auto; width: 56px; height: 40px; border-radius: 10px; background: rgba(204, 0, 0, 0.9); color: #fff; font-size: 20px; display: flex; align-items: center; justify-content: center; }
  .download { display: inline-block; margin: 0 0 16px; padding: 8px 14px; border: 1px solid var(--line); border-radius: 6px; color: var(--link); text-decoration: none; font-weight: 600; }
  .yt { display: inline-block; background: var(--accent); color: #fff; text-decoration: none; padding: 6px 12px; border-radius: 6px; font-weight: 600; font-size: 0.9rem; }
  .yt.none { background: transparent; color: var(--muted); padding: 0; font-weight: 400; }
  .lyrics { white-space: pre-line; font-size: 15pt; line-height: 1.6; margin-top: 14px; }
</style>
</head>
<body>
<main id="top">
  <h1>Sunday Songs</h1>
  <p class="date">${escapeHtml(formatSundayDate(dateStr))} · ${songs.length} songs</p>
  ${downloadUrl ? `<a class="download" href="${escapeHtml(downloadUrl)}" download>⬇ Download for offline</a>` : ''}
${body}
</main>
</body>
</html>
`;
}

module.exports = { buildSundayHtml };
