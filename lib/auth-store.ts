import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { UserSummary, Venue } from './types';

type SessionState = {
  user: UserSummary | null;
  venue: Venue | null;
};

export type AuthState = SessionState & {
  hydrated: boolean;
  setHydrated: (hydrated: boolean) => void;
  setSession: (session: {
    user: UserSummary;
    venue: Venue | null;
  }) => void;
  clearSession: () => void;
};

const secureStorage = {
  getItem: async (key: string) => SecureStore.getItemAsync(key),
  setItem: async (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: async (key: string) => SecureStore.deleteItemAsync(key),
};

const memoryStorage = new Map<string, string>();
const browserWindow = globalThis as typeof globalThis & {
  localStorage?: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
  };
};
const webStorage = {
  getItem: async (key: string) => {
    try {
      return browserWindow.localStorage?.getItem(key) ?? memoryStorage.get(key) ?? null;
    } catch {
      return memoryStorage.get(key) ?? null;
    }
  },
  setItem: async (key: string, value: string) => {
    try {
      browserWindow.localStorage?.setItem(key, value);
      if (browserWindow.localStorage) {
        return;
      }
    } catch {
      // ignore and fall back to in-memory storage
    }
    memoryStorage.set(key, value);
  },
  removeItem: async (key: string) => {
    try {
      browserWindow.localStorage?.removeItem(key);
      if (browserWindow.localStorage) {
        return;
      }
    } catch {
      // ignore and fall back to in-memory storage
    }
    memoryStorage.delete(key);
  },
};

const storage = Platform.OS === 'web' ? webStorage : secureStorage;

const createAuthStore = (set: (partial: Partial<AuthState>) => void): AuthState => ({
  hydrated: false,
  user: null,
  venue: null,
  setHydrated: (hydrated: boolean) => set({ hydrated }),
  setSession: (session: { user: UserSummary; venue: Venue | null }) =>
    set({
      user: session.user,
      venue: session.venue,
    }),
  clearSession: () => set({ user: null, venue: null }),
});

export const useAuthStore = create<AuthState>()(
  persist(createAuthStore, {
    name: 'venueflow-auth',
    storage: createJSONStorage(() => storage),
    partialize: (state: AuthState): SessionState => ({
      user: state.user,
      venue: state.venue,
    }),
    onRehydrateStorage: () => (state: AuthState | undefined) => {
      state?.setHydrated(true);
    },
  }),
);