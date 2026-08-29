function escapeXml(text) {
  return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Wraps a song's already-computed OpenSongFormat body in the real OpenSong XML file
// structure, so exported files are genuine OpenSong-compatible song files.
function buildOpenSongXml({ title, singerName, openSongId, lyricsBody }) {
  const idSuffix = openSongId != null ? ` (#${openSongId})` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<song>
<title>${escapeXml(title)}</title>
<author>${escapeXml(singerName)}${idSuffix}</author>
<lyrics>

${lyricsBody || ''}
</lyrics>
  <copyright></copyright>
  <hymn_number></hymn_number>
  <presentation></presentation>
  <ccli></ccli>
  <capo print="false" sharp="true"></capo>
  <key></key>
  <aka></aka>
  <key_line></key_line>
  <user1></user1>
  <user2></user2>
  <user3></user3>
  <theme></theme>
  <linked_songs/>
  <tempo></tempo>
  <time_sig></time_sig>
  <backgrounds resize="body" keep_aspect="true" link="false" background_as_text="true"/>
</song>`;
}

module.exports = { escapeXml, buildOpenSongXml };
