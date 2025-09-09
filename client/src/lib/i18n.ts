import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import Backend from 'i18next-http-backend';

// Define the language configuration
export const languages = {
  en: { name: 'English', dir: 'ltr', flag: 'En' },
  ar: { name: 'العربية', dir: 'rtl', flag: '🇦🇪' },
  he: { name: 'עברית', dir: 'rtl', flag: '🇮🇱' },
  ru: { name: 'Русский', dir: 'ltr', flag: '🇷🇺' },
  ka: { name: 'ქართული', dir: 'ltr', flag: 'En' }, // Georgian
  az: { name: 'Azərbaycan', dir: 'ltr', flag: '🇦🇿' }, // Azerbaijani
  tr: { name: 'Türkçe', dir: 'ltr', flag: '🇹🇷' }, // Turkish
  zh: { name: '中文', dir: 'ltr', flag: '🇨🇳' }, // Chinese
  pl: { name: 'Polski', dir: 'ltr', flag: '🇵🇱' }, // Polish
};

// Helper function to get the text direction of a language
export const getLanguageDirection = (lng: string): string => {
  return languages[lng as keyof typeof languages]?.dir || 'ltr';
};

i18n
  // load translation using http (default public/locales/{{lng}}/{{ns}}.json)
  .use(Backend)
  // detect user language
  .use(LanguageDetector)
  // pass the i18n instance to react-i18next
  .use(initReactI18next)
  // init i18next
  .init({
    fallbackLng: 'en',
    debug: true,
    interpolation: {
      escapeValue: false, // not needed for react as it escapes by default
    },
    supportedLngs: Object.keys(languages),
    ns: ['common'],
    defaultNS: 'common',
    fallbackNS: 'common',
    detection: {
      order: ['querystring', 'cookie', 'localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage', 'cookie'],
    },
    backend: {
      loadPath: './locales/{{lng}}/{{ns}}.json',
      requestOptions: {
        cache: 'no-cache',
      },
    },
    react: {
      useSuspense: false, // react-i18next suspense not currently needed 
    },
  });

export default i18n;