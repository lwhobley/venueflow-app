import { getAuthUserId } from '@convex-dev/auth/server';
import type { Doc } from './_generated/dataModel';
import { isAllAccessAccount } from './permissions';

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

/** Loads the authenticated profile or throws. Keyed by the stable Convex Auth
 * user id — NOT tokenIdentifier (which embeds the session id and rotates). */
export async function requireProfile(ctx: any): Promise<Profile> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error('Unauthenticated');
  const profile = await ctx.db
    .query('profiles')
    .withIndex('by_userId', (q: any) => q.eq('userId', userId))
    .unique();
  if (!profile) throw new Error('Profile not found');
  return profile as Profile;
}

/**
 * Ensures the caller is assigned to `venueId`. Returns the caller's profile.
 * Closes the "profile has no venue → check skipped" hole by treating a missing
 * venue assignment as a hard deny.
 */
export async function requireVenueMember(ctx: any, venueId: string): Promise<Profile> {
  const profile = await requireProfile(ctx);
  if (!profile.venueId) throw new Error('Your account is not assigned to a venue');
  if (profile.venueId !== venueId) throw new Error('Resource is outside your venue');
  return profile;
}

/** Caller must be a manager (admin/owner/manager) of `venueId`. The all-access
 * QA account is treated as a manager once it is a member of the venue. */
export async function requireVenueManager(ctx: any, venueId: string): Promise<Profile> {
  const profile = await requireVenueMember(ctx, venueId);
  if (!isManager(profile.role) && !isAllAccessAccount(profile.email)) throw new Error('Not authorized');
  return profile;
}

/** Caller must be an operator (manager or server) of `venueId`. */
export async function requireVenueOperator(ctx: any, venueId: string): Promise<Profile> {
  const profile = await requireVenueMember(ctx, venueId);
  if (!isOperator(profile.role) && !isAllAccessAccount(profile.email)) throw new Error('Not authorized');
  return profile;
}
