import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

const translationCache = new Map<string, string>();
const MAX_CACHE_SIZE = 500;

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

function getCacheKey(text: string, lang: string): string {
  return `${simpleHash(text)}_${text.length}_${lang}`;
}

function evictCache() {
  if (translationCache.size > MAX_CACHE_SIZE) {
    const keysToDelete = Array.from(translationCache.keys()).slice(0, 100);
    keysToDelete.forEach(k => translationCache.delete(k));
  }
}

async function translateTexts(texts: string[], targetLang: string): Promise<string[]> {
  const toTranslate: { index: number; text: string }[] = [];
  const results: string[] = new Array(texts.length);

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (!text || text.trim().length === 0) {
      results[i] = text || '';
      continue;
    }
    const cacheKey = getCacheKey(text, targetLang);
    const cached = translationCache.get(cacheKey);
    if (cached) {
      results[i] = cached;
    } else {
      toTranslate.push({ index: i, text });
    }
  }

  if (toTranslate.length === 0) return results;

  try {
    const response = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        texts: toTranslate.map(t => t.text),
        targetLang,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      evictCache();
      for (let i = 0; i < toTranslate.length; i++) {
        const translated = data.translations[i] || toTranslate[i].text;
        const cacheKey = getCacheKey(toTranslate[i].text, targetLang);
        translationCache.set(cacheKey, translated);
        results[toTranslate[i].index] = translated;
      }
    } else {
      for (const item of toTranslate) {
        results[item.index] = item.text;
      }
    }
  } catch {
    for (const item of toTranslate) {
      results[item.index] = item.text;
    }
  }

  return results;
}

export function useAutoTranslate(texts: Record<string, string | undefined | null>): Record<string, string> {
  const { i18n } = useTranslation();
  const currentLang = i18n.language?.split('-')[0] || 'en';
  const [translated, setTranslated] = useState<Record<string, string>>({});

  const keys = Object.keys(texts);
  const values = keys.map(k => texts[k] || '');
  const valuesKey = values.join('||');

  useEffect(() => {
    let cancelled = false;

    const doTranslate = async () => {
      const textsToTranslate = keys.map(k => texts[k] || '');
      const hasContent = textsToTranslate.some(t => t && t.trim().length > 0);

      if (!hasContent) {
        const result: Record<string, string> = {};
        keys.forEach((k) => { result[k] = texts[k] || ''; });
        if (!cancelled) setTranslated(result);
        return;
      }

      const results = await translateTexts(textsToTranslate, currentLang);
      if (!cancelled) {
        const result: Record<string, string> = {};
        keys.forEach((k, i) => { result[k] = results[i] || texts[k] || ''; });
        setTranslated(result);
      }
    };

    doTranslate();
    return () => { cancelled = true; };
  }, [valuesKey, currentLang]);

  if (Object.keys(translated).length === 0) {
    const result: Record<string, string> = {};
    keys.forEach(k => { result[k] = texts[k] || ''; });
    return result;
  }

  return translated;
}

export function useAutoTranslateText(text: string | undefined | null): string {
  const result = useAutoTranslate({ text: text });
  return result.text || text || '';
}

export function useAutoTranslateArray(items: string[]): string[] {
  const { i18n } = useTranslation();
  const currentLang = i18n.language?.split('-')[0] || 'en';
  const [translated, setTranslated] = useState<string[]>(items);
  const itemsKey = items.join('||');

  useEffect(() => {
    let cancelled = false;

    const doTranslate = async () => {
      const hasContent = items.some(t => t && t.trim().length > 0);
      if (!hasContent) {
        if (!cancelled) setTranslated(items);
        return;
      }

      const results = await translateTexts(items, currentLang);
      if (!cancelled) setTranslated(results);
    };

    doTranslate();
    return () => { cancelled = true; };
  }, [itemsKey, currentLang]);

  return translated;
}
