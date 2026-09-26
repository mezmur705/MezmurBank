// Read-only diagnostic: finds songs in the catalog whose titles are probably the same song
// under different Amharic spellings, not just literal exact matches. Doesn't touch the DB.
//
// Amharic lost several consonant distinctions that Ge'ez script still writes with separate
// letters - so words that sound identical are often spelled with either letter interchangeably,
// which is exactly what caused a real duplicate to slip past an exact-title check during the
// 2026-09-26 OpenSong import (ኣ vs አ). This folds each such letter-family together (across all
// 7 vowel orders) before comparing titles, plus the specific "glottal a" 1st/4th-order mixup
// (አ vs ኣ) that's a very common typo on its own.
//
// Usage: node find-near-duplicate-titles.js
require('dotenv').config();
const postgres = require('postgres');
const db = postgres(process.env.DATABASE_URL, { ssl: 'require' });

// Each row: base (1st-order) codepoints of letters that are pronounced the same in modern
// Amharic but historically represented distinct Ge'ez consonants. All 7 vowel orders of every
// member in a row get folded onto the first member's corresponding order.
const CONFUSABLE_FAMILIES = [
  ['ሀ', 'ሐ', 'ኀ', 'ኸ'], // all /h/
  ['ሰ', 'ሠ'],           // all /s/
  ['አ', 'ዐ'],           // all /ʔ/ (glottal stop / former "ayin")
  ['ጸ', 'ፀ'],           // all /t͡sʼ/
];
// The single most common Amharic spelling mixup on its own: word-initial "a" written with the
// 1st-order glottal letter (አ) vs the 4th-order one (ኣ) - both read as plain "a".
const ORDER_1_4_FOLD_FAMILIES = [['አ', 'ዐ']];

function buildMap() {
  const map = new Map();
  for (const family of CONFUSABLE_FAMILIES) {
    const bases = family.map(ch => ch.codePointAt(0));
    for (let order = 0; order < 7; order++) {
      const canonical = String.fromCodePoint(bases[0] + order);
      for (const base of bases) map.set(String.fromCodePoint(base + order), canonical);
    }
  }
  for (const family of ORDER_1_4_FOLD_FAMILIES) {
    const bases = family.map(ch => ch.codePointAt(0));
    const canonicalOrder1 = map.get(String.fromCodePoint(bases[0])) || String.fromCodePoint(bases[0]);
    for (const base of bases) map.set(String.fromCodePoint(base + 3), canonicalOrder1); // order index 3 = 4th order
  }
  return map;
}

// Sanity check: every family member must actually sit in the Ethiopic block, and 8 characters
// I paste by hand could easily contain a typo - fail loudly instead of silently no-op'ing.
function assertEthiopic(family) {
  for (const ch of family) {
    const cp = ch.codePointAt(0);
    if (cp < 0x1200 || cp > 0x139F) throw new Error(`"${ch}" (U+${cp.toString(16)}) is not in the Ethiopic block - check CONFUSABLE_FAMILIES`);
  }
}
CONFUSABLE_FAMILIES.forEach(assertEthiopic);

const CHAR_MAP = buildMap();
function normalize(str) {
  return (str || '').split('').map(c => CHAR_MAP.get(c) || c).join('').toLowerCase().replace(/\s+/g, ' ').trim();
}

(async () => {
  const rows = await db`SELECT s.id, s.title, sg.name AS singer FROM songs s JOIN singers sg ON sg.id = s.singer_id`;
  console.log(`Scanning ${rows.length} songs...\n`);

  const groups = new Map();
  for (const r of rows) {
    const key = normalize(r.title);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  let flagged = 0;
  for (const [key, group] of groups) {
    const distinctRawTitles = new Set(group.map(r => r.title));
    if (distinctRawTitles.size < 2) continue; // exact-only matches aren't a spelling issue
    flagged++;
    console.log(`Possible spelling-variant duplicates (normalized: "${key}"):`);
    group.forEach(r => console.log(`  [${r.singer}] "${r.title}" (id=${r.id})`));
    console.log();
  }

  console.log(`Done: ${flagged} group(s) flagged for review out of ${groups.size} distinct normalized titles.`);
  await db.end();
})();
