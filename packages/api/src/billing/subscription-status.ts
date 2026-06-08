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
  if (input.venueStatus && !TERMINAL_STATUSES.has(input.venueStatus)) {
    return input.venueStatus;
  }

  const subscription = await prisma.subscription.findFirst({
    where: { venueId: input.venueId },
    orderBy: { updatedAt: 'desc' },
    select: { status: true },
  });
  if (subscription?.status) {
    return subscription.status;
  }

  if (input.venueStatus) {
    return input.venueStatus;
  }

  if (input.trialEndsAt && input.trialEndsAt.getTime() > Date.now()) {
    return 'trialing';
  }

  return null;
}
