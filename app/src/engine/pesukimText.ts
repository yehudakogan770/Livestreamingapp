// The Rebbe's 12 Pesukim, ready to use: the Hebrew, how each word sounds
// and what each word means, word for word (the same number of words in each;
// a hyphen joins words that go together, "_" is a word with no English).

export interface PasukText {
  text: string;
  translit: string;
  english: string;
  /** What the whole pasuk means. */
  translation: string;
}

export const TWELVE_PESUKIM: PasukText[] = [
  {
    text: 'תּוֹרָה צִוָּה לָנוּ מֹשֶׁה, מוֹרָשָׁה קְהִלַּת יַעֲקֹב.',
    translit: 'Torah tzivah lanu Moshe, morashah kehilas Yaakov.',
    english: 'The-Torah commanded to-us Moshe, an-inheritance of-the-congregation-of Yaakov.',
    translation: 'The Torah that Moshe commanded us is the inheritance of the congregation of Yaakov.',
  },
  {
    text: 'שְׁמַע יִשְׂרָאֵל, ה׳ אֱלֹקֵינוּ, ה׳ אֶחָד.',
    translit: 'Shema Yisrael, Hashem Elokeinu, Hashem Echad.',
    english: 'Hear, O-Israel: G-d is-our-G-d, G-d is-One.',
    translation: 'Hear, O Israel: G-d is our G-d, G-d is One.',
  },
  {
    text: 'בְּכָל דּוֹר וָדוֹר חַיָּב אָדָם לִרְאוֹת אֶת עַצְמוֹ כְּאִלּוּ הוּא יָצָא מִמִּצְרַיִם.',
    translit: "Bechol dor vador chayav adam liros es atzmo ke'ilu hu yatza miMitzrayim.",
    english: 'In-every generation and-generation is-obligated a-person to-see _ himself as-if he went-out from-Egypt.',
    translation: 'In every generation a person must see himself as if he himself went out of Egypt.',
  },
  {
    text: 'כָּל יִשְׂרָאֵל יֵשׁ לָהֶם חֵלֶק לָעוֹלָם הַבָּא, שֶׁנֶּאֱמַר: וְעַמֵּךְ כֻּלָּם צַדִּיקִים, לְעוֹלָם יִירְשׁוּ אָרֶץ, נֵצֶר מַטָּעַי, מַעֲשֵׂה יָדַי לְהִתְפָּאֵר.',
    translit:
      "Kol Yisrael yesh lahem chelek le'olam haba, shene'emar: ve'ameich kulam tzaddikim, le'olam yirshu aretz, netzer mata'ai, ma'aseh yadai lehispa'er.",
    english:
      'All Israel have _ a-share in-the-World to-Come, as-it-says: and-your-people are-all righteous, forever they-will-inherit the-land, the-branch of-My-planting, the-work of-My-hands in-which-I-take-pride.',
    translation:
      'All Israel have a share in the World to Come, as it says: “Your people are all righteous; they will inherit the land forever. They are the branch of My planting, the work of My hands, in which I take pride.”',
  },
  {
    text: 'כִּי קָרוֹב אֵלֶיךָ הַדָּבָר מְאֹד, בְּפִיךָ וּבִלְבָבְךָ לַעֲשֹׂתוֹ.',
    translit: "Ki karov eilecha hadavar me'od, beficha uvilvavcha la'asoso.",
    english: 'For close to-you is-the-thing very, in-your-mouth and-in-your-heart, to-do-it.',
    translation: 'For the thing is very close to you — in your mouth and in your heart — to do it.',
  },
  {
    text: 'וְהִנֵּה ה׳ נִצָּב עָלָיו, וּמְלֹא כָל הָאָרֶץ כְּבוֹדוֹ, וּמַבִּיט עָלָיו, וּבוֹחֵן כְּלָיוֹת וָלֵב, אִם עוֹבְדוֹ כָּרָאוּי.',
    translit: "Vehinei Hashem nitzav alav, umelo chol ha'aretz kevodo, umabit alav, uvochein kelayos valev, im ovdo kara'ui.",
    english:
      'And-behold G-d stands over-him, and-full is-all the-earth of-His-glory, and-He-looks upon-him, and-searches his-mind and-heart, whether he-serves-Him as-is-fitting.',
    translation:
      'G-d stands over him, the whole world is full of His glory, and He looks upon him and searches his mind and heart, to see if he serves Him as he should.',
  },
  {
    text: 'בְּרֵאשִׁית בָּרָא אֱלֹקִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ.',
    translit: "Bereishis bara Elokim es hashamayim ve'es ha'aretz.",
    english: 'In-the-beginning created G-d _ the-heavens and the-earth.',
    translation: 'In the beginning G-d created the heavens and the earth.',
  },
  {
    text: 'וְשִׁנַּנְתָּם לְבָנֶיךָ וְדִבַּרְתָּ בָּם, בְּשִׁבְתְּךָ בְּבֵיתֶךָ, וּבְלֶכְתְּךָ בַדֶּרֶךְ, וּבְשָׁכְבְּךָ וּבְקוּמֶךָ.',
    translit: 'Veshinantam levanecha vedibarta bam, beshivtecha beveisecha, uvelechtecha vaderech, uveshochbecha uvekumecha.',
    english:
      'And-you-shall-teach-them to-your-children and-speak of-them, when-you-sit in-your-home, and-when-you-go on-the-way, and-when-you-lie-down and-when-you-rise.',
    translation: 'Teach them to your children and speak of them when you sit in your home, when you go on the way, when you lie down and when you rise up.',
  },
  {
    text: 'יָגַעְתִּי וְלֹא מָצָאתִי, אַל תַּאֲמִין, לֹא יָגַעְתִּי וּמָצָאתִי, אַל תַּאֲמִין, יָגַעְתִּי וּמָצָאתִי, תַּאֲמִין.',
    translit: "Yagati velo matzasi, al ta'amin, lo yagati umatzasi, al ta'amin, yagati umatzasi, ta'amin.",
    english:
      'I-worked-hard and-did-not succeed, don’t believe-it, I-did-not work-hard and-succeeded, don’t believe-it, I-worked-hard and-succeeded, believe-it!',
    translation:
      'If someone says “I worked hard but did not succeed,” don’t believe him. “I did not work hard but I succeeded,” don’t believe him. “I worked hard and I succeeded,” believe him!',
  },
  {
    text: 'וְאָהַבְתָּ לְרֵעֲךָ כָּמוֹךָ, רַבִּי עֲקִיבָא אוֹמֵר: זֶה כְּלָל גָּדוֹל בַּתּוֹרָה.',
    translit: "Ve'ahavta lerei'acha kamocha, Rabbi Akiva omer: zeh klal gadol baTorah.",
    english: 'And-you-shall-love your-fellow as-yourself, Rabbi Akiva says: this-is a-principle great in-the-Torah.',
    translation: 'Love your fellow as yourself. Rabbi Akiva says: this is a great principle of the Torah.',
  },
  {
    text: 'וְזֶה כָּל הָאָדָם וְתַכְלִית בְּרִיאָתוֹ וּבְרִיאַת כָּל הָעוֹלָמוֹת עֶלְיוֹנִים וְתַחְתּוֹנִים, לִהְיוֹת לוֹ דִּירָה זוֹ בַּתַּחְתּוֹנִים.',
    translit: "Vezeh kol ha'adam vesachlis beri'aso uveri'as kol ha'olamos elyonim vesachtonim, lihyos lo dirah zu betachtonim.",
    english:
      'And-this-is all-of man, and-the-purpose of-his-creation and-the-creation of-all the-worlds, upper and-lower: to-make for-Him a-home _ in-this-lowest-world.',
    translation: 'This is the whole purpose of man, and of the creation of all the worlds, upper and lower: to make a home for G-d in this lowest world.',
  },
  {
    text: 'יִשְׂמַח יִשְׂרָאֵל בְּעֹשָׂיו, פֵּירוּשׁ, שֶׁכָּל מִי שֶׁהוּא מִזֶּרַע יִשְׂרָאֵל, יֵשׁ לוֹ לִשְׂמוֹחַ בְּשִׂמְחַת ה׳, אֲשֶׁר שָׂשׂ וְשָׂמֵחַ בְּדִירָתוֹ בַּתַּחְתּוֹנִים.',
    translit:
      "Yismach Yisrael be'osav, peirush, shekol mi shehu mizera Yisrael, yesh lo lismo'ach besimchas Hashem, asher sas vesame'ach bedirato betachtonim.",
    english:
      'Let-rejoice Israel in-its-Maker; this-means, that-everyone who is of-the-children-of Israel, should _ rejoice in-the-joy-of G-d, Who is-glad and-rejoices in-His-home in-this-lowest-world.',
    translation:
      'Let Israel rejoice in its Maker: everyone who comes from Israel should share in the joy of G-d, Who rejoices in His home in this lowest world.',
  },
];
