import { create } from 'zustand';
import * as core from './namespaces/core';
import * as auth from './namespaces/auth';
import * as scheduleOps from './namespaces/scheduleOps';
import * as guestOps from './namespaces/guestOps';
import * as settingsBilling from './namespaces/settingsBilling';
import * as misc from './namespaces/misc';

export type LocaleCode = 'en' | 'es' | 'fr' | 'pseudo';

const en = {
  ...core.en,
  ...auth.en,
  ...scheduleOps.en,
  ...guestOps.en,
  ...settingsBilling.en,
  ...misc.en,
};

const es = {
  ...core.es,
  ...auth.es,
  ...scheduleOps.es,
  ...guestOps.es,
  ...settingsBilling.es,
  ...misc.es,
};

const fr = {
  ...core.fr,
  ...auth.fr,
  ...scheduleOps.fr,
  ...guestOps.fr,
  ...settingsBilling.fr,
  ...misc.fr,
};

type Dictionary = typeof en;

// Preserve {placeholder} tokens verbatim — otherwise interpolation silently
// stops matching once vowels inside the token get doubled too.
const expandPseudo = (value: string) =>
  `⟦${value.replace(/\{[^}]*\}|[aeiou]/gi, (match) => (match.startsWith('{') ? match : `${match}${match}`))}⟧`;

// A handful of dictionary values (help.sections.*.steps) hold a
// JSON.stringify'd array rather than display text, so the caller can
// JSON.parse it back. Wrapping the whole string in the pseudo brackets breaks
// that parse — detect the shape and pseudo-transform each array element
// instead, re-serializing to valid JSON.
const looksLikeJsonArray = (value: string) => {
  const trimmed = value.trim();
  return trimmed.startsWith('[') && trimmed.endsWith(']');
};

const makePseudo = <T,>(value: T): T => {
  if (typeof value === 'string') {
    if (looksLikeJsonArray(value)) {
      try {
        const parsed: unknown = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return JSON.stringify(parsed.map((item) => (typeof item === 'string' ? expandPseudo(item) : item))) as T;
        }
      } catch {
        // Not actually JSON — fall through to plain string handling.
      }
    }
    return expandPseudo(value) as T;
  }
  if (Array.isArray(value)) return value.map(makePseudo) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, makePseudo(nested)])) as T;
  }
  return value;
};

const dictionaries: Record<LocaleCode, Dictionary> = {
  en,
  es,
  fr,
  pseudo: makePseudo(en),
};

// Loosened from a literal key union (which would need hand-maintaining across
// every namespace file) to a `section.key` shaped template — namespace files
// are free to add keys without a matching edit here.
type TranslationKeyOf<T> = {
  [Key in keyof T & string]: T[Key] extends Record<string, unknown>
    ? `${Key}.${TranslationKeyOf<T[Key]>}`
    : Key;
}[keyof T & string];

export type TranslationKey = TranslationKeyOf<Dictionary>;

type I18nState = {
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
};

export const useLocaleStore = create<I18nState>((set) => ({
  locale: 'en',
  setLocale: (locale) => set({ locale }),
}));

const getValue = (dictionary: Dictionary, key: TranslationKey) =>
  key.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, dictionary);

export function useI18n() {
  const locale = useLocaleStore((state) => state.locale);
  const dictionary = dictionaries[locale] ?? dictionaries.en;

  const t = (key: TranslationKey, params?: Record<string, string | number>) => {
    const raw = getValue(dictionary, key) ?? getValue(dictionaries.en, key) ?? key;
    const template = String(raw);
    return Object.entries(params ?? {}).reduce(
      (value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)),
      template,
    );
  };

  const intlLocale = locale === 'pseudo' ? 'en' : locale;

  // Hermes (iOS/Android release) ships a reduced Intl. Currency/date formatting
  // with options can throw in production where it works in Expo Go. These
  // formatters run during render on the dashboard, so a throw here would crash
  // the whole app at startup — fall back to a plain string instead.
  const formatDate = (value: number | Date, options?: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat(intlLocale, options).format(value);
    } catch {
      // Non-Intl fallbacks (toTimeString/toDateString don't use Intl): a
      // time-only request gets a clock string, everything else a date string,
      // so e.g. formatDate(ts, { hour, minute }) doesn't degrade to a full date.
      const d = value instanceof Date ? value : new Date(value);
      const wantsTime = Boolean(options?.hour || options?.minute);
      const wantsDate = Boolean(options?.year || options?.month || options?.day);
      return wantsTime && !wantsDate ? d.toTimeString().slice(0, 5) : d.toDateString();
    }
  };

  const formatNumber = (value: number, options?: Intl.NumberFormatOptions) => {
    try {
      return new Intl.NumberFormat(intlLocale, options).format(value);
    } catch {
      return String(value);
    }
  };

  const formatCurrency = (value: number, currency = 'USD') => {
    try {
      return new Intl.NumberFormat(intlLocale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
    } catch {
      return `$${Math.round(value)}`;
    }
  };

  return {
    locale,
    t,
    formatDate,
    formatNumber,
    formatCurrency,
    direction: 'ltr' as const,
  };
}
