/**
 * Pure, DB-free logic for the tenant-isolation Prisma extension. Kept separate
 * from the extension wiring so the security-critical behaviour is exhaustively
 * unit-testable without a database (see tenant-scope.spec.ts).
 */

/**
 * Every model that carries a direct `venueId` column (derived from schema.prisma).
 * Global models (User, Session, AuthAccount, PasswordCredential) and the tenant
 * root (Venue) are intentionally absent — they are never auto-scoped.
 */
export const VENUE_SCOPED_MODELS: ReadonlySet<string> = new Set([
  'AuditLog', 'Availability', 'BarInventoryItem', 'BarInventoryMovement', 'BlackoutDate',
  'ChatImage', 'Conversation', 'ConversationRead', 'CrmActivityLog', 'CrmBeo',
  'CrmContract', 'CrmLead', 'CrmNote', 'EmailTemplate', 'FloorChair', 'FloorPlan',
  'Guest', 'Invite', 'Invoice', 'ManagerGoal', 'Message', 'NotificationEvent',
  'NotificationRead', 'PaymentMethod', 'PayrollExport', 'PosCheck', 'PosConnection',
  'PosLaborPunch', 'PrepBoardItem', 'Profile', 'PushToken', 'Reservation', 'ReservationConnection',
  'ReservationHold', 'ReservationSetting', 'ReservationSyncEvent', 'ScheduleEmailEvent',
  'ScheduleShift', 'ScheduleTemplate', 'ShiftSwap', 'StaffOnboardingTask', 'StaffRequest', 'Subscription',
  'SubscriptionEvent', 'TableAssignment', 'TableState', 'TableStateHistory', 'Team',
  'TimeEntry', 'VenueEvent', 'VenueRole', 'Waitlist', 'WorkplaceJoinRequest',
]);

/**
 * Operations whose `where` accepts arbitrary (non-unique) filters, so we can
 * safely AND a venueId predicate into them.
 */
const FILTERABLE_OPERATIONS: ReadonlySet<string> = new Set([
  'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
  'updateMany', 'deleteMany',
]);

/**
 * Unique-keyed operations (findUnique, update, delete, upsert) require a unique
 * `where` selector and are deliberately NOT auto-scoped here — injecting a
 * non-unique venueId predicate is invalid for them. These remain the
 * responsibility of explicit call-site checks (the app already pairs them with a
 * venueId guard). This limitation is documented for reviewers.
 */
export function isVenueScoped(model: string | undefined | null): boolean {
  return !!model && VENUE_SCOPED_MODELS.has(model);
}

export function shouldScopeOperation(operation: string): boolean {
  return FILTERABLE_OPERATIONS.has(operation) || operation === 'create' || operation === 'createMany';
}

/**
 * Return a new args object with the tenant predicate enforced. The original is
 * never mutated. For filterable reads/writes the venueId is AND-ed into `where`
 * so a caller-supplied venueId cannot widen scope (a mismatching venueId simply
 * yields no rows). For creates, venueId is forced onto the row(s).
 */
export function scopeArgs<T extends Record<string, any> | undefined>(
  operation: string,
  args: T,
  venueId: string,
): T {
  const next: Record<string, any> = args ? { ...args } : {};

  if (FILTERABLE_OPERATIONS.has(operation)) {
    next.where = mergeVenueWhere(next.where, venueId);
    return next as T;
  }

  if (operation === 'create') {
    next.data = forceVenue(next.data, venueId);
    return next as T;
  }

  if (operation === 'createMany') {
    if (Array.isArray(next.data)) {
      next.data = next.data.map((row) => forceVenue(row, venueId));
    } else {
      next.data = forceVenue(next.data, venueId);
    }
    return next as T;
  }

  // Unique-keyed and other operations pass through unchanged.
  return next as T;
}

function mergeVenueWhere(where: unknown, venueId: string): Record<string, any> {
  if (where == null) return { venueId };
  // AND so an existing predicate (including a hostile venueId) can only narrow,
  // never widen, the result set.
  return { AND: [{ venueId }, where] };
}

function forceVenue(data: unknown, venueId: string): Record<string, any> {
  // Caller-provided venueId is overridden, not merged after — a create can never
  // write into another tenant.
  return { ...(data as Record<string, any> | undefined), venueId };
}
