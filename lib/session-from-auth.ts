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

export function venueFromApi(venue: {
  _id?: string;
  id?: string;
  name: string;
  latitude: number;
  longitude: number;
  geofenceRadiusM?: number;
  geofence_radius_m?: number;
  timezone?: string | null;
}): Venue {
  return {
    id: venue._id ?? venue.id ?? '',
    name: venue.name,
    latitude: venue.latitude,
    longitude: venue.longitude,
    geofenceRadiusM: venue.geofenceRadiusM ?? venue.geofence_radius_m ?? 0,
    geofence_radius_m: venue.geofenceRadiusM ?? venue.geofence_radius_m ?? 0,
    timezone: venue.timezone ?? null,
  };
}

export function venueFromAuth(profile: ApiProfile, venue: ApiVenue | null | undefined): Venue | null {
  if (!venue || !isUsableVenueMembership(profile)) return null;
  return venueFromApi(venue);
}
