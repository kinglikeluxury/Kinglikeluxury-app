import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import en from './locales/en';
import he from './locales/he';
import ar from './locales/ar';
import ru from './locales/ru';
import ka from './locales/ka';
import az from './locales/az';
import tr from './locales/tr';
import zh from './locales/zh';
import pl from './locales/pl';

export const languages = {
  en: { name: 'English', dir: 'ltr', flag: '🇺🇸' },
  he: { name: 'עברית', dir: 'rtl', flag: '🇮🇱' },
  ar: { name: 'العربية', dir: 'rtl', flag: '🇦🇪' },
  ru: { name: 'Русский', dir: 'ltr', flag: '🇷🇺' },
  ka: { name: 'ქართული', dir: 'ltr', flag: '🇬🇪' },
  az: { name: 'Azərbaycan', dir: 'ltr', flag: '🇦🇿' },
  tr: { name: 'Türkçe', dir: 'ltr', flag: '🇹🇷' },
  zh: { name: '中文', dir: 'ltr', flag: '🇨🇳' },
  pl: { name: 'Polski', dir: 'ltr', flag: '🇵🇱' },
};

export type LanguageCode = keyof typeof languages;

const resources = {
  en: { translation: en },
  he: { translation: he },
  ar: { translation: ar },
  ru: { translation: ru },
  ka: { translation: ka },
  az: { translation: az },
  tr: { translation: tr },
  zh: { translation: zh },
  pl: { translation: pl },
};

const LANGUAGE_KEY = '@kinglike_language';

export const getStoredLanguage = async (): Promise<LanguageCode | null> => {
  try {
    const lang = await AsyncStorage.getItem(LANGUAGE_KEY);
    return lang as LanguageCode | null;
  } catch {
    return null;
  }
};

export const setStoredLanguage = async (lang: LanguageCode): Promise<void> => {
  try {
    await AsyncStorage.setItem(LANGUAGE_KEY, lang);
  } catch (error) {
    console.error('Error storing language:', error);
  }
};

export const isRTL = (lang: LanguageCode): boolean => {
  return languages[lang]?.dir === 'rtl';
};

export const getLanguageDirection = (lang: LanguageCode): 'ltr' | 'rtl' => {
  return languages[lang]?.dir === 'rtl' ? 'rtl' : 'ltr';
};

export const applyRTL = (lang: LanguageCode): void => {
  const shouldBeRTL = isRTL(lang);
  if (I18nManager.isRTL !== shouldBeRTL) {
    I18nManager.allowRTL(shouldBeRTL);
    I18nManager.forceRTL(shouldBeRTL);
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

export default i18n;
