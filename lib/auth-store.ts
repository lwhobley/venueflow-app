import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { UserSummary, Venue } from './types';

type SessionState = {
  user: UserSummary | null;
  venue: Venue | null;
  token: string | null;
};

export type AuthState = SessionState & {
  authEpoch: number;
  hydrated: boolean;
  setHydrated: (hydrated: boolean) => void;
  setSession: (session: {
    user: UserSummary;
    venue: Venue | null;
    token?: string | null;
  }) => void;
  setVenue: (venue: Venue) => void;
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
    if (hasLocalStorage) return window.localStorage.getItem(key);
    return memoryStorage.get(key) ?? null;
  },
  setItem: async (key: string, value: string) => {
    if (hasLocalStorage) window.localStorage.setItem(key, value);
    else memoryStorage.set(key, value);
  },
  removeItem: async (key: string) => {
    if (hasLocalStorage) window.localStorage.removeItem(key);
    else memoryStorage.delete(key);
  },
};

const storage = Platform.OS === 'web' ? webStorage : secureStorage;

const createAuthStore = (set: any): AuthState => ({
  authEpoch: 0,
  hydrated: false,
  user: null,
  venue: null,
  token: null,
  setHydrated: (hydrated: boolean) => set({ hydrated }),
  setSession: (session: { user: UserSummary; venue: Venue | null; token?: string | null }) =>
    set((state: AuthState) => ({
      user: session.user,
      venue: session.venue,
      ...(session.token !== undefined ? { token: session.token } : {}),
      authEpoch: session.token !== undefined ? state.authEpoch + 1 : state.authEpoch,
    })),
  setVenue: (venue: Venue) => set({ venue }),
  clearSession: () =>
    set((state: AuthState) => ({
      user: null,
      venue: null,
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
      token: state.token,
    }),
    onRehydrateStorage: () => (state: AuthState | undefined) => {
      state?.setHydrated(true);
    },
  }),
);
