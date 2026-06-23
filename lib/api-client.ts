import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useAuthStore } from './auth-store';
import type { Role } from './types';

const configuredApiBaseUrl =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.EXPO_PUBLIC_API_URL as string | undefined) ??
  null;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type ApiProfile = {
  _id: string;
  email: string;
  fullName: string;
  emailVerified: boolean;
  role: Role;
  jobTitle: string;
  venueId: string | null;
  allAccess: boolean;
  trialEndsAt?: number | null;
};

type ApiVenue = {
  _id: string;
  name: string;
  latitude: number;
  longitude: number;
  geofenceRadiusM: number;
};

export type AuthSessionResponse = {
  token: string;
  profile: ApiProfile;
  venue: ApiVenue | null;
};

function getApiBaseUrl() {
  if (!configuredApiBaseUrl) {
    throw new ApiError('The app is missing EXPO_PUBLIC_API_URL. Set it before signing in.', 500);
  }
  return configuredApiBaseUrl;
}

/**
 * Resolve a media reference to an absolute URL for <Image>. Server-stored chat
 * photos come back as relative paths (e.g. /v1/chat/images/<id>); legacy or
 * external URLs are already absolute and pass through unchanged.
 */
export function resolveMediaUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${getApiBaseUrl()}${path}`;
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = useAuthStore.getState().token;
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
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

export type InviteCheckResult =
  | { status: 'found'; venueName: string; jobTitle: string; role: string; expiresAt: number }
  | { status: 'not_found' | 'expired' | 'used' };

export type JoinRequestResult = { requestId: string; status: 'pending'; venueName: string };
export type VenueSearchResult = { id: string; name: string; address: string | null; code: string | null };

export const appApi = {
  passwordAuth: (body: {
    email: string;
    phone?: string;
    password: string;
    flow: 'signIn' | 'signUp';
    firstName?: string;
    fullName?: string;
    lastName?: string;
    inviteToken?: string;
  }) =>
    apiRequest<AuthSessionResponse>('/v1/auth/password', { method: 'POST', body }),
  resendVerification: () => apiRequest<{ ok: true; alreadyVerified?: boolean }>('/v1/auth/verify-email/send', { method: 'POST' }),
  verifyEmail: (body: { code: string }) => apiRequest<{ ok: true; alreadyVerified?: boolean }>('/v1/auth/verify-email', { method: 'POST', body }),
  forgotPassword: (body: { email: string }) => apiRequest<{ ok: true }>('/v1/auth/forgot-password', { method: 'POST', body }),
  resetPassword: (body: { email: string; code: string; newPassword: string }) =>
    apiRequest<{ ok: true }>('/v1/auth/reset-password', { method: 'POST', body }),
  // Public: preview which team an invite code belongs to before signing up.
  previewInvite: (code: string) =>
    apiRequest<{ valid: boolean; venueName: string; role: string; jobTitle: string; expiresAt: number }>(
      '/v1/app/invite/' + encodeURIComponent(code.trim()),
    ),
  // Solo user joins an existing team later by code.
  joinByCode: (code: string) =>
    apiRequest<{ profile: ApiProfile; venue: ApiVenue | null }>('/v1/app/join', { method: 'POST', body: { code } }),
  redeemInvite: (codeOrToken: string) =>
    apiRequest<{ redeemed: boolean; profile?: ApiProfile; venue?: ApiVenue | null }>('/v1/app/redeem-invite', { method: 'POST', body: { codeOrToken } }),
  redeemMyInvite: () =>
    apiRequest<{ redeemed: boolean; profile?: ApiProfile; venue?: ApiVenue | null }>('/v1/app/redeem-my-invite', { method: 'POST' }),
  getMe: () => apiRequest<{ profile: ApiProfile; venue: ApiVenue | null } | null>('/v1/app/me'),
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
  breakStart: (body: { type: 'paid' | 'unpaid' }) => apiRequest('/v1/app/time-clock/break-start', { method: 'POST', body }),
  breakEnd: () => apiRequest('/v1/app/time-clock/break-end', { method: 'POST' }),
  listVenueStaff: () => apiRequest<any[]>('/v1/app/staff'),
  upsertVenueStaff: (body: { venueId: string; email: string; fullName: string; role: string; jobTitle: string; phone?: string; altPhone?: string; address?: string; dateOfBirth?: string; certifications?: string[] }) =>
    apiRequest('/v1/app/staff', { method: 'POST', body }),
  deactivateVenueStaff: (staffId: string) => apiRequest('/v1/app/staff/' + staffId, { method: 'DELETE' }),
  createStaffRequest: (body: { kind: string; title: string; details: string; availability?: any }) =>
    apiRequest('/v1/staff-requests', { method: 'POST', body }),
  updateVenue: (body: { name?: string; latitude?: number; longitude?: number; geofenceRadiusM?: number }) =>
    apiRequest<any>('/v1/app/venue', { method: 'PATCH', body }),
  deleteMyAccount: () => apiRequest('/v1/app/me', { method: 'DELETE' }),

  // ─── Workforce ───────────────────────────────────────────────────────────────
  inviteCheck: (body: { email?: string; phone?: string }) =>
    apiRequest<InviteCheckResult>('/v1/workforce/invite-check', { method: 'POST', body }),
  searchVenues: (q: string) =>
    apiRequest<{ venues: VenueSearchResult[] }>(`/v1/workforce/venues/search?q=${encodeURIComponent(q)}`),
  submitJoinRequest: (body: { venueId: string; code: string }) =>
    apiRequest<JoinRequestResult>('/v1/workforce/join-request', { method: 'POST', body }),
  listMyJoinRequests: () =>
    apiRequest<{ requests: any[] }>('/v1/workforce/join-requests'),
  cancelJoinRequest: (id: string) =>
    apiRequest('/v1/workforce/join-request/' + id, { method: 'DELETE' }),
  listManagerJoinRequests: () =>
    apiRequest<{ requests: any[] }>('/v1/workforce/manager/join-requests'),
  approveJoinRequest: (id: string) =>
    apiRequest('/v1/workforce/manager/join-request/' + id + '/approve', { method: 'POST', body: {} }),
  rejectJoinRequest: (id: string, note?: string) =>
    apiRequest('/v1/workforce/manager/join-request/' + id + '/reject', { method: 'POST', body: { note } }),
};
