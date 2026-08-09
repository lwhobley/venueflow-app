import { Prisma } from '@prisma/client';

export async function syncTeamMemberCount(tx: Prisma.TransactionClient, venueId: string | null | undefined) {
  if (!venueId) return;
  const count = await tx.profile.count({
    where: { venueId, OR: [{ membershipStatus: null }, { membershipStatus: 'active' }] },
  });
  const existingTeam = await tx.team.findFirst({
    where: { venueId },
  });
  if (existingTeam) {
    await tx.team.update({
      where: { id: existingTeam.id },
      data: { memberCount: count },
    });
  } else {
    await tx.team.create({
      data: {
        venueId,
        name: 'Default Team',
        memberCount: count,
      },
    });
  }
}
