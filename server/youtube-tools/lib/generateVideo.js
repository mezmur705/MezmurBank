// Builds a static "title card" image (app logo + Mezmurify wordmark + song title/singer) and
// muxes it with an audio file into an MP4, for uploading audio-only songs to YouTube.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');
const { execFile } = require('child_process');

const WIDTH = 1280;
const HEIGHT = 720;
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'cross-logo.png');
const BACKGROUND = '#121212';
const ACCENT = '#1DB954';

function escapeXml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Naive word-wrap for SVG <text> (which doesn't wrap on its own): splits on spaces, keeping
// each line under maxChars. Ethiopic text has no spaces-only-between-words guarantee, but
// titles in this catalog are consistently space-separated, so this is good enough.
function wrapText(text, maxChars, maxLines) {
  const words = (text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  let wordIndex = 0;
  while (wordIndex < words.length) {
    const word = words[wordIndex];
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = '';
      if (lines.length === maxLines) break;
      continue;
    }
    current = candidate;
    wordIndex++;
  }
  const usedAllWords = wordIndex >= words.length;
  if (current && lines.length < maxLines) lines.push(current);

  if (!usedAllWords || lines.length > maxLines) {
    lines.length = Math.min(lines.length, maxLines);
    const last = lines[lines.length - 1] || '';
    lines[lines.length - 1] = last.length > 3 ? `${last.slice(0, -3).trimEnd()}...` : `${last}...`;
  }
  return lines;
}

async function buildTitleCardPng(title, singer, outPath) {
  const logo = await sharp(LOGO_PATH).resize(220, 220).toBuffer();

  const titleLines = wrapText(title, 38, 2);
  const titleTspans = titleLines
    .map((line, i) => `<tspan x="${WIDTH / 2}" dy="${i === 0 ? 0 : 54}">${escapeXml(line)}</tspan>`)
    .join('');

  const svg = `
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <text x="${WIDTH / 2}" y="330" text-anchor="middle" font-family="sans-serif" font-size="44" font-weight="bold" fill="${ACCENT}">Mezmurify</text>
      <text x="${WIDTH / 2}" y="420" text-anchor="middle" font-family="sans-serif" font-size="40" fill="#ffffff">${titleTspans}</text>
      <text x="${WIDTH / 2}" y="${420 + titleLines.length * 54 + 20}" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#b3b3b3">${escapeXml(singer)}</text>
    </svg>
  `;

  await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: BACKGROUND } })
    .composite([
      { input: await sharp(logo).toBuffer(), top: 60, left: Math.round((WIDTH - 220) / 2) },
      { input: Buffer.from(svg), top: 0, left: 0 },
    ])
    .png()
    .toFile(outPath);
}

// Bad/corrupted source audio (common with forwarded Telegram files) can make ffmpeg's parser
// spin retrying for many minutes instead of failing quickly - a hard timeout turns that into a
// fast, clearly-logged failure instead of silently stalling a whole batch on one bad file.
const FFMPEG_TIMEOUT_MS = 90 * 1000;

function muxImageAndAudio(imagePath, audioPath, outputPath) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, [
      '-y',
      '-loop', '1',
      '-i', imagePath,
      '-i', audioPath,
      '-c:v', 'libx264',
      '-tune', 'stillimage',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-pix_fmt', 'yuv420p',
      '-shortest',
      outputPath,
    ], { timeout: FFMPEG_TIMEOUT_MS, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
      if (err) {
        const reason = err.killed ? `timed out after ${FFMPEG_TIMEOUT_MS / 1000}s (likely corrupted source audio)` : err.message;
        return reject(new Error(`ffmpeg failed: ${reason}\n${stderr.slice(-1500)}`));
      }
      resolve(outputPath);
    });
  });
}

// title/singer: text for the card. audioPath: source audio file. outputPath: where to write the
// finished .mp4. Returns outputPath. Leaves a same-named .png title-card image next to it (not
// cleaned up, so it can be spot-checked before uploading).
async function generateAudioVideo({ title, singer, audioPath, outputPath }) {
  if (!fs.existsSync(audioPath)) throw new Error(`Audio file not found: ${audioPath}`);
  const imagePath = outputPath.replace(/\.mp4$/i, '.png');
  await buildTitleCardPng(title, singer, imagePath);
  await muxImageAndAudio(imagePath, audioPath, outputPath);
  return outputPath;
}

module.exports = { generateAudioVideo, buildTitleCardPng };
