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
  venues: [],
  token: null,
  setHydrated: (hydrated: boolean) => set({ hydrated }),
  setSession: (session: { user: UserSummary; venue: Venue | null; venues?: VenueSummary[]; token?: string | null }) =>
    set((state: AuthState) => ({
      user: session.user,
      venue: session.venue,
      venues: session.venues ?? state.venues,
      ...(session.token !== undefined ? { token: session.token } : {}),
      authEpoch: state.authEpoch + 1,
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
