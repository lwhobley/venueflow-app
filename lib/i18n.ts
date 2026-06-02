import { create } from 'zustand';

export type LocaleCode = 'en' | 'es' | 'fr' | 'pseudo';

const en = {
  nav: {
    home: 'Home',
    clock: 'Clock IN/OUT',
    schedule: 'Schedule',
    availability: 'Availability',
    floor: 'Floor',
    reservations: 'Reservations',
    guests: 'Guests',
    integrations: 'Integrations',
    sales: 'Sales',
    chat: 'Chat',
    inventory: 'Inventory',
    reports: 'Reports',
    staff: 'Staff',
    profileFallback: 'Profile',
  },
  common: {
    venueWrangler: 'Venue Wrangler',
    loungeability: 'by Loungeability LLC',
    loading: 'Loading...',
    unread: 'unread',
    markRead: 'Mark read',
    today: 'today',
    scheduled: 'Scheduled',
    needsCoverage: 'Needs coverage',
  },
  command: {
    searchPlaceholder: 'Search reservations, guests, shifts',
    property: 'Property',
    ai: 'AI Copilot',
    alerts: 'Alerts',
    language: 'Language',
    themeDark: 'Dark',
    themeLight: 'Light',
    date: 'Service date',
  },
  dashboard: {
    title: 'Operations Command',
    greeting: 'Good to see you, {name}.',
    roleVenue: '{role} · {venue}',
    coverageAlert: 'Coverage alert',
    openShiftNotice: '{count} open shifts need coverage this week.',
    managerCenter: 'Executive control layer',
    recentReservations: '{count} recent reservations',
    managerGoal: 'Manager goal for today',
    addGoal: 'Add goal',
    analytics: 'Tonight intelligence',
    notifications: 'Activity feed',
    noNotifications: 'No operational updates yet.',
    weekGlance: 'This week at a glance',
    noShifts: 'No shifts scheduled yet. Add shifts from the Schedule tab.',
    clockedIn: "Staff readiness",
    noClockedIn: 'No one is clocked in right now.',
    vipLarge: 'VIP and large reservations',
    covers: 'Tonight covers',
    revenue: 'Revenue pace',
    occupancy: 'Occupancy',
    turns: 'Table turns',
    guestSpend: 'Guest spend',
    staffReady: 'Staff ready',
    reservationsTimeline: 'Live reservations timeline',
    floorControl: 'Floor status control',
    eventRun: 'Event run-of-show',
    vipInsights: 'VIP readiness',
    bottlenecks: 'Service bottlenecks',
    staffing: 'Shift overview',
    barKitchen: 'Bar / kitchen coordination',
    onPace: 'On pace',
    watch: 'Watch',
    clear: 'Clear',
    arrivals: 'Arrivals',
    seatingFlow: 'Seating flow',
    kitchenFire: 'Kitchen fire',
    barQueue: 'Bar queue',
    fullFloor: 'Full floor',
    tableTurns: 'Table turns',
    coversLabel: 'covers',
    pacingLabel: 'pacing',
    vipLabel: 'VIP',
    largeLabel: 'large',
    eventsLabel: 'events',
  },
  roles: {
    owner: 'Owner',
    admin: 'Admin',
    manager: 'Manager',
    staff: 'Staff',
  },
};

type Dictionary = typeof en;

const es: Dictionary = {
  ...en,
  nav: {
    ...en.nav,
    home: 'Inicio',
    schedule: 'Horario',
    reservations: 'Reservas',
    inventory: 'Inventario',
    reports: 'Informes',
    staff: 'Equipo',
  },
  command: {
    ...en.command,
    searchPlaceholder: 'Buscar reservas, huéspedes, turnos',
    language: 'Idioma',
    themeDark: 'Oscuro',
    themeLight: 'Claro',
  },
  dashboard: {
    ...en.dashboard,
    title: 'Comando operativo',
    analytics: 'Inteligencia de esta noche',
    notifications: 'Actividad operativa',
  },
};

const fr: Dictionary = {
  ...en,
  nav: {
    ...en.nav,
    home: 'Accueil',
    schedule: 'Planning',
    reservations: 'Réservations',
    inventory: 'Inventaire',
    reports: 'Rapports',
    staff: 'Équipe',
  },
  command: {
    ...en.command,
    searchPlaceholder: 'Rechercher réservations, invités, services',
    language: 'Langue',
    themeDark: 'Sombre',
    themeLight: 'Clair',
  },
  dashboard: {
    ...en.dashboard,
    title: 'Centre opérationnel',
    analytics: 'Intelligence du soir',
    notifications: 'Flux opérationnel',
  },
};

const expandPseudo = (value: string) => `⟦${value.replace(/[aeiou]/gi, (match) => `${match}${match}`)}⟧`;

const makePseudo = <T,>(value: T): T => {
  if (typeof value === 'string') return expandPseudo(value) as T;
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

type TranslationKey =
  | `nav.${keyof Dictionary['nav']}`
  | `common.${keyof Dictionary['common']}`
  | `command.${keyof Dictionary['command']}`
  | `dashboard.${keyof Dictionary['dashboard']}`
  | `roles.${keyof Dictionary['roles']}`;

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

  const formatDate = (value: number | Date, options?: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale === 'pseudo' ? 'en' : locale, options).format(value);

  const formatNumber = (value: number, options?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat(locale === 'pseudo' ? 'en' : locale, options).format(value);

  const formatCurrency = (value: number, currency = 'USD') =>
    formatNumber(value, { style: 'currency', currency, maximumFractionDigits: 0 });

  return {
    locale,
    t,
    formatDate,
    formatNumber,
    formatCurrency,
    direction: 'ltr' as const,
  };
}
