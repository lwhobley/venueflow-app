type RoleName = string | null | undefined;

export function canManageVenue(role: RoleName) {
  return role === 'admin' || role === 'owner' || role === 'manager';
}

export function canManageBilling(role: RoleName) {
  return role === 'admin' || role === 'owner';
}
