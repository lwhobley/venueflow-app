import type { ApiProfile, ApiVenue } from './api-client';
import type { UserSummary, Venue } from './types';

export function isUsableVenueMembership(profile: Pick<ApiProfile, 'emailVerified' | 'membershipStatus'>): boolean {
  if (!profile.emailVerified) return false;
  return profile.membershipStatus == null || profile.membershipStatus === 'active';
}

export function userFromProfile(profile: ApiProfile): UserSummary {
  return {
    id: profile._id,
    email: profile.email,
    full_name: profile.fullName,
    email_verified: profile.emailVerified === true,
    role: profile.role,
    job_title: profile.jobTitle,
    venue_id: isUsableVenueMembership(profile) ? profile.venueId ?? null : null,
    all_access: profile.allAccess === true,
  };
}

export function venueFromAuth(profile: ApiProfile, venue: ApiVenue | null | undefined): Venue | null {
  if (!venue || !isUsableVenueMembership(profile)) return null;
  return {
    id: venue._id,
    name: venue.name,
    latitude: venue.latitude,
    longitude: venue.longitude,
    geofence_radius_m: venue.geofenceRadiusM,
    timezone: venue.timezone ?? null,
  };
}
