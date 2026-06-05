import { useAuthToken } from '@convex-dev/auth/react';
import { useCallback } from 'react';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api';

/**
 * Returns a stable `request(method, path, body?)` function pre-loaded with the
 * current Convex auth token. Recreates only when the token changes.
 */
export function useApiClient() {
  const token = useAuthToken();
  return useCallback(
    async (method: string, path: string, body?: unknown): Promise<unknown> => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(text || `HTTP ${res.status}`);
      }
      if (res.status === 204) return null;
      return res.json();
    },
    [token],
  );
}
