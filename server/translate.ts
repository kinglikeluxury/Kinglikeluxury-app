import translate from "google-translate-api-x";

const SUPPORTED_LANGS: Record<string, string> = {
  en: "en",
  ar: "ar",
  he: "iw",
  ru: "ru",
  ka: "ka",
  az: "az",
  tr: "tr",
  zh: "zh-CN",
  pl: "pl",
  it: "it",
};

export async function translateText(text: string, targetLang: string, sourceLang?: string): Promise<string> {
  const googleTargetLang = SUPPORTED_LANGS[targetLang];
  if (!googleTargetLang) return text;

  try {
    const options: any = { to: googleTargetLang };
    if (sourceLang) {
      const googleSourceLang = SUPPORTED_LANGS[sourceLang];
      if (googleSourceLang) options.from = googleSourceLang;
    }
    const result = await translate(text, options);
    return result.text;
  } catch (error) {
    console.error(`Translation error for lang ${targetLang}:`, error);
    return text;
  }
}

export async function detectLanguage(text: string): Promise<string> {
  try {
    const result = await translate(text, { to: "en" });
    const detectedLang = result.from?.language?.iso;
    if (detectedLang) {
      const mapped = Object.entries(SUPPORTED_LANGS).find(([_, gLang]) => gLang === detectedLang || detectedLang === _);
      if (mapped) return mapped[0];
      if (detectedLang === "iw") return "he";
      if (detectedLang === "zh-CN" || detectedLang === "zh-TW") return "zh";
    }
    return "en";
  } catch (error) {
    console.error("Language detection error:", error);
    return "en";
  }
}

export async function translateBlogPost(
  title: string,
  content: string,
  excerpt: string
): Promise<Record<string, { title: string; content: string; excerpt: string }>> {
  const translations: Record<string, { title: string; content: string; excerpt: string }> = {};

  const detectedLang = await detectLanguage(title + " " + content.substring(0, 200));
  console.log(`Detected blog post language: ${detectedLang}`);

  const allLangs = Object.keys(SUPPORTED_LANGS);

  for (const lang of allLangs) {
    if (lang === detectedLang) {
      translations[lang] = { title, content, excerpt };
      continue;
    }

    try {
      const [translatedTitle, translatedContent, translatedExcerpt] = await Promise.all([
        translateText(title, lang, detectedLang),
        translateText(content, lang, detectedLang),
        translateText(excerpt, lang, detectedLang),
      ]);

      translations[lang] = {
        title: translatedTitle,
        content: translatedContent,
        excerpt: translatedExcerpt,
      };
    } catch (error) {
      console.error(`Failed to translate to ${lang}:`, error);
      translations[lang] = { title, content, excerpt };
    }
  }

  return translations;
}
