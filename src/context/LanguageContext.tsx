import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Language, translations } from '../i18n/translations';

const LS_LANGUAGE_KEY = 'engaz_language';

interface LanguageContextProps {
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  t: (key: string) => string;
  isRtl: boolean;
}

const LanguageContext = createContext<LanguageContextProps | null>(null);

function readStoredLanguage(): Language {
  const saved = localStorage.getItem(LS_LANGUAGE_KEY);
  return saved === 'en' ? 'en' : 'ar';
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(readStoredLanguage);

  // The same key the Electron settings whitelist accepts, so a language choice survives a
  // reinstall of the renderer's storage.
  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    localStorage.setItem(LS_LANGUAGE_KEY, next);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === 'ar' ? 'en' : 'ar');
  }, [language, setLanguage]);

  const t = useCallback((key: string): string => {
    const translation = translations[key];
    // An untranslated key falls through as its own English text, which is readable rather
    // than blank while a translation is still missing.
    return translation ? translation[language] : key;
  }, [language]);

  const isRtl = language === 'ar';

  useEffect(() => {
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
    document.body.classList.toggle('rtl', isRtl);
  }, [language, isRtl]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, toggleLanguage, t, isRtl }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
