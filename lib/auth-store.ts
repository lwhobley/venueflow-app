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

const memoryStorage = {
  getItem: async (key: string) => {
    return memoryStorage.values.get(key) ?? null;
  },
  setItem: async (key: string, value: string) => {
    memoryStorage.values.set(key, value);
  },
  removeItem: async (key: string) => {
    memoryStorage.values.delete(key);
  },
  values: new Map<string, string>(),
};

// Web sessions stay in memory until an HttpOnly cookie-based session is available.
// This prevents a script injection from reading a long-lived bearer token.
const storage = Platform.OS === 'web' ? memoryStorage : secureStorage;

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
