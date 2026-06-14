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

const memoryStorage = new Map<string, string>();
const webStorage = {
  getItem: async (key: string) => memoryStorage.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    memoryStorage.set(key, value);
  },
  removeItem: async (key: string) => {
    memoryStorage.delete(key);
  },
};

const storage = Platform.OS === 'web' ? webStorage : secureStorage;

const createAuthStore = (set: (partial: Partial<AuthState>) => void): AuthState => ({
  hydrated: false,
  user: null,
  venue: null,
  token: null,
  setHydrated: (hydrated: boolean) => set({ hydrated }),
  setSession: (session: { user: UserSummary; venue: Venue | null; token?: string | null }) =>
    set({
      user: session.user,
      venue: session.venue,
      ...(session.token !== undefined ? { token: session.token } : {}),
    }),
  setVenue: (venue: Venue) => set({ venue }),
  clearSession: () => set({ user: null, venue: null, token: null }),
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
