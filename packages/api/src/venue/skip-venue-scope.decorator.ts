import { SetMetadata } from '@nestjs/common';

export const SKIP_VENUE_SCOPE_KEY = 'skipVenueScope';

/**
 * Opt a route out of venue-scope resolution. Use on routes that run before a
 * profile/venue exists (e.g. bootstrap-profile, get-me).
 */
export const SkipVenueScope = () => SetMetadata(SKIP_VENUE_SCOPE_KEY, true);
