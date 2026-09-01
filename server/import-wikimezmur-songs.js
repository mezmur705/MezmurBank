// One-off: imports a hand-picked, manually-copied set of songs from wikimezmur.org
// (CC BY-SA licensed) into the database, with attribution (source_name/source_url)
// so the required credit can be shown in both apps.
//
// Every entry below was copied by a human browsing wikimezmur.org directly - this
// script never fetches that site itself. Add one object per song to songsToImport,
// then run with --dry-run first to review before committing.
//
// Usage:
//   node import-wikimezmur-songs.js --dry-run   (prints what would happen, changes nothing)
//   node import-wikimezmur-songs.js             (applies the import)

require('dotenv').config();
const postgres = require('postgres');
const { buildLyricsAndFormat } = require('./lib/lyricsFormat');

const db = postgres(process.env.DATABASE_URL, { ssl: 'require' });
const DRY_RUN = process.argv.includes('--dry-run');

// Add one entry per song here. `title` should follow the existing
// "Amharic Title (Transliteration)" convention used throughout the database.
const songsToImport = [
  {
    title: 'በማለዳ (Bemaleda)',
    singer: 'Hana Tekle',
    lyrics: `የተገባህ ፡ ምስጋና ፡ አንተ ፡ ነህ ፡ የኔ ፡ ጌታ
የተገባህ ፡ ክብር ፡ ላንተ ፡ ነው ፡ የኔ ፡ ጌታ
በምስጋና ፡ ወደፊትህ ፡ እቀርባለሁ ፡ ላመልክህ
እግዚአብሔር ፡ አምላኬ ፡ ሆይ ፡ ይገባሃልና ፡ ለስምህ

በምስጋና ፡ የተፈራህ ፡ ገናና ፡ አምላክ ፡ ነህ
ለዑል ፡ አምላክ ፡ ብንዘምርህ ፡ ብንሰግድልህ ፡ አይበቃህም
አእላፋት ፡ ያንተ ፡ ፍጥረት ፡ ላንተ ፡ ክብር ፡ ያዜማሉ
ቀን ፡ ከለሊት ፡ ያንተን ፡ ስራ ፡ በምስጋና ፡ ያውጃሉ

በማለዳ ፡ ምስጋናዬን ፡ አበዛለሁ ፡ እኔ ፡ አበዛለሁ
በቀትርም/በሌሊትም ፡ ዝማሬዬን ፡ አበዛለሁ ፡ አበዛለሁ /x፪

ስምህ ፡ ሀያል ፡ የአማልክቱም ፡ አምላክ ፡ ገዢ ፡ ነህ
ታላቅ ፡ ጌታ ፡ የሆነልህ ፡ ሰማይ ፡ ምድሩ ፡ ምስጋናህ
መላዕክቱ ፡ ላንተ ፡ ሞገስ ፡ ላንተ ፡ ግርማ ፡ ይዘምራሉ
ባይገልፅህም ፡ በአዲስ ፡ ቅኔ ፡ ምስጋናህን ፡ ያውዳሉ

በማለዳ ፡ ምስጋናዬን ፡ አበዛለሁ ፡ እኔ ፡ አበዛለሁ
በቀትርም/በሌሊትም ፡ ዝማሬዬን ፡ አበዛለሁ ፡ አበዛለሁ /x፪

ለኔ ፡ ብዙ ፡ ተደርጎልኛል/ሆኖልኛል ፡ ኧረ ፡ አኔ ፡ ብዙ ፡ ሆኖልኛል/ተደርጎልኛል
ከማመስገን ፡ በቀር ፡ ምን ፡ ይሻለኛል
ከማመስገን ፡ በቀር ፡ ምን ፡ ይገልፅልኛል
ከማመስገን ፡ በቀር ፡ ምን ፡ ይበጀኛል
ከማመስገን ፡ በቀር ፡ ምን ፡ ይገልፅልኛል /x፪

እስትንፋስ ፡ ያለው ፡ ሁሉ ፡ እግዚአብሔርን ፡ ያመስግን
እግዚአብሔርን ፡ ያመስግን /x፬`,
    sourceUrl: 'https://wikimezmur.org/am/Hana_Tekle/Meswaet/Bemaleda',
  },
  {
    title: 'ስለቴ (Silete)',
    singer: 'Hana Tekle',
    lyrics: `አቤቱ ጩሀቴን ሰምተሃል ምሬቴን የልመናዬን ቃል
በራሴ ያለቀስኩበት ቀን በጊዜው ቀን ተብቆ ሰርቷል
ውዲዬ ስምህን ላነሳሳው ሺ ጊዜ እልፍም ላወድሰው
አባትዬ አላፈርኩብህም አምኜ አልፌብሃለው ተግባርህ ቃልህ ነው

ስለቴ ሰመረ ስለቴ ሰመረ
ከሰው ግምት ያንተ በለጠ ከጠበኩህ የበለጠ
ከእኔው ግምት ያንተ በለጠ ከጠበኩህ የበለጠ

ገረመኝ ለኔስ ደነቀኝ አሄ
ዉለታህ በዝቶብኝ እንዲህ ይስደነከኝ
ምን አይተህብኝ ነው ለዚህ ያበቃሀኝ
ዉለታህ በዝቶብኝ እንዲህ ካስደነከኝ
ምን መልሳለው ዉዴ ክበር ያከበርከኝ

አቤቱ ዉስቴን አድምጠሃል ጭንቀቴም ስጋቴም ገብቶሃል
ውድቀቴን ያለምኩበት ለሊት የደስተ የድል ሆኖልኛል
ውዲዬ ምስጋና አይነስህ ትምክቴም አቅሜም ልበልህ
ደራሽዬ እኔ አይቼሃለው ሳትዘገይ ኤልፌብሃለው ተግባርህ ቃልህ ነው

ስለቴ ሰመረ ስለቴ ሰመረ
ከሰው ግምት ያንተ በለጠ ከጠበኩህ የበለጠ
ከእኔው ግምት ያንተ በለጠ ከጠበኩህ የበለጠ`,
    sourceUrl: '',
  },
  {
    title: 'እየሱስ ፍቅር (Eyesus Fikir)',
    singer: 'Hana Tekle',
    lyrics: `የማያረጅ መውደድ የማይቀያየር
ወረት የማያውቀው እውነተኛ ፍቅር
የኢየሱስ ፍቅር ነው!
የኢየሱስ ፍቅር ነው!
የኢየሱስ ፍቅር ነው!
የኢየሱስ ፍቅር ነው!
የማያረጅ መውደድ የማይቀያየር
ወረት የማያውቀው የሕይወት ሁሉ ሥር
የኢየሱስ ፍቅር ነው!
የኢየሱስ ፍቅር ነው!
የጌታዬ ፍቅር ነው!
የኢየሱስ ፍቅር ነው!

የፍቅርን ትርጉም አትፈልጉት የትም
ከኢየሱስ በስተቀር የትም አይገኝም
ነፍሱን በመስቀል ላይ ሰጠን በጭንቅ አልፎ
እንደሰው ተገኘ ክብሩን አሳልፎ
የኢየሱስ ፍቅር !
የኢየሱስ ፍቅር !
የጌታዬ ፍቅር !
የኢየሱስ ፍቅር!

ሐብታም ደሀ የለም ሁሉም ይወደዳል
የሚናቅ ነፍስ የለም ሁሉን ይፈልጋል
ፍቅሩ እንደባህር ነው የማይነጥፍ ዘላለም
ለሰው ልጅ በሙሉ ቢቀዳ አይጎድልም!
የኢየሱስ ፍቅር!
የኢየሱስ ፍቅር!
የጌታዬ ፍቅር!
የኢየሱስ ፍቅር!

ማይለወጥ የማይናወጥ ፍቅር ኢየሱስ ነው
ማይመዘን የማይለካ ዘላለም ውድ ነው!
ማይናወጥ የማይለወጥ ፍቅር ኢየሱስ ነው
ማይመዘን የማይለካ ዘላለም ሚወደው!

ኢየሱስ ፍቅር ነው!
ኢየሱስ ፍቅር ነው!
ጌታዬ ፍቅር ነው!
ኢየሱስ ፍቅር ነው!

የሕይወት ምንጭ
ኢየሱስ ፍቅር
ኢየሱስ ፍቅር
ኢየሱስ ፍቅር`,
    sourceUrl: '',
  },
  {
    title: 'እግዚአብሔር (Egziabher)',
    singer: 'Hana Tekle',
    lyrics: `በሰማይ በምድር አቻ የለህ
ወሰን ልኬት የለው ግዛትህ
ክብርህ ሰማያትን ሸፍኖ
ላይደረስበት አለ ገኖ

ሰማይ በምድር አቻ የለህ
ወሰን ልኬት የለው ግዛትህ
ክብርህ ሰማያትን ሸፍኖ
አይደረስበትም አለ ገኖ

እግዚአብሔር እግዚአብሔር 4x

አንተ ሰማያትን ምድርን ሞልተሀል
አለቅነት ስልጣን አንተን ያመልኩሀል
የለም ካንተ በላይ ደርሶ ሚጠጋጋ
ገናናነት ክብር ሁሌም አንተ ጋ

እግዚአብሔር እግዚአብሔር 4x

ሁሉን ታደርግ ዘንድ ቻይ ነህ አንተ
ሀሳብህም ከቶ አይከለከልም
በምድር ያለው ሁሉ ገንዘብህ ነው
ካንተ የተሰወረ የለም ምንም

እግዚአብሔር እግዚአብሔር 4x

ከዜማ በላይ ነው ክብርህ
ከቃላት በላይ ነው ማንነትህ
እግዚአብሔር አንተ ታላቅ ነህ
አንተን መሣይ የሌለህ 2x

እግዚአብሔር እግዚአብሔር 4x`,
    sourceUrl: '',
  },
  {
    title: 'ምነው (Menew)',
    singer: 'Hillina Kassahun',
    lyrics: `(ምነው ምነው ምነው ምነው እየሱስ እያለ ልብህ ያዘነው
ምነው ምነው ምነው ምነው እግዚአብሔር እያለ ልብሽ ያዘነው)

ምነው ምነው ምነው ምነው እየሱስ እያለ ልብህ ያዘነው
ምነው ምነው ምነው ምነው እግዚአብሔር እያለ ልብሽ ያዘነው

ትዝ አይልህም ወይ ከየት እንዳወጣህ.. አሀሀ
ከተደፋፈነው ከድቅድቅ ጨለማ … አሀሀ
ትርፍ ዋጋ የለውም አበቃለት በቃ ..አሀሀ
በተባለው ሰፈር ታሪክህን ሰራ …አሀሀ
የተከመረውን ትልቁን ተራራ..አሀሀ
በአንድ ቃል እንዳልነበር አፈረሰው እና..አሀሀ
ማያልቀው እንባህን ከአይኞችህ ላይ
ጌታ አብሶልህ አላየህም ወይ
ዝናብ ከላይ ወርዶ እንዳይመለስ
ምድርና መላዋን ሳያረሰርስ
እንዲሁ እኮ ነው የእግዚአብሔር ቃል
ተፈፅሞ አየን አንዳች ሳትቀር (2x)

(ኦሆ አሆሆሆ አሀሀሀ)

ቆም ብለህ ወደላይ ብታይ ለደቂቃ .. አሀሀ
ሳቅልኝ ይልሀል የሰራዊት ጌታ .. አሀሀ
አታውቀውም ወይ የልቤን ደስታ.. አሀሀ
አንተ ስትስቅልኝ ነፍስህም ሲረካ.. አሀሀ
የድሮውን ትተህ በእኔ ስትመካ .. አሀሀ
በሙሉ መንፈስህ በሙሉ ሀሳብህ
አምነኸኝ ስትኖር ልቤን አስደሰትክ
ዝናብ ከላይ ወርዶ እንዳይመለስ
ምድርና መላዋን ሳያረሰርስ
እንዲሁ እኮ ነው የምነግርህ ቃል
ፀንተህ ስትጠብቀው ፍፃሜው አይቀር (2x)

ምነው ምነው ምነው ምነው እየሱስ እያለ ልብህ ያዘነው
ምነው ምነው ምነው ምነው እግዚአብሔር እያለ ልብሽ ያዘነው (3x)`,
    sourceUrl: '',
  },
  {
    title: 'ስራህ ግሩም (Serah Gerum)',
    singer: 'Hillina Kassahun',
    lyrics: `(ግሩም ግሩም ግሩም እና ድንቅ….. ነህ እግዚአብሔር )

አሻግርሻለሁ ስትል የታመንከው
በራስህ ጉልበት በራስህ ጉልበት
እኔ አቆምሻለሁ ስትል የታመንከው
በራስህ ጉልበት በራስህ ጉልበት
ጥያቄ የለኝም ጥርጥር አይገባኝ
ስራው የእኔ እኮ ነው ብለኸኛል ታማኝ (2x)

ኦሆ እግዚአብሔር ድንቅ ነህ
ኦሆ ክንድህን አይቻለሁ
ኦሆ የደነደነውን ልብ
ኦሆ እንደሰም ስታቀልጠው
ኦሆ ነፍሴ ተማርካለች ኦሆ እስከለዘላለም
ኦሆ ከሀሳብህ ውጪ ኦሆ የሚወስደኝ የለም

ስራህ ግሩም እና ድንቅ ነው (3x)
እኔ እላለሁ
ክብርህ ግሩም እና ድንቅ ነው (3x)
እኔ እላለሁ

አቤት በሰራኸው ባደረከው ሁሉ
እጅግ ተደንቄ ተገርሚያለሁ
ክብርህን ስትገልጥ ዝናህን ስታሳይ
አጋዥ አትፈልግም አንት የሌለህ ከልካይ
ባደረከው ሁሉ በሰራህልኝ
ከተመስገን ሌላ የምለው የለኝ
ነገር ግን በፊትህ በክብርህ ውስጥ ሆኜ
ጌታ እልሀለሁ...

ስራህ ግሩም እና ድንቅ ነው (3x)
እኔ እላለሁ
ክብርህ ግሩም እና ድንቅ ነው (3x)
እኔ እላለሁ

ኦሆ ሰማያት ክብርህን ኦሆ ክብርህን ያወራሉ
ኦሆ ፍጥረታትም ደግሞ ኦሆ ይመሰክራሉ
ኦሆ እነርሱ ገብቷቸው ኦሆ ይገባዋል ካሉ
ኦሆ እኔ እኔማ እንዴት አልል ኦሆ ስራህ ግሩም

ስራህ ግሩም እና ድንቅ ነው (3x)
እኔ እላለሁ
ክብርህ ግሩም እና ድንቅ ነው (3x)
እኔ እላለሁ`,
    sourceUrl: '',
  },
  {
    title: 'ቀሪ (Qeri)',
    singer: 'Hillina Kassahun',
    lyrics: `ቀሪ
ቀሪ ሀብቴ ትርፍ ድርሻ ክፍያ ዋጋዬ
አንተ አይደለህም ወይ (4x)

በዙፉንህ ላይ ተቀምጠህ
ምድርና ሞላዋን በጅህ ይዘህ
የምትኖር አንተ ባለግርማ
እጠብቅሀለሁ ቀንና ቀንና ማታ
በዙፉንህ ላይ ተቀምጠህ
ምድርና ሞላዋን በጅህ ይዘህ
የምትኖር አንተ ባለግርማ
ትናፍቀኛለህ ቀንና ቀንና ማታ
እጠብቅሀለሁ ቀንና ቀንና ማታ (2x)
ትናፍቀኛለህ ቀንና ቀንና ማታ
ትናፍቀኛለህ

ለህ ተሸክመህ እዚህ ያቆምከኝ
በምድረበዳም ውስጥ ለነፍሴ ውሀ የሆንከኝ
አጥንቶቼንም ያበረታሀቸው
ለካ ትበቃለህ ሌላው ከንቱ ነው
ምድር ሁሉ ሲነዋወጥ የወለደ ሲረሳ
ለአንድ ቀን አተወኝም የኔ ታማኝ እረኛ
ምድር ሁሉ ሲነዋወጥ የወለደ ሲረሳ
ለአንድ ቀን አትጥለኝም የኔ ታማኝ እረኛ

ምንም እንኳን በለስ ባታፈራ
በወይንም ሀረግ ፍሬ ባይገኝም
የማልፍበት መንገድ ባይገባኝም
የዚህ ምድር ጉዞ ከቶ አያሰጋኝም
አይኖቼ ወደከፍታ ወዳለክበት ስፍራ
አትኩረው ያዩሀል ደግመህ እስከምትመጣ (2x)

በዙፉንህ ላይ ተቀምጠህ
ምድርና ሞላዋን በጅህ ይዘህ
የምትኖር አንተ ባለግርማ
እጠብቅሀለሁ ቀንና ቀንና ማታ
በዙፉንህ ላይ ተቀምጠህ
ምድርና ሞላዋን በጅህ ይዘህ
የምትኖር አንተ ባለግርማ
ትናፍቀኛለህ ቀንና ቀንና ማታ
እጠብቅሀለሁ ቀንና ቀንና ማታ (2x)
ትናፍቀኛለህ ቀንና ቀንና ማታ
ትናፍቀኛለህ`,
    sourceUrl: '',
  },
  {
    title: 'አባት አለኝ (Abat Alegn)',
    singer: 'Hillina Kassahun',
    lyrics: `እገባለሁ ወደ ማደሪያው ወደ ዙፋኑ (2x)
የሰማያት ጆች ተከፍቶልኝ ስላየሁ ስላየሁ
አዲስ ሞገስ አዲስ ቅባት በየጠዋቱ በየጠዋቱ
ይዞ ይጠብቀኛል ንጉሱ (3x)

አላጠረም እጁ አልተደፊነም ጆሮው (2x)
አልከፍትም አንደበቴን ላጉረመርም ላሳዝን አባቴን (2x)

አባት አለኝ በሰማይ የማይጥል የማይሳኝ (2x)
አባት አለኝ በሰማይ የማይጥል የማይሳኝ (2x)
አምላክ አለኝ በሰማይ የማይጥል የማይሳኝ (2x)
አምላክ አለኝ በሰማይ የማይጥል የማይሳኝ (2x)

እንዴት ያምርበታል ጻድቅ ሲያመሰግን
ለተፊጠረለት ለአምላኩ ሲዘምር
ፍጥረት ሁሉ ይጮሀል ስለቅድስናህ
አልተነቃነቀም ንጉሱ ከስፍራው
እኔም እስማማለሁ ፊቱን አይቻለሁ
ነፍሴ አልረካችም ገና ዘምራለሁ
ክብሩን አወራለሁ ገና አመልካለሁ

አባት አለኝ በሰማይ የማይጥል የማይሳኝ (2x)
አባት አለኝ በሰማይ የማይጥል የማይሳኝ (2x)
አምላክ አለኝ በሰማይ የማይጥል የማይሳኝ (2x)
አምላክ አለኝ በሰማይ የማይጥል የማይሳኝ (2x)

እናት እንኳን ልጇን ትረሳ ይሆናል
እሱ ግን እራሱን አሳልፎ ሰጥቶአል
አለም ሳትፊጠር ከመረጠን በጉ
ምን አለ ማይሰጠን ለኛ ለልጆቹ
ምን አይነት ፍቅር ነው እንዲህ የሚፊሰው
ወደ በጐ ሀሳብህ አቅፎ ሚመልሰው
ለክብሩ ሚያቆመው አቅፎ ሚመልሰው

አላጠረም እጁ አልተደፊነም ጆሮው (2x)
አልከፍትም አንደበቴን ላጉረመርም ላሳዝን አባቴን (2x)

አባት አለኝ በሰማይ የማይጥል የማይሳኝ (2x)
አባት አለኝ በሰማይ የማይጥል የማይሳኝ (2x)
አምላክ አለኝ በሰማይ የማይጥል የማይሳኝ (2x)
አምላክ አለኝ በሰማይ የማይጥል የማይሳኝ (2x)`,
    sourceUrl: '',
  },
  {
    title: 'አለ ጌታዬ (Ale Gietayie)',
    singer: 'Lishan Woldemedhin',
    lyrics: `ትላንት የረዳኝ በዙፋኑ ላይ
ተቀምጦ አለ በሰማይ (2x)

አለ ጌታዬ አለ
አለ አምላኬ አለ
አለ ጌታዬ አለ
አለ አምላኬ አለ

ግራ ግብት ሲለኝ
ሰልፉ በርትቶ ሲያይልብኝ
ልቤን በእግዚአብሔር ላበርታ
አለ እያልኩኝ ጌታ

አለ ጌታዬ አለ
አለ አምላኬ አለ
አለ ጌታዬ አለ
አለ አምላኬ አለ

አንተ ካለህልኝ በዘመኔ
ሌላ ምን ያሻኛል ለኔ (4x)

ከምችለው በላይ እንዳልፈተን
ይጠብቃል ዙሪያዬን
እንደፈቃዱ ደግሞ በጊዜዉ
ያዘጋጅልኛል መውጫዉን

አለ ጌታዬ አለ
አለ አምላኬ አለ
አለ ጌታዬ አለ
አለ አምላኬ አለ

አንተ ካለህ ይበቃል
አንተ ካለህ (4x)

አለ ጌታዬ አለ
አለ አምላኬ አለ
አለ ጌታዬ አለ
አለ አምላኬ አለ

አንተማ ለእኔ ማምለጫ መሸሸጊያ መከለያዬ
አንተማ ለእኔ ዕድሌ ፈንታዬ መኖሪያዬ
አንተ ካለህልኝ በዘመኔ
ሌላ ምን ያሻኛል ለኔ (4x)`,
    sourceUrl: '',
  },
  {
    title: 'አንተ ኮ ያው አንተ ነህ (Ante Ko Yaw Ante Neh)',
    singer: 'Mesfin Gutu',
    lyrics: `አንተ እኮ ያው አንተው ነህ
ሸለቆም ቢሆን ያው አንተው ነህ
ከፍታም ቢሆን ያው አንተው ነህ
አንተ እኮ ያው አንተው ነህ

ጎንበስ ቀና ብዬ ጌታዬን ላክብረው
ያምላኬ ወለታው እጅጉን ብዙ ነው
በጨነቀኝ ጊዜ በጊዜው መጣና
ጏዳዬን አስዋበው እርሱ ደረሰና ጌታዬ መጣና

አምላኬ ክብር ከሆነልኝማ
ልሰዋ ምስጋና
እየሱስ ክብር ከሆነልኝማ
ልሰዋ ምስጋና

እሱ እኮ ሲመጣ አምላኬ ሲመጣ
ጌታዬ ሲመጣ አባቴ ሲመጣ
ሁሉ መግቢያ አጣ
ችግር መግቢያ አጣ

አንተ እኮ ያው አንተው ነህ …

ጠላት አይኑ እያየ እኔን ላከበረ
ገና ጨምራለው መቼ ተዘመረ
አሁን የዘምርኩት ገና ምዘምረው
ለእየሱሰ ክብር ይኸ ይሁንለት አሜን ይሁንለት

አምላኬ ክብር ከሆነልኝማ …

እሱ እኮ ሲመጣ …

አንተ እኮ ያው አንተው ነህ …`,
    sourceUrl: '',
  },
  {
    title: 'ዝም አለልም (Zem Alelem)',
    singer: 'Mesfin Gutu',
    lyrics: `እኔስ ዝም አልልም እንዴት ዝም እላለሁ
የተደረገልኝ ከማንም በላይ ነው (2x)
ከማንም በላይ ነው ከማንም በላይ ነው
የብቻዬ አንተ የብቻዬ (2x)
ወግ ማዕረጌ አንተ ወግ ማዕረጌ (2x)

(ቅጥር ተሰራልኝ አሀሀሀ አሀሀሀ አሀሀሀ በከበረው ጌታ
የማይቻለውን ኦሆሆሆ ኦሆሆሆ ኦሆሆሆ ስንቱ የተረታ) 2x
ታዲያ መዘመር ነው እንጂ ላንተ አሀሀ ላንተ
ታዲያ መገዛት ነው እንጂ ላንተ ኦሆሆ ላንተ
(ላንተ አሀሀ ላንተ
ላንተ ኦሆሆ ላንተ) 2x
የብቻዬ አንተ የብቻዬ (2x)
ወግ ማዕረጌ አንተ ወግ ማዕረጌ (2x)
እኔስ ዝም አልልም እንዴት ዝም እላለሁ
የተደረገልኝ ከማንም በላይ ነው (2x)
ከማንም በላይ ነው ከማንም በላይ ነው
የብቻዬ አንተ የብቻዬ (2x)
ወግ ማእረጌ አንተ ወግ ማእረጌ (2x)

(ኧረ ስንቱን ስንቱን ስንቱን ስንቱን ስንቱን ስንቱን ስንቱን ስንቱን ስንቱን ተሻገርኩኝ
በነፍስ በስጋዬ የባረከኝ ያከበርከኝ የረዳኸኝ እዚያው ደረስኩኝ) 2x
ታዲያ መዘመር ነው እንጂ ላንተ አሀሀ ላንተ
ታዲያ መገዛት ነው እንጂ ላንተ ኦሆሆ ላንተ
(ላንተ አሀሀ ላንተ
ላንተ ኦሆሆ ላንተ) 2x
የብቻዬ አንተ የብቻዬ (2x)
ወግ ማእረጌ አንተ ወግ ማእረጌ (2x)`,
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
        VALUES (${id}, ${singerId}, ${song.title}, ${lyrics}, ${language}, ${openSongId}, ${openSongFormat}, 'WikiMezmur', ${song.sourceUrl})
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
