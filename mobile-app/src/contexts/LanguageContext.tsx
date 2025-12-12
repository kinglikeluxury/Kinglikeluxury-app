import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { I18nManager } from 'react-native';
import i18n, { 
  languages, 
  LanguageCode, 
  getStoredLanguage, 
  setStoredLanguage, 
  isRTL,
  applyRTL 
} from '@lib/i18n';

type LanguageContextType = {
  currentLanguage: LanguageCode;
  changeLanguage: (lang: LanguageCode) => Promise<void>;
  isRTL: boolean;
  languages: typeof languages;
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [currentLanguage, setCurrentLanguage] = useState<LanguageCode>('en');
  const [isRTLLayout, setIsRTLLayout] = useState(false);

  useEffect(() => {
    const initLanguage = async () => {
      const storedLang = await getStoredLanguage();
      if (storedLang && languages[storedLang]) {
        await changeLanguage(storedLang);
      }
    };
    initLanguage();
  }, []);

  const changeLanguage = async (lang: LanguageCode) => {
    try {
      await i18n.changeLanguage(lang);
      setCurrentLanguage(lang);
      await setStoredLanguage(lang);
      
      const rtl = isRTL(lang);
      setIsRTLLayout(rtl);
      applyRTL(lang);
    } catch (error) {
      console.error('Error changing language:', error);
    }
  };

  return (
    <LanguageContext.Provider
      value={{
        currentLanguage,
        changeLanguage,
        isRTL: isRTLLayout,
        languages,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
