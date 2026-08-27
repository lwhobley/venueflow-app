import { Platform } from 'react-native';
import { appApi } from './api-client';
import { useAuthStore } from './auth-store';

// The marketing site (venuewrangler.com) creates the workspace, stores the new
// session token under this key, then sends the browser into the web app. We
// adopt that token here so the user lands signed in instead of hitting a login
// wall. Same-origin localStorage is the handoff channel — no token in the URL.
const HANDOFF_TOKEN_KEY = 'venuewrangler_token';
const HANDOFF_WORKSPACE_KEY = 'venuewrangler_workspace';

/**
 * If the marketing site handed off a session token, adopt it: set the token,
 * load the canonical profile/venue from the API, populate the auth store, then
 * clear the handoff keys so a later sign-out can't be undone by a stale token.
 * Returns true if a handoff was consumed. Web-only; a no-op elsewhere.
 */
export async function consumeWebHandoff(): Promise<boolean> {
  if (Platform.OS !== 'web') return false;
  let handoffToken: string | null = null;
  try {
    handoffToken = window.localStorage.getItem(HANDOFF_TOKEN_KEY);
  } catch {
    return false;
  }
  if (!handoffToken) return false;

  // Don't clobber an already signed-in session (e.g. a different account).
  if (useAuthStore.getState().token) {
    clearHandoff();
    return false;
  }

  // apiRequest reads the bearer token from the store, so set it before getMe.
  useAuthStore.setState({ token: handoffToken });
  try {
    const me = await appApi.getMe();
    if (!me?.profile) {
      useAuthStore.getState().clearSession();
      clearHandoff();
      return false;
    }
    const { profile, venue } = me;
    useAuthStore.getState().setSession({
      user: {
        id: profile._id,
        email: profile.email,
        full_name: profile.fullName,
        email_verified: profile.emailVerified === true,
        role: profile.role,
        job_title: profile.jobTitle,
        venue_id: profile.venueId ?? null,
        all_access: profile.allAccess === true,
      },
      venue: venue
        ? {
            id: venue._id,
            name: venue.name,
            latitude: venue.latitude,
            longitude: venue.longitude,
            geofenceRadiusM: venue.geofenceRadiusM,
            geofence_radius_m: venue.geofenceRadiusM,
          }
        : null,
      token: handoffToken,
    });
    clearHandoff();
    return true;
  } catch {
    // A bad/expired handoff token shouldn't strand the app — drop it and fall
    // back to the normal welcome/login flow.
    useAuthStore.getState().clearSession();
    clearHandoff();
    return false;
  }
}

function clearHandoff() {
  try {
    window.localStorage.removeItem(HANDOFF_TOKEN_KEY);
    window.localStorage.removeItem(HANDOFF_WORKSPACE_KEY);
  } catch {
    /* ignore */
  }
}
