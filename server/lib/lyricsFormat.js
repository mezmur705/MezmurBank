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

module.exports = { buildLyricsAndFormat };
