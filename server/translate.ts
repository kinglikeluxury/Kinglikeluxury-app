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
};

export async function translateText(text: string, targetLang: string): Promise<string> {
  const googleLang = SUPPORTED_LANGS[targetLang];
  if (!googleLang || targetLang === "en") return text;

  try {
    const result = await translate(text, { to: googleLang, from: "en" });
    return result.text;
  } catch (error) {
    console.error(`Translation error for lang ${targetLang}:`, error);
    return text;
  }
}

export async function translateBlogPost(
  title: string,
  content: string,
  excerpt: string
): Promise<Record<string, { title: string; content: string; excerpt: string }>> {
  const translations: Record<string, { title: string; content: string; excerpt: string }> = {};
  const langs = Object.keys(SUPPORTED_LANGS).filter(l => l !== "en");

  for (const lang of langs) {
    try {
      const [translatedTitle, translatedContent, translatedExcerpt] = await Promise.all([
        translateText(title, lang),
        translateText(content, lang),
        translateText(excerpt, lang),
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
