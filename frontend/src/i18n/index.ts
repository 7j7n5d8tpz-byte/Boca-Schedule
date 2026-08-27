import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import da from './da.json';
import en from './en.json';

export const LANGUAGES = ['da', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

/** The club is Danish, so Danish is the default and the fallback. */
export const DEFAULT_LANGUAGE: Language = 'da';

const STORAGE_KEY = 'language';

function isLanguage(v: unknown): v is Language {
  return LANGUAGES.includes(v as Language);
}

/**
 * The language to render before we know who the user is.
 *
 * The account's choice lives in `users.language`, but the login and register
 * screens paint before any of that is fetched — so every login mirrors the
 * choice into localStorage and the pre-auth screens read it back from here.
 */
export function storedLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isLanguage(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/** Switch language and remember it for the next pre-auth render. */
export function setLanguage(lang: Language): void {
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* private mode */ }
  void i18n.changeLanguage(lang);
}

i18n.use(initReactI18next).init({
  resources: {
    da: { translation: da },
    en: { translation: en },
  },
  lng: storedLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  // React escapes interpolated values already.
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
