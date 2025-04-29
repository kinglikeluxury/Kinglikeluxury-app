import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import Backend from 'i18next-http-backend';

// Languages supported by the application
export const languages = {
  en: { nativeName: 'English', direction: 'ltr' },
  ar: { nativeName: 'العربية', direction: 'rtl' },
  he: { nativeName: 'עברית', direction: 'rtl' },
  ru: { nativeName: 'Русский', direction: 'ltr' },
  ka: { nativeName: 'ქართული', direction: 'ltr' },
  az: { nativeName: 'Azərbaycan', direction: 'ltr' },
  tr: { nativeName: 'Türkçe', direction: 'ltr' },
  zh: { nativeName: '中文', direction: 'ltr' },
  pl: { nativeName: 'Polski', direction: 'ltr' }
};

// Get the language direction (ltr or rtl)
export const getLanguageDirection = (lng: string): string => {
  return languages[lng as keyof typeof languages]?.direction || 'ltr';
};

i18n
  // Load translation using http, learn more: https://github.com/i18next/i18next-http-backend
  .use(Backend)
  // Detect user language, learn more: https://github.com/i18next/i18next-browser-languageDetector
  .use(LanguageDetector)
  // Pass the i18n instance to react-i18next
  .use(initReactI18next)
  // Initialize i18next
  .init({
    supportedLngs: Object.keys(languages),
    fallbackLng: 'en',
    debug: process.env.NODE_ENV === 'development',
    
    interpolation: {
      escapeValue: false, // Not needed for React as it escapes by default
    },
    
    // Backend options
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
    
    // Default namespace
    defaultNS: 'common',
    
    // React settings
    react: {
      useSuspense: true,
    },
  });

export default i18n;