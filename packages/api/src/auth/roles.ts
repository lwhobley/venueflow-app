/**
 * Roles that may manage venue-level configuration.
 */
export function isAdminRole(role?: string | null): boolean {
  return role === 'admin' || role === 'owner' || role === 'manager';
}

const ROLE_RANK: Record<string, number> = {
  staff: 0,
  server: 1,
  manager: 2,
  owner: 3,
  admin: 3,
};

export function canManageRole(actorRole: string | null | undefined, targetRole: string | null | undefined, actorAllAccess = false): boolean {
  if (actorAllAccess) return true;
  const actorRank = actorRole ? ROLE_RANK[actorRole] : undefined;
  const targetRank = targetRole ? ROLE_RANK[targetRole] : undefined;
  if (actorRank === undefined || targetRank === undefined) return false;
  return actorRank > targetRank;
}

export function isOwnerOrAdminRole(role?: string | null): boolean {
  return role === 'admin' || role === 'owner';
}
