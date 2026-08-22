import { Prisma } from '@prisma/client';

export async function syncTeamMemberCount(tx: Prisma.TransactionClient, venueId: string | null | undefined) {
  if (!venueId) return;
  const count = await tx.profile.count({
    where: { venueId, OR: [{ membershipStatus: null }, { membershipStatus: 'active' }] },
  });
  await tx.team.upsert({
    where: { venueId },
    create: {
      venueId,
      name: 'Default Team',
      memberCount: count,
    },
    update: { memberCount: count },
  });
}
