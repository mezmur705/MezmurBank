// One-off: populate Singers.AmharicName with best-effort Amharic transliterations.
// Usage: node translate-singers.js
require('dotenv').config();
const sql = require('mssql');

const dbConfig = {
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { trustServerCertificate: true, encrypt: false }
};

// Keyed by Singers.Id. Best-effort phonetic transliteration into Amharic script -
// personal names don't "translate", so treat these as approximate renderings to spot-check.
const translations = {
  89: "አባ ናትናኤል ታዬ",
  21: "አቤኔዘር ለገሰ",
  24: "አቤኔዘር ታገሰ",
  93: "አብርሃም - ኢያሱ ተክለማርያም",
  45: "አዲስ አበባ አማኑኤል ህብረት",
  63: "አዲስ አበባ መካነ ኢየሱስ መዘምራን",
  102: "አዲስ አበባ መሠረተ ክርስቶስ መዘምራን",
  153: "አዲስዓለም 'አዲስ' አሰፋ",
  147: "አዲሱ ወርቁ",
  103: "አገኘሁ ይድግ",
  72: "አሃቫ ጎስፔል ዘማሪዎች",
  79: "አሉላ ጌታሁን",
  38: "አናን ደሳለኝ",
  115: "አረነት ከበደ",
  47: "አስፋው መለሰ",
  19: "አሸናፊ በሲር",
  5: "አሸናፊ ጉልቲ",
  37: "አስማማው ብርሃኑ",
  117: "አስራት ሙላቸው",
  121: "አስቴር አበበ",
  46: "አስቴር ሞገስ",
  76: "አስቴር ዮሴፍ",
  143: "አውታሩ ከበደ",
  113: "አይዳ አብርሃም",
  114: "አዜብ ኃይሉ",
  48: "አዜብ መለሰ",
  53: "በረከት አለሙ",
  17: "በረከት ፈቃዱ",
  111: "በረከት ተስፋዬ",
  130: "ቤተልሔም 'ቤቲ' ተዘራ",
  98: "ቤተልሔም 'ቤቲ' ወልደ",
  68: "ቤተልሔም ታምራት",
  35: "ቤዛ አምልኮ አገልግሎት",
  56: "ብዙ ሙሉጌታ",
  6: "ቢንያም መኮንን",
  58: "ቢንያም ዋለ",
  141: "ብሩክታዊት አሰፋ",
  73: "ብሩክ ገብረፃዲቅ",
  109: "ካሌብ ተስፋዬ",
  66: "ካሮል ፈቃዱ",
  148: "ክላሲክስ",
  134: "ዳግማዊ 'ዳጊ' ጥላሁን",
  150: "ዳንኤል አምደሚካኤል",
  118: "ዳዊት 'ዳኒ' ወልደ",
  127: "ዳዊት ጌታቸው",
  96: "ዳዊት ሞላለኝ ፓስተር",
  106: "ደረጀ ከበደ",
  14: "ደረጀ ሙላቱ",
  94: "ኤደን እምሩ",
  62: "ኤዶም ልዑልሰገድ",
  28: "ኢ.ኢ.ሲ.ሲ ኬንያ ናይሮቢ",
  22: "ኤፍሬም አያሌው",
  49: "ኤልያስ አብቴ",
  133: "ኤልያስ ገመቹ",
  31: "ኤልያስ ሽፈራው",
  83: "ኤልሳ ጌታቸው",
  82: "እንዳለ ወልደጊዮርጊስ",
  138: "እንዳልካቸው 'ኤናዋ' ሃዋዝ",
  154: "እንዳሻው 'ቾምቤ' ታሪኩ",
  10: "እንደልቤ_ወንድማገኝ",
  71: "እንድርያስ ሃዋዝ",
  57: "ኤፍሬም አለሙ",
  18: "ኤፍሬም ዳኘ",
  41: "ወንጌላዊት ክርስቶስ ቤተክርስቲያን ሙኒክ መዘምራን",
  125: "እየሩሳሌም 'ጄሪ' ነጊያ",
  3: "ፋሬስ መዘምራን",
  64: "ፌቤን ደምሴ",
  33: "ፌቨን በርሃኑ",
  95: "ፍልሞን ዮሐንስ",
  137: "ጌታቸው ታደሰ",
  142: "ጌታየወቀል ግርማይ - ብሩክታዊት አሰፋ",
  44: "ግሩም ታደሰ",
  80: "ጉለሌ ቤቴል ቤተክርስቲያን መዘምራን",
  20: "ሃብታሙ ኩመላ",
  65: "ኃይለኢየሱስ ታደሰ",
  124: "ሃና ተክሌ",
  74: "ሃና አላዩ",
  51: "ሐረር አማኑኤል መንፈሳዊ ማህበር",
  26: "ሄኖክ አዲስ",
  151: "ህሊና ካሳሁን",
  27: "ሆሳዕና ቃለ ሕይወት ቤ/ክ መዘምራን",
  77: "ቃልአብ ፀጋዬ",
  104: "ቃልኪዳን 'ሊሊ' ጥላሁን",
  16: "ቃልኪዳን ጥላሁ",
  60: "ካሳሁን ለማ ፓስተር",
  101: "ኬፋ ሚደቅሳ",
  34: "ቅድስት 'ኪዲ' ካሳ",
  144: "ልዓለም 'ላሊ' ጥላሁን ዶ/ር",
  43: "ለገሰ ታደሰ",
  2: "ለምለም ንጋቱ",
  50: "ልድያ ተስፋዬ",
  91: "ማማይ ወርቁ",
  145: "ምህረት እጣፋ",
  55: "መካሻው ካሳ - ፀባኦት እንገዳ",
  32: "መቅደስ አዳሙ",
  128: "መክሬዝ ወጣቶች አገልግሎት",
  39: "መንግስቱ ከበደ",
  81: "መሠረት ፀጌ - እንዳልካቸው ኪዳነወልድ",
  86: "መስፍን ጉቱ",
  90: "መስፍን ማሞ ፓስተር",
  132: "መስከረም ጌቱ",
  52: "መዝሙረ ደረጀ",
  9: "ሙላቱ ዘለቀ ኤቫ",
  40: "ናሆም ማርቆስ",
  108: "ናዝሬት አማኑኤል ሸብሸባ መዘምራን",
  8: "ናዝሬት ሽብሸባ መዘምራን",
  87: "ነፃነት አሰፋ",
  59: "ሰሜን ናዝሬት መሠረተ ክርስቶስ ቤተክርስቲያን ልጆች",
  70: "ፓስተር ዮሐንስ 'ጆኒ' ግርማ",
  155: "ፓወርፖይንት",
  88: "ረዳ አብርሃም",
  84: "ሮማን ሎሬንሶ",
  97: "ሮማን ሳሙኤል",
  54: "ሩት ታደሰ",
  67: "ሳምራዊት ሲዛር",
  112: "ሳሙኤል አበበ",
  85: "ሳሙኤል ቦርሳሞ",
  136: "ሳሙኤል ካሳሁን",
  135: "ሳሙኤል ንጉሴ",
  119: "ሳሙኤል 'ሳሚ' ተስፋሚካኤል",
  152: "ሰላም ደስታ",
  13: "ሰመረአብ አብዮ",
  36: "ሰናይት እንገዳ",
  7: "ሽመልስ ፍላጤ",
  25: "ሲሳይ አበበ",
  149: "ሶፍያ ሺባባው",
  4: "ሰለሞን ነጋሽ",
  100: "ሰለሞን ይርጋ",
  122: "ታደሰ እሸቴ",
  42: "ታደሰ መኩሪያ",
  99: "ታጋይ ወልደማርያም",
  92: "ታምራት ኃይሌ ፓስተር",
  110: "ተፈራ ነጋሽ",
  139: "ተከስተ ጌትነት",
  30: "ተመስገን አበራ",
  120: "ተመስገን ማርቆስ",
  78: "ቴዎድሮስ 'ቴዲ' ታደሰ",
  123: "ተስፋዬ ጫላ",
  116: "ተስፋዬ ገቢሶ",
  131: "ትዕግስት አለሙ",
  61: "ጽዮን አየለ",
  75: "ዊነርስ ቻፔል ኢንተርናሽናል ጎተራ ቤተክርስቲያን",
  11: "ወንድማገኝ ባዬ ፓስተር",
  107: "ወርቅነህ አላሮ",
  140: "ይድነቃቸው ተካ",
  23: "ዮሐንስ ፍቃዱ",
  105: "ዮሐንስ በላይ",
  126: "ዮሴፍ በቀለ",
  129: "ዮሴፍ 'ጆሲ' ካሳ",
  29: "ዮሴፍ አያሌው",
  12: "ዮሴፍ 'ጆሲ' ሥለሺ",
  15: "ዛማር ጎስፔል ሙዚቃ ባንድ",
  69: "ዘካርያስ 'ዜኪ' ጌታቸው",
  146: "ዜማ ለክርስቶስ"
};

async function main() {
  const pool = await sql.connect(dbConfig);

  // Clean up the leftover test row from earlier manual API testing (0 songs, not a real singer).
  const delResult = await pool.request().query("DELETE FROM dbo.Singers WHERE Name = 'Test Singer' AND NOT EXISTS (SELECT 1 FROM dbo.Songs WHERE SingerId = Singers.Id)");
  console.log(`Removed ${delResult.rowsAffected[0]} leftover test singer row(s).`);

  let updated = 0;
  for (const [id, amharicName] of Object.entries(translations)) {
    const req = pool.request();
    req.input('Id', sql.Int, Number(id));
    req.input('AmharicName', sql.NVarChar(300), amharicName);
    const result = await req.query('UPDATE dbo.Singers SET AmharicName = @AmharicName WHERE Id = @Id');
    updated += result.rowsAffected[0];
  }
  console.log(`Updated ${updated} singer rows with AmharicName.`);

  const missing = await pool.request().query('SELECT Id, Name FROM dbo.Singers WHERE AmharicName IS NULL');
  if (missing.recordset.length) {
    console.log('Singers still missing AmharicName:');
    missing.recordset.forEach(r => console.log(`  ${r.Id}: ${r.Name}`));
  } else {
    console.log('All singers now have an AmharicName.');
  }

  await pool.close();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
