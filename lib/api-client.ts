import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useAuthStore } from './auth-store';

const apiBaseUrl =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.EXPO_PUBLIC_API_URL as string | undefined) ??
  'https://venue-wranglerapi-production.up.railway.app/api';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = useAuthStore.getState().token;
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const message =
      typeof errorBody?.message === 'string'
        ? errorBody.message
        : Array.isArray(errorBody?.message)
          ? errorBody.message.join(', ')
          : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return null as T;
  return response.json() as Promise<T>;
}

export function useApiQuery<T>(queryKey: QueryKey, path: string, enabled = true) {
  const token = useAuthStore((state) => state.token);
  return useQuery({
    queryKey,
    queryFn: () => apiRequest<T>(path),
    enabled: enabled && Boolean(token),
  });
}

export function useApiMutation<TArgs, TResult>(
  mutationFn: (args: TArgs) => Promise<TResult>,
  invalidate: QueryKey[] = [],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all(invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });
}

export const appApi = {
  passwordAuth: (body: { email: string; password: string; flow: 'signIn' | 'signUp'; fullName?: string; inviteToken?: string }) =>
    apiRequest<{ token: string; profile: any; venue: any | null }>('/v1/auth/password', { method: 'POST', body }),
  getMe: () => apiRequest<{ profile: any; venue: any | null } | null>('/v1/app/me'),
  getBilling: () => apiRequest<any | null>('/v1/app/billing'),
  syncAppleSubscription: (body: { productId: string; entitlementId?: string }) =>
    apiRequest<any>('/v1/app/billing/apple/sync', { method: 'POST', body }),
  getDashboard: () => apiRequest<any | null>('/v1/app/dashboard'),
  getNotifications: () => apiRequest<any[]>('/v1/app/notifications'),
  markNotificationRead: (notificationId: string) => apiRequest('/v1/app/notifications/' + notificationId + '/read', { method: 'POST' }),
  getClockBoard: () => apiRequest<any | null>('/v1/app/clock-board'),
  getMyTimeClock: () => apiRequest<any | null>('/v1/app/time-clock'),
  clockIn: (body: { lat: number; lng: number; accuracy: number; mocked: boolean }) => apiRequest('/v1/app/clock-in', { method: 'POST', body }),
  clockOut: (body: { lat: number; lng: number; accuracy: number; mocked: boolean }) => apiRequest('/v1/app/clock-out', { method: 'POST', body }),
  listVenueStaff: () => apiRequest<any[]>('/v1/app/staff'),
  upsertVenueStaff: (body: { venueId: string; email: string; fullName: string; role: string; jobTitle: string }) =>
    apiRequest('/v1/app/staff', { method: 'POST', body }),
  deactivateVenueStaff: (staffId: string) => apiRequest('/v1/app/staff/' + staffId, { method: 'DELETE' }),
  updateVenue: (body: { name?: string; latitude?: number; longitude?: number; geofenceRadiusM?: number }) =>
    apiRequest<any>('/v1/app/venue', { method: 'PATCH', body }),
  deleteMyAccount: () => apiRequest('/v1/app/me', { method: 'DELETE' }),
};
