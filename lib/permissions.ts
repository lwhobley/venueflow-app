type RoleName = string | null | undefined;
type Email = string | null | undefined;

const allAccessEmails = new Set(['user@venuewrangler.com']);

export function isAllAccessAccount(email: Email) {
  return Boolean(email && allAccessEmails.has(email.trim().toLowerCase()));
}

export function canManageVenue(role: RoleName, email?: Email) {
  return isAllAccessAccount(email) || role === 'admin' || role === 'owner' || role === 'manager';
}

export function canManageBilling(role: RoleName, email?: Email) {
  return isAllAccessAccount(email) || role === 'admin' || role === 'owner';
}
