import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { isAdminRole } from '../../auth/roles';
import type { AuthUser } from '../../auth/auth.guard';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Shared profile/venue resolution for the /v1/app routes. Extracted verbatim
 * from AppController so AppController and the split-out AppBillingController /
 * AppStaffController resolve identically (same queries, same exceptions) — the
 * single source of truth for "who is this caller and what venue do they run".
 */
@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  getProfile(user: AuthUser) {
    return this.prisma.profile.findUnique({
      where: { userId: user.sub },
      include: { venue: true },
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

  async requireVenueProfile(user: AuthUser) {
    const profile = await this.getProfile(user);
    if (!profile?.venue) throw new ForbiddenException('Profile is not initialized');
    if (!isActiveMembership(profile.membershipStatus)) {
      throw new ForbiddenException('Profile is not active for this venue');
    }
    return profile;
  }

  async requireManagerProfile(user: AuthUser) {
    const profile = await this.requireVenueProfile(user);
    if (!isAdminRole(profile.role)) throw new ForbiddenException('Not authorized');
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

function isActiveMembership(status: string | null): boolean {
  return status === null || status === 'active';
}
