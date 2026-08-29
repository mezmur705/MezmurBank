const { escapeXml } = require('./openSongXml');

function escapeXmlAttr(text) {
  return escapeXml(text).replace(/"/g, '&quot;');
}

// OpenSong "set" slide_group entries reference a song by its exported filename
// (minus the folder), so this must exactly match the naming used when the song
// file itself is written to Drive.
function slideGroupName(openSongId, title) {
  return `${openSongId}  ${title}.txt`;
}

function buildSlideGroup({ openSongId, title, singerName }) {
  const name = slideGroupName(openSongId, title);
  return `  <slide_group name="${escapeXmlAttr(name)}" type="song" presentation="" path="${escapeXmlAttr(singerName)}/"/>`;
}

function parseSlideGroups(xml) {
  if (!xml) return [];
  return xml.match(/ *<slide_group[^>]*\/>/g) || [];
}

function slideGroupNameAttr(line) {
  const match = line.match(/name="([^"]*)"/);
  return match ? match[1] : null;
}

// Rebuilds the whole Today.txt set, dropping any earlier entry for the same
// song (by exported filename) so a re-export doesn't duplicate it in the list.
function buildTodaySetXml(existingXml, newEntry) {
  const targetName = slideGroupNameAttr(newEntry);
  const lines = parseSlideGroups(existingXml).filter(line => slideGroupNameAttr(line) !== targetName);
  lines.push(newEntry);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<set name="Today">\n  <slide_groups>\n${lines.join('\n')}\n</slide_groups></set>`;
}

module.exports = { buildSlideGroup, buildTodaySetXml };
