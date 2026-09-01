// One-off: imports a hand-picked set of songs found in a Telegram channel export
// (Mezmur_lyrics.txt), cross-checked against the existing catalog to avoid duplicates.
// Unlike import-wikimezmur-songs.js, these have no confirmed source URL, so
// source_name/source_url are left null rather than mis-attributing them.
//
// Usage:
//   node import-telegram-batch-songs.js --dry-run   (prints what would happen, changes nothing)
//   node import-telegram-batch-songs.js             (applies the import)

require('dotenv').config();
const postgres = require('postgres');
const { buildLyricsAndFormat } = require('./lib/lyricsFormat');

const db = postgres(process.env.DATABASE_URL, { ssl: 'require' });
const DRY_RUN = process.argv.includes('--dry-run');

const songsToImport = [
  {
    title: 'Litarekegn Wedo',
    singer: 'Aster Abebe',
    lyrics: `Aster Abebe - New Gospel Song - Litarekegn Wedo (ሊታረቀኝ ወዶ)

የመራቄ ርቀት ከኣብ መለያየቴ
ማን ግድ ብሎት ነበር የመንከራተቴ
ክብሩ በጎደለው ህይወት ስመላለስ
ርቄ ከፈቃዱ መታደሴ እስኪደርስ
ከመላዕክት መካከል ወይም ከሰማዕታት
ቀድመው ከነበሩት ከተባሉት አባት
ማን በጥቂት ጣረ ወደ አብ ሊያስጠጋኝ
ህጉስ ምን ፈየደኝ ይብሱን አጣላኝ

አብ አባት ራርቶልኝ ሊታረቀኝ ወዶ
በእቅፉ ያለውን አንድ ልጁን ልኮ
ሃጥያት የማያውቀውን ሃጥያት አደረገው
ከድምፁ ያራቀኝን የዕዳ ጽህፈቴን በደሙ ገሰሰው

ማነው ያለው ተገዳ ነው?
የራሱ ያደረገኝ መውደዱ ማርኮኝ ነው
ማነው ያለው ቸግሯት ነው?
ርስቱ ያደረገኝ ፍቅሩ ገዝቶኝ ነው

መች አጠረች እጁ ከማዳን
መች ተሳናት ጆሮው ልትሰማን
እውነት ስፍራን አጥቶ ጽድቅ ርቆ ቆሞ
ህያው ነፍስ በሙሉ ለሃጥያት ታድሞ
ማላጅ እንደሌለ ምድርን አየች አይኑ
ጽድቁም አገዘችው ፈጠነች ማዳኑ
በገዛ ክንዶቹ መድሃኒት ሆነልን
ፍጥረቱ ታደሰ በስላሴ ምክር`,
    sourceUrl: '',
  },
  {
    title: 'Betsega',
    singer: 'Elora Gospel Singers',
    lyrics: `ያደረኩት የለም ስለመዳኔ
የከፈልኩት የለም ስለመዳነ

እንዲው በነፃ የዳንኩት እንዲው በነፃ
እንዲው በነፃ ነው እንዲው በነፃ
እንዲው በፀጋ የዳንኩት እንዲው በፀጋ
እንዲው በፀጋ ነው እንዲው በፀጋ

ጌታ እየሱስ ነው ለኔ የሞተልኝ
ከሃጥያት እርግማን ነፃ ያወጣን
እራሱን ስለኔ በርግጥ ሰውቶታል
ነፍሴን ሊያድናት ደም ከፍሎላታል

ወዶኝ ስላዳነኝ የለብኝ ኩነኔ
እዳዬ ተከፍሎልኛል ነፃ ነኝ እኔ
ስራዬ መስቀል ላይ ሰርቶ ጨርሶታል
በሞቱ ሂወቴ በሞቱ ዋጅቷቷል

ያደረኩት የለም ስለመዳኔ
የከፈልኩት የለም ስለመዳነ

እንዲው በነፃ የዳንኩት እንዲው በነፃ
እንዲው በነፃ ነው እንዲው በነፃ
እንዲው በፀጋ የዳንኩት እንዲው በፀጋ
እንዲው በፀጋ ነው እንዲው በፀጋ

ግራ አልተጋባሁም አልተቅበዘበዝኩም
ድነትን ፍለጋ እየዞርኩ ወጥቼ አሎረድኩም
በማምኔ ብቻ በልጁ በእየሱስ
እኔን አድርጎኛል በአብ ቀኝ ከርሱ ጋር እንድወርስ

ቤቴን በሰማይ እርሱ ሰርቶልኛል
መኖሪያዬን በላይ አዘጋጅቶልኛል
አርፊያለው በርሱ በነፍስ በስጋዬ
የዘላለም ሂወት ሰቶኝ እየሱስ ጌታዬ

እንዲው በነፃ እንዲው በነፃ
እንዲው በነፃ እንዲው በነፃ
እንዲው በፀጋ እንዲው በፀጋ
እንዲው በፀጋ እንዲው በፀጋ`,
    sourceUrl: '',
  },
  {
    title: 'Engedaye',
    singer: 'Hillina Kassahun',
    lyrics: `Hillina Kassahun (እንግዳዬ) Engedaye

መንገድን ልጥረግልህ
ዘወትር ላጥንልህ በየለት ላጥንልህ
ንጉስ ሆይ እረፍ በኔ ላይ
መንፈስቅዱስ ስፈን በኔ ላይ
ላስተናግድ መለኮትን
ደርሶ የለ ቀጠሮአችን

እንግዳዬ (2) ከሩቅ ሰማሁ ኮቴህን እንግዳዬ
ቤቴን አወደው ሽታህ እንግዳዬ
ኢየሱሴ (2) ለሊት ሰማሁኝ ድምፅህን ኢየሱሴ

ረድኤቴ መልህቄ ና ሰምብት በቤቴ
አልልቅህም ክረም በቤቴ መድሃኒቴ
በለሊት ሳሰላስል በንእቅልፌ ደግሞም ሳልምህ
ፍቅርህ ልቤን ጎትቶ ስጋዬ እንኳን አንተን ተርቦ
ሳሰናዳ አይምሮዬን ስጠብቅህ እጅግ በጉጉት
መጣህልኝ እንደቃልህ አገኘኸኝ እንደማልከው
በመንፈስቅዱስ ሃሴት አድርጌ
ምነው እንደ ሄኖክ ብሻገረው

እንግዳዬ (2) ከሩቅ ሰማሁ ኮቴህን እንግዳዬ
ቤቴን አወደው ሽታህ እንግዳዬ
ይኸው መጥሁኝ ስትል ኢየሱሴ
ጠረንህ ቤቴን አውዶት
ህልውናህ አጥንቴን ተሰምቶት
ሙቀትህ ዙሪያዬን አቅፎኝ

በቅድስተ ቅዱሳንህ ውስጥ
ራሴን አገኘሁት ሳመልክ
ከቅዱሳን ጉባኤ ጋራ
በመንፈሴ ምስጋናን ሳሰማ
መልአክቶቹም ሲቀኙልህ
እኔም አጅቤ ሳለቅስ ሳዜም
የመፈጠሬን ትርጉም አግኝቼ
ልቀር ጓጓሁኝ ለዘላለሜ

እንግዳዬ (2) ከሩቅ ሰማሁ ኮቴህን እንግዳዬ
ቤቴን አወደው ሽታህ እንግዳዬ
ኢየሱሴ (2) ለሊት ሰማሁኝ ድምፅህን ኢየሱሴ
ይኸው መጥሁኝ ስትል ኢየሱሴ
ረድኤቴ መልህቄ ና ሰምብት በቤቴ
አልልቅህም ክረም በቤቴ መድሃኒቴ
አቤት ስወድድህ ስቀርብህ ስወድህ
መቼም አልጠግብህ (3)
ውዴ ስቀርብህ ስወድድህ ስቀርብህ
ለዘላለም አልጠግብህ (3)`,
    sourceUrl: '',
  },
  {
    title: 'Nana Mushraye',
    singer: 'Selam Desta',
    lyrics: `Selam Desta - ናና ሙሽራዬ (

ሰፊው ሜዳ ተጠናቆ
የጅረት ጉዞ ተገባዶ
በባከነ ሰዓት እንዳለሁ
ዘመኑ ይነግራል የሚሆነው አስረግጦ
በቃ ልንቃ ላብራ መብራቴ
ላሰናዳ ይመር ጎጆዬ
ሙሽራዬ እንዳትቆም ከደጄ
ናና ሙሽራዬ
ናና ኢየሱስ ጌታዬ

በህብረት ሲጠብቊ ቆነጃጂቶች
በናፍቆት ከልባቸው አንተን ሊያዩ ፈላጊዎች
ይሁን እንጂ በአምስቱ ስንፍና ይታያል
ከመቅረዛቸው ዘይት ጎሎ ማብራያቸው ጨልሟል
አንድ ቀን ተነፋ መለከት
የጠበቁት ከሰፈር ገባ ድንገት
ሊሸምቱ በወጡበት ገባና
አላውቅም አለ ደጁንም ዘጋና
በቃ ልንቃ ላብራ መብራቴን
ላሰናዳ ይመር ጎጆዬ
ሙሽራዬ እንዳትቆም ከደጄ
በሩን ልክፈት ልነሳና ማልጄ
ናና ሙሽራዬ
ናና ኢየሱሱ ጌታዬ

ሚታየው ሚሰማው ሚሆነው በአለም
መምጣቱን ያሳያል አርጅቷል ይህ አለም
ፍጥረታት በሙሉ በእርኩስት ተሞልቷል
እግዚአብሔር የለም ባይ ቁጥር እጅግ በዝቷል

የአለምን ለምን ልሻ እርሷም ዝጋለች
የሰማዩን መንግሥት ነብሴም ናፍቃለች
የአለምን ለምን ልመኝ እርሷም ዝጋለች
የሰማዩን መንግሥት ነብሴም ናፍቃለች
ናና ሙሽራዬ
ናና ኢየሱስ ጌታዬ`,
    sourceUrl: '',
  },
  {
    title: 'Yezema Gize Derese',
    singer: 'Suraphel Demissie',
    lyrics: `Suraphel Demissie - የዜማ ጊዜ ደረሰ

የዜማ ጊዜ ደረሰ
ያለቀሰ እንባው ታበሰ
ኢየሱስ መጣ ወደርሱ
ጠላቶቹ/ከሳሾቹ ማቅ ለበሱ

ዘሬን ተሸክሜ እያለቀስኩ ሄድኩኝ
ዛሬ ነዶ ይዤ ለክብሩ ዘመርኩኝ
ለቅሶ ማታ ነበር ጠዋት ደስታ ሆኗል
የአምላኬ ክብር በኔ ላይ ጨምሯል

እራሴን ሰጥቼ ላምልከው ፈቅጄ
ለኔ ፈጥኖ ደራሽ ኢየሱስ ወዳጄ

እራሴን ሰጥቼ ላምልከው ፈቅጄ
እንባየ ታብሷል
በርሱ በወዳጄ

የዜማ ጊዜ ደረሰ
ያለቀሰ እንባው ታበሰ
ኢየሱስ መጣ ወደርሱ
ጠላቶቹ/ከሳሾቹ ማቅ ለበሱ 2×

ዛሬማ ግዜው ነውና
ዛሬማ ላሰማ ዜማ
ዛሬማ ለረዳኝ ጌታ
ዛሬማ ላሰማ እልልታ
ዛሬማ ግዜው ነውና
ዛሬማ ላሰማ ዜማ
ዛሬማ ክረምት አለፈ
ዛሬማ ሀዘን ጨለማ

ምድረበዳውና ደረቁ ምድር
ደስም ይላቸዋል ሀሴት ያደርጋል
ብሎ ያለው ቃሉ ዛሬ ተፈጽሟል
ዲዳው ተፈውሶ ለክብሩ ያዜማል

እራሴን ሰጥቼ
ላምልከው ፈቅጄ
ለኔ ፈጥኖ ደራሽ
ኢየሱስ ወዳጄ
እራሴን ሰጥቼ
ላምልከው ፈቅጄ
እንባየ ታብሷል
በርሱ በወዳጄ
ዛሬማ ግዜው ነውና
ዛሬማ ላሰማ ዜማ
ዛሬማ ለረዳኝ ጌታ
ዛሬማ ላሰማ እልልታ
ዛሬማ ግዜው ነውና
ዛሬማ ላሰማ ዜማ
ዛሬማ ክረምት አለፈ
ዛሬማ ሀዘን ጨለማ

ክረምቱ አለፈ አዲስ ዘመን መጣ
ወይኖቹም አበቡ በለሱም ጎመራ
ከአለት ንቃቃት ወጣሁ ልዘምር
ማዳኑን ላወራ ድንቁን ልናገር
የዜማ ግዜ ደረሰ
ያለቀሰ እንባው ታበሰ
ኢየሱስ መጣ ወደርሱ
ጠላቶቹ/ከሳሾቹ ማቅ ለበሱ
ዛሬማ ግዜው ነውና
ዛሬማ ላሰማ ዜማ
ዛሬማ ለረዳኝ ጌታ
ዛሬማ ላሰማ እልልታ
ዛሬማ ግዜው ነውና
ዛሬማ ላሰማ ዜማ
ዛሬማ ክረምት አለፈ
ዛሬማ ሀዘን ጨለማ`,
    sourceUrl: '',
  },
];

function slugify(str) {
  return (str || '').toString().toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'x';
}

const ETHIOPIC_PATTERN = new RegExp('[\\u1200-\\u137F\\u1380-\\u139F\\u2D80-\\u2DDF\\uAB00-\\uAB2F]');
function detectLanguage(title, lyrics) {
  return ETHIOPIC_PATTERN.test(`${title} ${lyrics}`) ? 'Amharic' : 'English';
}

async function upsertSinger(tx, name) {
  const rows = await tx`
    WITH ins AS (
      INSERT INTO singers (name) VALUES (${name})
      ON CONFLICT (lower(name)) DO NOTHING
      RETURNING id
    )
    SELECT id FROM ins
    UNION ALL
    SELECT id FROM singers WHERE lower(name) = lower(${name})
    LIMIT 1
  `;
  return rows[0].id;
}

async function main() {
  if (!songsToImport.length) {
    console.log('songsToImport is empty - add song entries at the top of this file first.');
    return;
  }

  let nextOpenSongId = null;

  await db.begin(async tx => {
    for (const song of songsToImport) {
      const singerId = await upsertSinger(tx, song.singer);
      const id = `${slugify(song.singer)}__${slugify(song.title)}`;
      const language = detectLanguage(song.title, song.lyrics);
      const { lyrics, openSongFormat } = buildLyricsAndFormat(song.lyrics);

      const existing = await tx`SELECT open_song_id FROM songs WHERE id = ${id}`;
      let openSongId;
      if (existing.length) {
        openSongId = existing[0].open_song_id;
      } else {
        if (nextOpenSongId === null) {
          const [{ max_id }] = await tx`SELECT MAX(open_song_id) AS max_id FROM songs`;
          nextOpenSongId = (max_id || 0) + 1;
        }
        openSongId = nextOpenSongId++;
      }

      console.log(`${existing.length ? 'Update' : 'Insert'}: [${openSongId}] ${song.title} - ${song.singer} (id=${id})`);

      if (DRY_RUN) continue;

      await tx`
        INSERT INTO songs (id, singer_id, title, lyrics, language, open_song_id, open_song_format, source_name, source_url)
        VALUES (${id}, ${singerId}, ${song.title}, ${lyrics}, ${language}, ${openSongId}, ${openSongFormat}, NULL, NULL)
        ON CONFLICT (id) DO UPDATE SET
          singer_id = EXCLUDED.singer_id, title = EXCLUDED.title, lyrics = EXCLUDED.lyrics,
          language = EXCLUDED.language, open_song_format = EXCLUDED.open_song_format,
          source_name = EXCLUDED.source_name, source_url = EXCLUDED.source_url
      `;
    }
  });

  console.log(`\n${DRY_RUN ? 'Dry run complete' : 'Import complete'}: ${songsToImport.length} song(s) processed.`);
  await db.end();
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
