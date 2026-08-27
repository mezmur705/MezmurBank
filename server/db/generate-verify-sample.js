// Builds verify-sample.json from the songs.json that's currently on disk.
// Deliberately run as its own fresh process (spawned by export-mssql-to-json.js)
// rather than inline in the exporter: reading songs.json back from within the very
// process that just wrote it was observed to sometimes disagree with what every
// other process subsequently reads from the same file (same bytes on disk, but a
// different decoded Lyrics value) - a fresh process reading it independently avoids
// that class of self-verification blind spot entirely.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OUT_DIR = path.join(__dirname, 'export');
const SAMPLE_SIZE = 50;

function songHash(id, lyrics) {
  return crypto.createHash('sha256').update(id + ' ' + lyrics).digest('hex');
}

const songs = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'songs.json'), 'utf8'));
const shuffled = [...songs].sort(() => Math.random() - 0.5);
const sample = shuffled.slice(0, Math.min(SAMPLE_SIZE, songs.length)).map(s => ({
  id: s.Id,
  hash: songHash(s.Id, s.Lyrics)
}));
fs.writeFileSync(path.join(OUT_DIR, 'verify-sample.json'), JSON.stringify(sample, null, 2));
console.log(`Verification sample: ${sample.length} songs -> ${path.join(OUT_DIR, 'verify-sample.json')}`);
