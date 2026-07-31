/** Prisma OR clause: legacy null membership counts as active. */
export const ACTIVE_MEMBERSHIP = [
  { membershipStatus: null },
  { membershipStatus: 'active' as const },
];

export function isActiveMembership(status: string | null | undefined): boolean {
  return status === null || status === undefined || status === 'active';
}
