import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { canManageVenue } from '../../auth/roles';
import type { AuthUser } from '../../auth/auth.guard';
import { isActiveMembership } from '../../common/membership';
import { PrismaService } from '../../prisma/prisma.service';
import { runWithoutTenant } from '../../prisma/tenant-context';

/**
 * Shared profile/venue resolution for the /v1/app routes. Extracted verbatim
 * from AppController so AppController and the split-out AppBillingController /
 * AppStaffController resolve identically (same queries, same exceptions) — the
 * single source of truth for "who is this caller and what venue do they run".
 *
 * Multi-venue: a single user can have one profile per venue. When `venueId` is
 * supplied the lookup targets a specific (userId, venueId) pair; otherwise the
 * first profile with an active venue is returned for backwards compatibility.
 */
@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(user: AuthUser, venueId?: string | null) {
    const resolvedVenueId = venueId ?? user.venueId;
    if (resolvedVenueId) {
      return this.prisma.profile.findFirst({
        where: { userId: user.sub, venueId: resolvedVenueId },
        include: { venue: true },
      });
    }
    // Backwards-compat: return the first profile with a venue (or any profile).
    // A user can hold a venueless profile (created at signup, before any venue
    // exists) alongside a venued one; `orderBy: createdAt asc` alone would
    // return whichever is older, which is usually the venueless signup row.
    // Prefer the venued profile first so callers that check `.venue` (e.g.
    // requireVenueProfile) see the real membership instead of failing.
    const venued = await this.prisma.profile.findFirst({
      where: { userId: user.sub, venueId: { not: null } },
      include: { venue: true },
      orderBy: { createdAt: 'asc' },
    });
    if (venued) return venued;
    return this.prisma.profile.findFirst({
      where: { userId: user.sub },
      include: { venue: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Return all venues (with role) that a user belongs to. */
  async listUserVenues(userId: string) {
    const profiles = await runWithoutTenant(() => this.prisma.profile.findMany({
      where: {
        userId,
        venueId: { not: null },
        OR: [{ membershipStatus: null }, { membershipStatus: 'active' }],
      },
      include: { venue: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    }));
    return profiles
      .filter((p) => p.venue)
      .map((p) => ({
        id: p.venue!.id,
        name: p.venue!.name,
        role: p.role,
        profileId: p.id,
      }));
  }

  /** Checks whether the user has an active or trialing Multi-Venue subscription on any of their venues. */
  async hasMultiVenueSubscription(userId: string): Promise<boolean> {
    return runWithoutTenant(async () => {
      const profiles = await this.prisma.profile.findMany({
        where: {
          userId,
          venueId: { not: null },
          OR: [{ membershipStatus: null }, { membershipStatus: 'active' }],
        },
        select: { venueId: true },
      });
      const venueIds = Array.from(new Set(profiles.map((p) => p.venueId!).filter(Boolean)));
      if (!venueIds.length) return false;

      const sub = await this.prisma.subscription.findFirst({
        where: {
          venueId: { in: venueIds },
          status: { in: ['active', 'trialing'] },
          OR: [
            { planId: 'venueflow_multi_venue_5' },
            { priceCents: { gte: 39900 } },
            { planId: { contains: 'multi' } },
          ],
        },
      });
      return Boolean(sub);
    });
  }

  async ensureUser(user: AuthUser) {
    // Do NOT recreate the user from token claims: a deleted account's JWT stays
    // valid until expiry, and recreating here would silently resurrect it.
    const existing = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!existing) {
      throw new UnauthorizedException('This account no longer exists. Please sign in again.');
    }
    if (user.email && user.email !== existing.email) {
      return this.prisma.user.update({ where: { id: user.sub }, data: { email: user.email } });
    }
    return existing;
  }

  async requireVenueProfile(user: AuthUser, venueId?: string | null) {
    const profile = await this.getProfile(user, venueId);
    if (!profile?.venue) throw new ForbiddenException('Profile is not initialized');
    if (!isActiveMembership(profile.membershipStatus)) {
      throw new ForbiddenException('Profile is not active for this venue');
    }
    return profile;
  }

  async requireManagerProfile(user: AuthUser, venueId?: string | null) {
    const profile = await this.requireVenueProfile(user, venueId);
    if (!canManageVenue(profile.role, profile.allAccess)) throw new ForbiddenException('Not authorized');
    return profile;
  }

  async requireBillingProfile(user: AuthUser) {
    const profile = await this.requireVenueProfile(user);
    if (!(profile.role === 'admin' || profile.role === 'owner' || profile.allAccess)) {
      throw new ForbiddenException('Not authorized');
    }
    return profile;
  }

  async getVerifiedAccountEmail(userId: string) {
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true },
    });
    if (!account?.email || !account.emailVerifiedAt) {
      throw new ForbiddenException('Verify your email before using this feature.');
    }
    return account.email;
  }

  async isEmailVerified(userId: string) {
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });
    return Boolean(account?.emailVerifiedAt);
  }
}
