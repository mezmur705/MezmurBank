// One-off: reassigns every song's open_song_id so IDs run in Amharic (Ge'ez fidel)
// phonetic order of the title, instead of the current import-order numbering.
//
// The Ethiopic Unicode block already assigns codepoints in traditional fidel order
// (verified: ሀለሐመሠረሰሸቀበተቸነኘአከኸወዐዘዠየደጀገጠጨጰጸፀፈፐ is strictly ascending by codepoint), so a plain
// JS string comparison on the Amharic portion of the title sorts correctly.
//
// The English transliteration in parentheses - e.g. "ጌታማ የበላይ ነው (Gietama Yebelay New)" -
// is stripped before comparing, so it doesn't affect ordering.
//
// Usage:
//   node reorder-open-song-ids.js --dry-run   (prints the new order, changes nothing)
//   node reorder-open-song-ids.js             (applies the reassignment)

require('dotenv').config();
const postgres = require('postgres');

const db = postgres(process.env.DATABASE_URL, { ssl: 'require' });
const DRY_RUN = process.argv.includes('--dry-run');

function sortKey(title) {
  return (title || '').split('(')[0].trim();
}

async function main() {
  const rows = await db`SELECT id, title, open_song_id FROM songs`;
  const startId = Math.min(...rows.map(r => r.open_song_id));

  const sorted = [...rows].sort((a, b) => {
    const ka = sortKey(a.title);
    const kb = sortKey(b.title);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const updates = sorted.map((row, index) => ({
    id: row.id,
    title: row.title,
    oldId: row.open_song_id,
    newId: startId + index,
  }));

  console.log(`${updates.length} songs, new IDs will run from ${startId} to ${startId + updates.length - 1}.`);
  console.log('\nFirst 15 in new order:');
  updates.slice(0, 15).forEach(u => console.log(`  ${u.newId} (was ${u.oldId}) | ${u.title}`));
  console.log('\nLast 5 in new order:');
  updates.slice(-5).forEach(u => console.log(`  ${u.newId} (was ${u.oldId}) | ${u.title}`));

  const changed = updates.filter(u => u.newId !== u.oldId);
  console.log(`\n${changed.length} of ${updates.length} songs will actually change ID.`);

  if (DRY_RUN) {
    console.log('\n--dry-run: no changes written.');
    await db.end();
    return;
  }

  const CHUNK = 500;
  const values = changed.map(u => [u.id, u.newId]);
  for (let i = 0; i < values.length; i += CHUNK) {
    const chunk = values.slice(i, i + CHUNK);
    await db`
      UPDATE songs AS s
      SET open_song_id = (v.new_id)::int
      FROM (VALUES ${db(chunk)}) AS v(song_id, new_id)
      WHERE s.id = v.song_id
    `;
    console.log(`Updated ${Math.min(i + CHUNK, values.length)}/${values.length}`);
  }

  console.log('\nDone. Sample of new order from the database:');
  const sample = await db`SELECT open_song_id, title FROM songs ORDER BY open_song_id ASC LIMIT 15`;
  sample.forEach(r => console.log(`  ${r.open_song_id} | ${r.title}`));

  await db.end();
}

main().catch(err => {
  console.error('Reorder failed:', err);
  process.exit(1);
});
