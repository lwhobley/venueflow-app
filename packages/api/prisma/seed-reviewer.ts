/**
 * Creates a demo account for Apple App Store reviewers.
 *
 * Usage:
 *   REVIEWER_EMAIL="..." REVIEWER_PASSWORD="..." npx tsx prisma/seed-reviewer.ts
 *
 * Set the credentials in App Store Connect → App Review Information.
 * NEVER commit real credentials to source.
 *
 * The account is pre-verified, attached to a demo venue with an active
 * trial, and has the "owner" role so every feature is accessible.
 */
import { PrismaClient } from '@prisma/client';
import { pbkdf2, randomBytes } from 'crypto';
import { promisify } from 'util';

const pbkdf2Async = promisify(pbkdf2);

const DEMO_EMAIL = process.env.REVIEWER_EMAIL?.trim();
const DEMO_PASSWORD = process.env.REVIEWER_PASSWORD?.trim();

if (!DEMO_EMAIL || !DEMO_PASSWORD) {
  console.error('ERROR: REVIEWER_EMAIL and REVIEWER_PASSWORD env vars are required.');
  console.error('Usage: REVIEWER_EMAIL="..." REVIEWER_PASSWORD="..." npx tsx prisma/seed-reviewer.ts');
  process.exit(1);
}

const ITERATIONS = 600_000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

async function main() {
  const prisma = new PrismaClient();

  try {
    const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
    if (existing) {
      console.log('Reviewer account already exists — skipping.');
      return;
    }

    const salt = randomBytes(16).toString('hex');
    const hash = (await pbkdf2Async(DEMO_PASSWORD!, salt, ITERATIONS, KEY_LENGTH, DIGEST)).toString('hex');
    const trialEndsAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    await prisma.$transaction(async (tx) => {
      const venue = await tx.venue.create({
        data: {
          name: 'Demo Venue',
          latitude: 40.7128,
          longitude: -74.006,
          geofenceRadiusM: 200,
          timezone: 'America/New_York',
          address: '123 Demo Street, New York, NY 10001',
          venueType: 'restaurant',
          staffRange: '1-15',
          subscriptionStatus: 'trialing',
        },
      });

      const user = await tx.user.create({
        data: {
          email: DEMO_EMAIL!,
          emailVerifiedAt: new Date(),
          password: { create: { salt, passwordHash: hash, iterations: ITERATIONS } },
        },
      });

      await tx.profile.create({
        data: {
          userId: user.id,
          email: DEMO_EMAIL!,
          fullName: 'App Reviewer',
          role: 'owner',
          jobTitle: 'Owner',
          venueId: venue.id,
          allAccess: false,
          trialEndsAt,
        },
      });

      await tx.subscription.create({
        data: {
          venueId: venue.id,
          status: 'trialing',
          platform: null,
          planId: 'venueflow_monthly',
          priceCents: 9999,
          currency: 'USD',
          trialStartedAt: new Date(),
          trialEndsAt,
          cancelAtPeriodEnd: false,
        },
      });

      console.log('Reviewer account created successfully.');
      console.log(`  Email:    ${DEMO_EMAIL}`);
      console.log(`  Venue:    ${venue.name} (${venue.id})`);
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
