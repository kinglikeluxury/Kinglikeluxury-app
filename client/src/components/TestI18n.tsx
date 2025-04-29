import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../lib/i18n';

export function TestI18n() {
  const { t } = useTranslation();
  const [lang, setLang] = useState(i18n.language);
  
  useEffect(() => {
    const interval = setInterval(() => {
      console.log('Current language:', i18n.language);
      console.log('Available namespaces:', i18n.options.ns);
      console.log('Default namespace:', i18n.options.defaultNS);
      console.log('Available languages:', i18n.options.supportedLngs);
      console.log('t function test:', t('common.loading', 'Loading...'));
      setLang(i18n.language);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [t]);
  
  return (
    <div className="fixed bottom-0 left-0 bg-black/80 text-white p-4 text-xs z-50">
      <div>Debug - Current Language: {lang}</div>
      <div>Translation test:</div>
      <div>nav.home = {t('nav.home', 'Home')}</div>
      <div>auth.login = {t('auth.login', 'Login')}</div>
      <div>propertyTypes.apartment = {t('propertyTypes.apartment', 'Apartment')}</div>
    </div>
  );
}