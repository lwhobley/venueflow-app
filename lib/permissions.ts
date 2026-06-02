type RoleName = string | null | undefined;

export function hasAllAccess(allAccess: boolean | null | undefined) {
  return allAccess === true;
}

export function canManageVenue(role: RoleName, allAccess?: boolean | null) {
  return hasAllAccess(allAccess) || role === 'admin' || role === 'owner' || role === 'manager';
}

export function canManageBilling(role: RoleName, allAccess?: boolean | null) {
  return hasAllAccess(allAccess) || role === 'admin' || role === 'owner';
}
