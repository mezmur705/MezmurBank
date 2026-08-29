const { escapeXml } = require('./openSongXml');

function escapeXmlAttr(text) {
  return escapeXml(text).replace(/"/g, '&quot;');
}

// OpenSong "set" slide_group entries reference a song by its exported filename
// (minus the folder), so this must exactly match the naming used when the song
// file itself is written to Drive.
function slideGroupName(openSongId, title) {
  return `${openSongId}_${title}.txt`;
}

function buildSlideGroup({ openSongId, title, singerName }) {
  const name = slideGroupName(openSongId, title);
  return `  <slide_group name="${escapeXmlAttr(name)}" type="song" presentation="" path="${escapeXmlAttr(singerName)}/"/>`;
}

// Rebuilds a full OpenSong set file from an ordered list of songs - used for the
// Sunday set list, whose Postgres row order is always the source of truth.
function buildSetXml(setName, entries) {
  const lines = entries.map(buildSlideGroup);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<set name="${escapeXmlAttr(setName)}">\n  <slide_groups>\n${lines.join('\n')}\n</slide_groups></set>`;
}

module.exports = { buildSlideGroup, buildSetXml };
