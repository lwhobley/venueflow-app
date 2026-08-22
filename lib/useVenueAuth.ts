/**
 * Shared hook that combines the auth-store venue, authenticated session,
 * profile query, and manager permission check — previously duplicated
 * across 10+ screen files.
 */
import { useAuthStore, type AuthState } from './auth-store';
import { useAuthenticatedSession } from './auth-readiness';
import { useQueryState } from './railway-hooks';
import { api } from './railway-api';
import { canManageVenue } from './permissions';

export function useVenueAuth() {
  const venue = useAuthStore((state: AuthState) => state.venue);
  const venues = useAuthStore((state: AuthState) => state.venues);
  const switchVenue = useAuthStore((state: AuthState) => state.switchVenue);
  const { isReady, user } = useAuthenticatedSession();
  const { data: me, error: profileError, isLoading: profileFetching, refetch: refetchProfile } =
    useQueryState(api.app.getMe, isReady ? {} : 'skip');
  // profileLoading covers only the in-flight fetch. A persistent failure now
  // surfaces via profileError instead of being indistinguishable from loading
  // (both used to leave `me` as `undefined` forever).
  const profileLoading = isReady && profileFetching && me === undefined;
  const canManage = Boolean(
    me && canManageVenue(me.profile.role, me.profile.allAccess),
  );

  return {
    venue,
    venues,
    switchVenue,
    isReady,
    user,
    me,
    profileLoading,
    profileError: isReady && !profileFetching && me === undefined ? profileError : null,
    refetchProfile,
    canManage,
  } as const;
}
