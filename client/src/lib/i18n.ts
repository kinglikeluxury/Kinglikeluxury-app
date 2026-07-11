import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enCommon from '../locales/en/common.json';
import arCommon from '../locales/ar/common.json';
import heCommon from '../locales/he/common.json';
import ruCommon from '../locales/ru/common.json';
import kaCommon from '../locales/ka/common.json';
import azCommon from '../locales/az/common.json';
import trCommon from '../locales/tr/common.json';
import zhCommon from '../locales/zh/common.json';
import plCommon from '../locales/pl/common.json';
import itCommon from '../locales/it/common.json';
import faCommon from '../locales/fa/common.json';
import nlCommon from '../locales/nl/common.json';
import deCommon from '../locales/de/common.json';
import svCommon from '../locales/sv/common.json';
import frCommon from '../locales/fr/common.json';

export const languages = {
  en: { name: 'English', dir: 'ltr', flagCode: 'gb' },
  ar: { name: 'العربية', dir: 'rtl', flagCode: 'ae' },
  fa: { name: 'فارسی', dir: 'rtl', flagCode: 'ir' },
  he: { name: 'עברית', dir: 'rtl', flagCode: 'il' },
  ru: { name: 'Русский', dir: 'ltr', flagCode: 'ru' },
  ka: { name: 'ქართული', dir: 'ltr', flagCode: 'ge' },
  az: { name: 'Azərbaycan', dir: 'ltr', flagCode: 'az' },
  tr: { name: 'Türkçe', dir: 'ltr', flagCode: 'tr' },
  zh: { name: '中文', dir: 'ltr', flagCode: 'cn' },
  pl: { name: 'Polski', dir: 'ltr', flagCode: 'pl' },
  it: { name: 'Italiano', dir: 'ltr', flagCode: 'it' },
  nl: { name: 'Nederlands', dir: 'ltr', flagCode: 'nl' },
  de: { name: 'Deutsch', dir: 'ltr', flagCode: 'de' },
  sv: { name: 'Svenska', dir: 'ltr', flagCode: 'se' },
  fr: { name: 'Français', dir: 'ltr', flagCode: 'fr' },
};

export const getFlagUrl = (code: string): string => {
  // Normalize: lowercase + replace underscores with hyphens (handles en-US, pt_BR, zh-CN, etc.)
  const normalized = (code || '').toLowerCase().replace(/_/g, '-');
  const base = normalized.split('-')[0];
  const lang = languages[normalized as keyof typeof languages]
    || languages[base as keyof typeof languages];
  if (!lang) return '';
  return `https://flagcdn.com/w40/${lang.flagCode}.png`;
};

// Resolve a full locale code (e.g. 'en-US', 'pt_BR') to the display name
export const getLanguageName = (code: string): string => {
  const normalized = (code || '').toLowerCase().replace(/_/g, '-');
  const base = normalized.split('-')[0];
  return (
    languages[normalized as keyof typeof languages]?.name ||
    languages[base as keyof typeof languages]?.name ||
    'English'
  );
};

export const getLanguageDirection = (lng: string): string => {
  return languages[lng as keyof typeof languages]?.dir || 'ltr';
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    debug: false,
    interpolation: {
      escapeValue: false,
    },
    supportedLngs: Object.keys(languages),
    ns: ['common'],
    defaultNS: 'common',
    resources: {
      en: { common: enCommon },
      ar: { common: arCommon },
      fa: { common: faCommon },
      he: { common: heCommon },
      ru: { common: ruCommon },
      ka: { common: kaCommon },
      az: { common: azCommon },
      tr: { common: trCommon },
      zh: { common: zhCommon },
      pl: { common: plCommon },
      it: { common: itCommon },
      nl: { common: nlCommon },
      de: { common: deCommon },
      sv: { common: svCommon },
      fr: { common: frCommon },
    },
    detection: {
      order: ['querystring', 'cookie', 'localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage', 'cookie'],
    },
    react: {
      useSuspense: false,
    },
  });

export default i18n;
