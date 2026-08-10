import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { UserSummary, Venue, VenueSummary } from './types';

type SessionState = {
  user: UserSummary | null;
  venue: Venue | null;
  venues: VenueSummary[];
  token: string | null;
};

export type AuthState = SessionState & {
  authEpoch: number;
  hydrated: boolean;
  setHydrated: (hydrated: boolean) => void;
  setSession: (session: {
    user: UserSummary;
    venue: Venue | null;
    venues?: VenueSummary[];
    token?: string | null;
  }) => void;
  setVenue: (venue: Venue) => void;
  setVenues: (venues: VenueSummary[]) => void;
  switchVenue: (venue: Venue) => void;
  clearSession: () => void;
};

const secureStorage = {
  getItem: async (key: string) => SecureStore.getItemAsync(key),
  setItem: async (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: async (key: string) => SecureStore.deleteItemAsync(key),
};

// On web the session must survive a page reload (a desktop user expects to
// stay signed in across refreshes), so persist to localStorage. Fall back to an
// in-memory Map when localStorage is unavailable (SSR, private-mode throws).
const memoryStorage = new Map<string, string>();
const hasLocalStorage = (() => {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
})();
const webStorage = {
  getItem: async (key: string) => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        // Fall back to memoryStorage if localStorage is restricted
      }
    }
    return memoryStorage.get(key) ?? null;
  },
  setItem: async (key: string, value: string) => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(key, value);
        return;
      } catch {
        // Fall back to memoryStorage if localStorage is restricted
      }
    }
    memoryStorage.set(key, value);
  },
  removeItem: async (key: string) => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(key);
        return;
      } catch {
        // Fall back to memoryStorage if localStorage is restricted
      }
    }
    memoryStorage.delete(key);
  },
};

const storage = Platform.OS === 'web' ? webStorage : secureStorage;

// Zustand's set: accepts either a partial object or an updater function (this
// store uses both). Typed explicitly so the returned shapes stay checked.
type SetAuthState = (
  partial:
    | AuthState
    | Partial<AuthState>
    | ((state: AuthState) => AuthState | Partial<AuthState>),
  replace?: false,
) => void;

const createAuthStore = (set: SetAuthState): AuthState => ({
  authEpoch: 0,
  hydrated: false,
  user: null,
  venue: null,
  venues: [],
  token: null,
  setHydrated: (hydrated: boolean) => set({ hydrated }),
  setSession: (session: { user: UserSummary; venue: Venue | null; venues?: VenueSummary[]; token?: string | null }) =>
    set((state: AuthState) => ({
      user: session.user,
      venue: session.venue,
      venues: session.venues ?? state.venues,
      ...(session.token !== undefined ? { token: session.token } : {}),
      authEpoch: session.token !== undefined ? state.authEpoch + 1 : state.authEpoch,
    })),
  setVenue: (venue: Venue) => set({ venue }),
  setVenues: (venues: VenueSummary[]) => set({ venues }),
  switchVenue: (venue: Venue) =>
    set((state: AuthState) => ({
      venue,
      authEpoch: state.authEpoch + 1,
    })),
  clearSession: () =>
    set((state: AuthState) => ({
      user: null,
      venue: null,
      venues: [],
      token: null,
      authEpoch: state.authEpoch + 1,
    })),
});

export const useAuthStore = create<AuthState>()(
  persist(createAuthStore, {
    name: 'venuewrangler-auth',
    storage: createJSONStorage(() => storage),
    partialize: (state: AuthState): SessionState => ({
      user: state.user,
      venue: state.venue,
      venues: state.venues,
      token: state.token,
    }),
    onRehydrateStorage: () => (state: AuthState | undefined) => {
      state?.setHydrated(true);
    },
  }),
);
