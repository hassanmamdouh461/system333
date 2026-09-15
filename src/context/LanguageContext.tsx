import { createContext, useContext, useEffect } from 'react';
import { translations } from '../i18n/translations';

interface LanguageContextProps {
  /** Looks up the Arabic string for a source phrase. */
  t: (key: string) => string;
  language: 'ar';
  isRtl: boolean;
}

const LanguageContext = createContext<LanguageContextProps | null>(null);

/**
 * The interface is Arabic-only, so this provider no longer switches languages: it fixes the
 * document direction once and exposes the lookup the components already call.
 */
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
    document.body.classList.add('rtl');
  }, []);

  // A missing key falls through as its own source phrase, which is readable rather than
  // blank while a string is still untranslated.
  const t = (key: string): string => translations[key] ?? key;

  return (
    <LanguageContext.Provider value={{ t, language: 'ar', isRtl: true }}>
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
