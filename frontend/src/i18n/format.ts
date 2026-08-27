import { useTranslation } from 'react-i18next';
import { DEFAULT_LANGUAGE, type Language } from './index';

// Dates were formatted with a hardcoded 'en-GB' in ~50 places. These named
// styles cover every shape that was in use, so a component asks for the shape
// it wants and the locale follows the reader's language.
const STYLES = {
  dayMonth:            { day: 'numeric', month: 'short' },
  dayMonthYear:        { day: 'numeric', month: 'short', year: 'numeric' },
  dayMonthTime:        { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' },
  monthYearShort:      { month: 'short', year: '2-digit' },
  weekdayDayMonth:     { weekday: 'short', day: 'numeric', month: 'short' },
  weekdayDayMonthYear: { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
  long:                { weekday: 'long', day: 'numeric', month: 'long' },
  longYear:            { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

export type DateStyle = keyof typeof STYLES;

const LOCALES: Record<Language, string> = { da: 'da-DK', en: 'en-GB' };

export function localeOf(lang: string): string {
  return LOCALES[lang as Language] ?? LOCALES[DEFAULT_LANGUAGE];
}

/**
 * Format a date in the reader's locale.
 *
 * Accepts what the call sites already hold: a Date, an ISO timestamp, or a
 * bare `YYYY-MM-DD` match date. The bare form is parsed as local midnight
 * rather than UTC, so a match never renders as the day before.
 */
export function formatDate(value: Date | string, style: DateStyle, lang: string): string {
  const date = toDate(value);
  if (!date) return '';
  const opts = STYLES[style];
  const useTime = 'hour' in opts;
  return useTime
    ? date.toLocaleString(localeOf(lang), opts)
    : date.toLocaleDateString(localeOf(lang), opts);
}

function toDate(value: Date | string): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  // `YYYY-MM-DD` alone is UTC per the spec; pin it to local midnight instead.
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = bare
    ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3]))
    : new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

/** Formatters bound to the reader's current language. */
export function useDateFormat() {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  return {
    lang,
    locale: localeOf(lang),
    formatDate: (value: Date | string, style: DateStyle) => formatDate(value, style, lang),
  };
}
