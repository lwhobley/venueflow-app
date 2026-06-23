import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createHash, pbkdf2, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const pbkdf2Async = promisify(pbkdf2);
const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 600_000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = 'sha256';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const hashBuffer = (await pbkdf2Async(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST)) as Buffer;
    return { salt, hash: hashBuffer.toString('hex') };
  }

  async verifyPassword(password: string, salt: string, iterations: number, hash: string) {
    const derived = (await pbkdf2Async(password, salt, iterations, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST)) as Buffer;
    const expected = Buffer.from(hash, 'hex');
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  }

  generateOneTimeCode() {
    return Array.from({ length: 6 }, () => randomInt(0, 10)).join('');
  }

  hashOneTimeCode(code: string) {
    return createHash('sha256').update(code.trim()).digest('hex');
  }

  async issueSession(userId: string, email: string, fullName?: string, inviteToken?: string, rawPhone?: string) {
    const trialEndsAt = new Date(Date.now() + TRIAL_DURATION_MS);
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });
    const emailVerified = Boolean(account?.emailVerifiedAt);
    
    const inviteValue = inviteToken?.trim();
    const invite = inviteValue
      ? emailVerified
      ? await this.prisma.invite.findFirst({
          where: {
            OR: [{ token: inviteValue }, { code: { equals: inviteValue, mode: 'insensitive' } }],
            usedBy: null,
            expiresAt: { gt: new Date() },
          },
        })
      : null
      : null;

    if (invite?.email && invite.email.toLowerCase() !== email) {
      throw new UnauthorizedException('This invite was sent to a different email address.');
    }
    const phone = rawPhone?.trim().replace(/[\s\-().+]/g, '') || undefined;
    if (!invite?.email && invite?.phone && invite.phone !== phone) {
      throw new UnauthorizedException('This invite was sent to a different mobile number.');
    }
    const trimmedFullName = fullName?.trim();
    const profile = await this.prisma.$transaction(async (tx) => {
      let activeInvite = invite;
      if (invite) {
        const claimed = await tx.invite.updateMany({
          where: { id: invite.id, usedBy: null },
          data: { usedBy: `pending:${userId}` },
        });
        if (claimed.count === 0) activeInvite = null;
      }

      const grant = activeInvite
        ? { venueId: activeInvite.venueId, role: activeInvite.role, jobTitle: activeInvite.jobTitle }
        : null;

      const existingByUser = await tx.profile.findUnique({
        where: { userId },
        include: { venue: true },
      });
      let result;
      if (existingByUser) {
        const unclaimedProfile = emailVerified
          ? await tx.profile.findFirst({
              where: { userId: null, email: { equals: email, mode: 'insensitive' }, venueId: { not: null } },
              orderBy: { createdAt: 'asc' },
              include: { venue: true },
            })
          : null;

        if (unclaimedProfile && (!existingByUser.venueId || existingByUser.venueId === unclaimedProfile.venueId)) {
          await tx.profile.delete({ where: { id: existingByUser.id } });
          result = await tx.profile.update({
            where: { id: unclaimedProfile.id },
            data: { userId },
            include: { venue: true },
          });
        } else {
          result = await tx.profile.update({
            where: { id: existingByUser.id },
            data: {
              email,
              ...(trimmedFullName ? { fullName: trimmedFullName } : {}),
              ...(grant ?? {}),
              ...(existingByUser.trialEndsAt ? {} : { trialEndsAt }),
            },
            include: { venue: true },
          });
        }
      } else {
        const claimedProfile = (grant
          ? await tx.profile.findFirst({
              where: { userId: null, venueId: grant.venueId, email: { equals: email, mode: 'insensitive' } },
              orderBy: { createdAt: 'asc' },
              include: { venue: true },
            })
          : await tx.profile.findFirst({
              where: { userId: null, email: { equals: email, mode: 'insensitive' }, venueId: { not: null } },
              orderBy: { createdAt: 'asc' },
              include: { venue: true },
            })) || null;
        if (claimedProfile) {
          result = await tx.profile.update({
            where: { id: claimedProfile.id },
            data: {
              userId,
              email,
              fullName: trimmedFullName || claimedProfile.fullName,
              role: grant?.role ?? claimedProfile.role,
              jobTitle: grant?.jobTitle ?? claimedProfile.jobTitle,
              venueId: grant?.venueId ?? claimedProfile.venueId,
              trialEndsAt: claimedProfile.trialEndsAt ?? trialEndsAt,
            },
            include: { venue: true },
          });
        } else {
          result = await tx.profile.create({
            data: {
              userId,
              email,
              fullName: trimmedFullName || email.split('@')[0] || 'Team Member',
              role: grant?.role ?? 'staff',
              jobTitle: grant?.jobTitle ?? 'Staff',
              venueId: grant?.venueId ?? undefined,
              trialEndsAt,
            },
            include: { venue: true },
          });
        }
      }

      if (activeInvite) {
        await tx.invite.update({ where: { id: activeInvite.id }, data: { usedBy: result.id } });
      }
      return result;
    });

    const session = await this.prisma.session.create({
      data: { userId, expiresAt: new Date(Date.now() + SESSION_DURATION_MS) },
    });
    return { session, profile };
  }
}
