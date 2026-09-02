import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const ALLOW_UNVERIFIED_EMAIL_KEY = 'allowUnverifiedEmail';

/**
 * Marks a route handler (or controller) as publicly accessible, bypassing the
 * globally-registered AuthGuard. Use sparingly — endpoints are protected by
 * default.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Allows an authenticated, unverified account to reach only the small set of
 * endpoints needed to verify the address or end the session.
 */
export const AllowUnverifiedEmail = () => SetMetadata(ALLOW_UNVERIFIED_EMAIL_KEY, true);
