import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const TERMINAL_STATUSES = new Set<SubscriptionStatus>(['past_due', 'cancelled', 'expired', 'paused']);

export async function resolveVenueSubscriptionStatus(
  prisma: PrismaService,
  input: {
    venueId: string;
    venueStatus?: SubscriptionStatus | null;
    trialEndsAt?: Date | null;
  },
): Promise<SubscriptionStatus | null> {
  // Fast path: a healthy, non-trial venue status (e.g. 'active') is
  // authoritative and needs no extra query. Only trial/terminal/empty states
  // require consulting the latest Subscription row.
  if (input.venueStatus && input.venueStatus !== 'trialing' && !TERMINAL_STATUSES.has(input.venueStatus)) {
    return input.venueStatus;
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
    await persistExpiredTrial(prisma, input.venueId, subscription?.id);
    return 'expired';
  }

  // Below here venueStatus is terminal or null; consult the subscription row.
  if (subscription?.status === 'trialing') {
    if (!trialExpired) {
      return 'trialing';
    }
    await persistExpiredTrial(prisma, input.venueId, subscription.id);
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

async function persistExpiredTrial(prisma: PrismaService, venueId: string, subscriptionId?: string) {
  await Promise.all([
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
  ]);
}
