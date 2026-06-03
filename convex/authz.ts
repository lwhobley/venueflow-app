import { getAuthUserId } from '@convex-dev/auth/server';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';

// Shared authorization helpers. Every mutation/query that touches venue-scoped
// data should derive the caller's identity, role, and venue from the
// authenticated profile here — NEVER from client-supplied args. Trusting an
// `actorRole` or `venueId` passed by the client is a privilege-escalation /
// cross-venue data-access vulnerability.

export type Profile = Doc<'profiles'>;
export type Role = Profile['role'];

const MANAGER_ROLES: ReadonlySet<Role> = new Set(['admin', 'owner', 'manager']);
// Operational roles can change live table state (servers included).
const OPERATOR_ROLES: ReadonlySet<Role> = new Set(['admin', 'owner', 'manager', 'server']);

export function isManager(role: Role): boolean {
  return MANAGER_ROLES.has(role);
}

export function isOperator(role: Role): boolean {
  return OPERATOR_ROLES.has(role);
}

export function hasAllAccess(profile: Profile): boolean {
  return profile.allAccess === true;
}

/** Loads the authenticated profile or throws. Keyed by the stable Convex Auth
 * user id — NOT tokenIdentifier (which embeds the session id and rotates). */
export async function requireProfile(ctx: QueryCtx | MutationCtx): Promise<Profile> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error('Unauthenticated');
  const profile = await ctx.db
    .query('profiles')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique();
  if (!profile) throw new Error('Profile not found');
  return profile as Profile;
}

/** Like requireProfile but returns null instead of throwing — for handlers that
 * degrade to an empty/no-op result (rather than an error) when the caller is
 * unauthenticated or has no profile. */
export async function getProfileOrNull(ctx: QueryCtx | MutationCtx): Promise<Profile | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return (await ctx.db
    .query('profiles')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique()) as Profile | null;
}

/** Manager-or-allAccess check on an already-loaded profile. The single source of
 * truth for "can manage this venue" on the server; mirrors canManageVenue on the
 * client. */
export function canManage(profile: Pick<Profile, 'role' | 'allAccess'>): boolean {
  return profile.allAccess === true || isManager(profile.role);
}

/**
 * Ensures the caller is assigned to `venueId`. Returns the caller's profile.
 * Closes the "profile has no venue → check skipped" hole by treating a missing
 * venue assignment as a hard deny.
 */
export async function requireVenueMember(ctx: QueryCtx | MutationCtx, venueId: string): Promise<Profile> {
  const profile = await requireProfile(ctx);
  if (!profile.venueId) throw new Error('Your account is not assigned to a venue');
  if (profile.venueId !== venueId) throw new Error('Resource is outside your venue');
  return profile;
}

/** Caller must be a manager (admin/owner/manager) of `venueId`. */
export async function requireVenueManager(ctx: QueryCtx | MutationCtx, venueId: string): Promise<Profile> {
  const profile = await requireVenueMember(ctx, venueId);
  if (!hasAllAccess(profile) && !isManager(profile.role)) throw new Error('Not authorized');
  return profile;
}

/** Caller must be an operator (manager or server) of `venueId`. */
export async function requireVenueOperator(ctx: QueryCtx | MutationCtx, venueId: string): Promise<Profile> {
  const profile = await requireVenueMember(ctx, venueId);
  if (!hasAllAccess(profile) && !isOperator(profile.role)) throw new Error('Not authorized');
  return profile;
}
