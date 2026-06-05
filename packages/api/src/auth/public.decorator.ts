import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route handler (or controller) as publicly accessible, bypassing the
 * globally-registered AuthGuard. Use sparingly — endpoints are protected by
 * default.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
