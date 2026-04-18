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

export const languages = {
  en: { name: 'English', dir: 'ltr', flagCode: 'gb' },
  ar: { name: 'العربية', dir: 'rtl', flagCode: 'ae' },
  he: { name: 'עברית', dir: 'rtl', flagCode: 'il' },
  ru: { name: 'Русский', dir: 'ltr', flagCode: 'ru' },
  ka: { name: 'ქართული', dir: 'ltr', flagCode: 'ge' },
  az: { name: 'Azərbaycan', dir: 'ltr', flagCode: 'az' },
  tr: { name: 'Türkçe', dir: 'ltr', flagCode: 'tr' },
  zh: { name: '中文', dir: 'ltr', flagCode: 'cn' },
  pl: { name: 'Polski', dir: 'ltr', flagCode: 'pl' },
  it: { name: 'Italiano', dir: 'ltr', flagCode: 'it' },
};

export const getFlagUrl = (code: string) => {
  const lang = languages[code as keyof typeof languages];
  if (!lang) return '';
  return `https://flagcdn.com/w40/${lang.flagCode}.png`;
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
      he: { common: heCommon },
      ru: { common: ruCommon },
      ka: { common: kaCommon },
      az: { common: azCommon },
      tr: { common: trCommon },
      zh: { common: zhCommon },
      pl: { common: plCommon },
      it: { common: itCommon },
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
