// Shared fuzzy-matching helpers for messy, hand-typed audio filenames (see
// match-telegram-audio.js for the original write-up of why this is needed).

const JUNK_WORDS = new Set([
  'new', 'official', 'lyrics', 'video', 'amharic', 'ethiopian', 'gospel', 'song', 'mezmur',
  'protestant', 'with', 'of', 'ft', 'the', 'harvest', 'is', 'plentiful', 'old', 'volume', 'vol',
  'track', 'mp3', 'mstudioconvert', 'hd', 'mez',
]);

function tokenize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/@\S+/g, ' ')
    .replace(/#\d+/g, ' ')
    .replace(/\d{3,4}p\b/g, ' ')
    .replace(/\d{2,4}k\b/g, ' ')
    .replace(/20\d{2}/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .filter(w => !JUNK_WORDS.has(w))
    .filter(w => !/^\d+$/.test(w))
    .filter(w => /[ሀ-፿]/.test(w) || w.length > 2);
}

function transliteration(title) {
  const m = title.match(/\(([^)]+)\)/);
  return (m ? m[1] : title).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function similarity(a, b) {
  if (!a.length && !b.length) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function bestSubstringSimilarity(haystack, needle) {
  if (!needle.length) return 0;
  if (!haystack.length) return 0;
  let best = 0;
  for (let len = Math.max(1, needle.length - 2); len <= needle.length + 2; len++) {
    for (let start = 0; start <= haystack.length - len; start++) {
      const sim = similarity(haystack.slice(start, start + len), needle);
      if (sim > best) best = sim;
    }
  }
  return best;
}

// base: filename without extension. singers/songs: full DB rows (songs joined with singer name).
// Returns [] if no singer could be guessed, else an array of { singer, scoredSongs } - scoredSongs
// sorted best-first, each with a `.score` (0-1) against that singer's catalog.
function matchFile(base, singers, songs) {
  const fileTokens = tokenize(base);
  const rawFilename = base.toLowerCase().replace(/[^a-z0-9]+/g, '');

  const exactSingerMatches = singers.filter(s => {
    const nameTokens = tokenize(s.name);
    if (!nameTokens.length) return false;
    return nameTokens.every(t => fileTokens.includes(t));
  });
  const singerMatches = exactSingerMatches.length ? exactSingerMatches : singers
    .map(s => ({ ...s, _sim: bestSubstringSimilarity(rawFilename, s.name.toLowerCase().replace(/[^a-z0-9]+/g, '')) }))
    .filter(s => s._sim >= 0.8)
    .sort((a, b) => b._sim - a._sim)
    .slice(0, 1);

  return singerMatches.map(singer => {
    const candidateSongs = songs.filter(s => s.singer_id === singer.id);
    const scoredSongs = candidateSongs
      .map(s => ({ ...s, score: bestSubstringSimilarity(rawFilename, transliteration(s.title)) }))
      .sort((a, b) => b.score - a.score);
    return { singer, scoredSongs };
  });
}

module.exports = { tokenize, transliteration, similarity, bestSubstringSimilarity, matchFile };
