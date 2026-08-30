import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const TERMINAL_STATUSES = new Set<SubscriptionStatus>(['past_due', 'cancelled', 'expired', 'paused']);

export async function resolveVenueSubscriptionStatus(
  prisma: PrismaService,
  input: {
    venueId: string;
    venueStatus?: SubscriptionStatus | null;
    /**
     * venue.subscriptionPlatform. Null means no external billing provider owns
     * this venue yet, which is what makes the app-native trial fast path below
     * safe. Omit it and the fast path simply does not apply.
     */
    venuePlatform?: string | null;
    trialEndsAt?: Date | null;
  },
): Promise<SubscriptionStatus | null> {
  // Fast path: a healthy, non-trial venue status (e.g. 'active') is
  // authoritative and needs no extra query. Only trial/terminal/empty states
  // require consulting the latest Subscription row.
  if (input.venueStatus && input.venueStatus !== 'trialing' && !TERMINAL_STATUSES.has(input.venueStatus)) {
    return input.venueStatus;
  }

  // Second fast path: an app-native trial that has not yet expired.
  //
  // 'trialing' is where every new customer spends their first 14 days, and
  // without this every subscription-gated request in that window paid for a
  // third serial database round trip against a pool of 3.
  //
  // Deliberately restricted to venues with no billing platform recorded. Once
  // Stripe or Apple owns the subscription, two things below can legitimately
  // disagree with `venue.subscriptionStatus`: the Subscription row may carry a
  // different status, and its `trialEndsAt` (the provider's, which wins) may be
  // earlier than the profile's 14-day mark. Skipping the read in that case
  // would keep serving a venue whose provider trial has already ended.
  // `=== null` deliberately, not falsy: an omitted venuePlatform means the
  // caller does not know, and an unknown platform must fall through to the
  // authoritative read rather than silently taking the optimistic path.
  if (
    input.venueStatus === 'trialing'
    && input.venuePlatform === null
    && input.trialEndsAt
    && input.trialEndsAt.getTime() > Date.now()
  ) {
    return 'trialing';
  }

  const subscription = await prisma.subscription.findFirst({
    where: { venueId: input.venueId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, status: true, trialEndsAt: true },
  });

  const trialEndsAt = subscription?.trialEndsAt ?? input.trialEndsAt ?? null;
  const trialExpired = trialEndsAt ? trialEndsAt.getTime() <= Date.now() : true;

  if (input.venueStatus === 'trialing') {
    if (subscription?.status && subscription.status !== 'trialing') {
      return subscription.status;
    }
    if (!trialExpired) {
      return 'trialing';
    }
    persistExpiredTrial(prisma, input.venueId, subscription?.id);
    return 'expired';
  }

  // Below here venueStatus is terminal or null; consult the subscription row.
  if (subscription?.status === 'trialing') {
    if (!trialExpired) {
      return 'trialing';
    }
    persistExpiredTrial(prisma, input.venueId, subscription.id);
    return 'expired';
  }

  if (subscription?.status) {
    return subscription.status;
  }

  if (input.venueStatus) {
    return input.venueStatus;
  }

  if (trialEndsAt && !trialExpired) {
    return 'trialing';
  }

  return trialEndsAt ? 'expired' : null;
}

/**
 * Best-effort persistence of trial expiry. Deliberately fire-and-forget: the
 * caller has already computed the correct 'expired' status to return, so this
 * write is only a cache-update. Not awaited (keeps the read path fast) and
 * self-swallowing (a read-replica or transient failure must not surface as an
 * unhandled rejection on what is otherwise a GET).
 */
function persistExpiredTrial(prisma: PrismaService, venueId: string, subscriptionId?: string) {
  void Promise.all([
    prisma.venue.updateMany({
      where: { id: venueId, subscriptionStatus: 'trialing' },
      data: { subscriptionStatus: 'expired' },
    }),
    subscriptionId
      ? prisma.subscription.updateMany({
          where: { id: subscriptionId, status: 'trialing' },
          data: { status: 'expired' },
        })
      : Promise.resolve(),
  ]).catch(() => {
    // Swallow: the returned status is authoritative regardless of this write.
  });
}
