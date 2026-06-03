import { defineSchema, defineTable } from 'convex/server';
import { authTables } from '@convex-dev/auth/server';
import { v } from 'convex/values';

const role = v.union(v.literal('admin'), v.literal('owner'), v.literal('manager'), v.literal('server'), v.literal('staff'));
const tableShape = v.union(v.literal('round'), v.literal('square'), v.literal('rect'), v.literal('booth'));
const tableSection = v.union(v.literal('main'), v.literal('patio'), v.literal('bar'), v.literal('vip'));
const tableStatus = v.union(
  v.literal('available'),
  v.literal('seated'),
  v.literal('dirty'),
  v.literal('reserved'),
  v.literal('held'),
  v.literal('out_of_service'),
);
const requestStatus = v.union(v.literal('pending'), v.literal('approved'), v.literal('denied'), v.literal('cancelled'));
const reservationStatus = v.union(
  v.literal('requested'),
  v.literal('confirmed'),
  v.literal('checked_in'),
  v.literal('seated'),
  v.literal('completed'),
  v.literal('no_show'),
  v.literal('cancelled'),
);
const reservationSource = v.union(v.literal('direct'), v.literal('opentable'), v.literal('resy'), v.literal('phone'), v.literal('walk_in'));
const externalReservationSource = v.union(reservationSource, v.literal('sevenrooms'), v.literal('tock'), v.literal('google'));
const privateEventStatus = v.union(v.literal('inquiry'), v.literal('proposal'), v.literal('contract_sent'), v.literal('booked'), v.literal('completed'), v.literal('cancelled'));
const waitlistStatus = v.union(v.literal('waiting'), v.literal('assigned'), v.literal('seated'), v.literal('completed'), v.literal('removed'));
const assignmentHoldType = v.union(v.literal('reserved'), v.literal('held'), v.literal('seated'));
const posProvider = v.union(v.literal('toast'), v.literal('square'), v.literal('clover'), v.literal('generic'));
const posConnectionStatus = v.union(v.literal('connected'), v.literal('paused'), v.literal('error'));
const posCheckStatus = v.union(v.literal('open'), v.literal('paid'), v.literal('void'));
const reservationProvider = v.union(v.literal('opentable'), v.literal('resy'), v.literal('sevenrooms'), v.literal('tock'), v.literal('google'), v.literal('generic'));
const integrationStatus = v.union(v.literal('connected'), v.literal('paused'), v.literal('error'));
const barStockCategory = v.union(v.literal('spirit'), v.literal('wine'), v.literal('beer'), v.literal('mixer'), v.literal('garnish'), v.literal('supply'), v.literal('other'));
const barStockMovementType = v.union(v.literal('count'), v.literal('received'), v.literal('waste'), v.literal('comp'), v.literal('transfer'), v.literal('correction'));
const managerGoalPeriod = v.union(v.literal('day'), v.literal('week'));
const managerGoalStatus = v.union(v.literal('open'), v.literal('done'), v.literal('cancelled'));

export default defineSchema({
  ...authTables,
  profiles: defineTable({
    // Stable Convex Auth user id (from getAuthUserId). This is the canonical
    // key for a profile — tokenIdentifier embeds the session id and changes
    // every session, so it must NOT be used to look up profiles.
    userId: v.optional(v.id('users')),
    tokenIdentifier: v.optional(v.string()),
    email: v.string(),
    fullName: v.string(),
    role,
    jobTitle: v.string(),
    venueId: v.optional(v.id('venues')),
    // Server-owned privileged access flag. Never derived from email or client input.
    allAccess: v.optional(v.boolean()),
    // Per-user 14-day free trial, started at sign up. Standalone accounts (no
    // venue) rely on this; once a venue is joined the venue subscription governs.
    trialEndsAt: v.optional(v.number()),
  })
    .index('by_userId', ['userId'])
    .index('by_tokenIdentifier', ['tokenIdentifier'])
    .index('by_venueId', ['venueId'])
    .index('by_email', ['email']),
  venues: defineTable({
    name: v.string(),
    latitude: v.number(),
    longitude: v.number(),
    geofenceRadiusM: v.number(),
    code: v.optional(v.string()), // legacy short join code
    // Owner-supplied business details collected at signup.
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    venueType: v.optional(v.string()),
    staffRange: v.optional(v.string()),
    weeklyLaborBudgetHours: v.optional(v.number()), // for scheduling budget warnings
    schedulePublishedAt: v.optional(v.number()),
    schedulePublishedBy: v.optional(v.id('profiles')),
    scheduleUpdatedAfterPublishAt: v.optional(v.number()),
    subscriptionStatus: v.optional(v.union(v.literal('trialing'), v.literal('active'), v.literal('past_due'), v.literal('cancelled'), v.literal('expired'), v.literal('paused'))),
    subscriptionPlatform: v.optional(v.union(v.literal('stripe'), v.literal('apple'), v.null())),
    // Per-venue secret for the /crm/leads webhook. Mirrors the per-connection
    // secret on posConnections/reservationConnections so a leaked deployment-wide
    // LEADS_WEBHOOK_SECRET alone can't inject leads into a venue the caller does
    // not hold this secret for. Generated on demand; never returned via reads.
    leadsWebhookSecret: v.optional(v.string()),
  }).index('by_code', ['code']),
  venueRoles: defineTable({
    venueId: v.id('venues'),
    name: v.string(),
  }).index('by_venue', ['venueId']),
  teams: defineTable({
    venueId: v.id('venues'),
    name: v.string(),
    memberCount: v.number(),
  }).index('by_venueId', ['venueId']),
  scheduleShifts: defineTable({
    venueId: v.id('venues'),
    profileId: v.optional(v.id('profiles')),
    dayIndex: v.number(),
    startMinutes: v.number(),
    endMinutes: v.number(),
    jobTitle: v.string(),
    station: v.string(),
    notes: v.optional(v.string()),
    status: v.union(v.literal('scheduled'), v.literal('open'), v.literal('covered')),
  })
    .index('by_venueId', ['venueId'])
    .index('by_dayIndex', ['dayIndex'])
    .index('by_profileId', ['profileId'])
    // Scopes double-booking lookups to one venue/person/day instead of loading
    // every shift a profile has ever worked across all venues.
    .index('by_venue_profile_day', ['venueId', 'profileId', 'dayIndex']),
  scheduleTemplates: defineTable({
    venueId: v.id('venues'),
    name: v.string(),
    shifts: v.array(
      v.object({
        dayIndex: v.number(),
        startMinutes: v.number(),
        endMinutes: v.number(),
        jobTitle: v.string(),
        station: v.string(),
      }),
    ),
    createdAt: v.number(),
  }).index('by_venue', ['venueId']),
  shiftSwaps: defineTable({
    venueId: v.id('venues'),
    requesterProfileId: v.id('profiles'),
    requesterShiftId: v.id('scheduleShifts'),
    targetProfileId: v.id('profiles'),
    targetShiftId: v.optional(v.id('scheduleShifts')), // mutual swap; omitted = give-away
    status: v.union(
      v.literal('proposed'),
      v.literal('accepted'),
      v.literal('declined'),
      v.literal('approved'),
      v.literal('denied'),
      v.literal('cancelled'),
    ),
    note: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_venue', ['venueId'])
    .index('by_requester', ['requesterProfileId'])
    .index('by_target', ['targetProfileId']),
  availability: defineTable({
    venueId: v.id('venues'),
    profileId: v.id('profiles'),
    dayIndex: v.number(), // 0 = Sun ... 6 = Sat
    startMinutes: v.number(),
    endMinutes: v.number(),
    available: v.boolean(),
    updatedAt: v.number(),
  })
    .index('by_profile', ['profileId'])
    .index('by_venue', ['venueId'])
    .index('by_profile_day', ['profileId', 'dayIndex']),
  conversations: defineTable({
    venueId: v.id('venues'),
    type: v.union(v.literal('group'), v.literal('dm')),
    name: v.optional(v.string()),
    // For DMs: the two participant profile ids. For groups: empty (any venue member).
    memberIds: v.array(v.id('profiles')),
    lastMessageAt: v.optional(v.number()),
    lastMessageText: v.optional(v.string()),
  }).index('by_venue', ['venueId']),
  messages: defineTable({
    conversationId: v.id('conversations'),
    venueId: v.id('venues'),
    senderId: v.id('profiles'),
    text: v.string(),
    createdAt: v.number(),
  }).index('by_conversation', ['conversationId']),
  notificationEvents: defineTable({
    venueId: v.id('venues'),
    profileId: v.optional(v.id('profiles')),
    audience: v.union(v.literal('managers'), v.literal('staff'), v.literal('profile')),
    kind: v.union(
      v.literal('shift_assigned'),
      v.literal('schedule_published'),
      v.literal('swap_proposed'),
      v.literal('swap_reviewed'),
      v.literal('request_created'),
      v.literal('request_reviewed'),
      v.literal('reservation_due'),
      v.literal('reservation_created'),
      v.literal('reservation_updated'),
      v.literal('clock_alert'),
    ),
    title: v.string(),
    body: v.string(),
    // Legacy per-document read list. No longer written to — read receipts now
    // live in the `notificationReads` table to avoid unbounded document growth
    // and write contention on venue-wide notifications. Kept optional so
    // existing rows remain valid.
    readBy: v.optional(v.array(v.id('profiles'))),
    createdAt: v.number(),
  }).index('by_venue_and_createdAt', ['venueId', 'createdAt']).index('by_profile_and_createdAt', ['profileId', 'createdAt']),
  // One row per (notification, reader). Replaces the unbounded readBy array on
  // notificationEvents so a venue-wide notification's read receipts scale and
  // don't contend on a single document.
  notificationReads: defineTable({
    notificationId: v.id('notificationEvents'),
    profileId: v.id('profiles'),
    venueId: v.id('venues'),
    readAt: v.number(),
  })
    .index('by_notification_and_profile', ['notificationId', 'profileId'])
    .index('by_profile', ['profileId']),
  scheduleEmailEvents: defineTable({
    venueId: v.id('venues'),
    profileId: v.id('profiles'),
    shiftId: v.optional(v.id('scheduleShifts')),
    kind: v.union(v.literal('schedule_published'), v.literal('shift_changed')),
    email: v.string(),
    subject: v.string(),
    sentAt: v.number(),
  }).index('by_venue_and_sentAt', ['venueId', 'sentAt']).index('by_profile_and_sentAt', ['profileId', 'sentAt']),
  pushTokens: defineTable({
    venueId: v.id('venues'),
    profileId: v.id('profiles'),
    token: v.string(),
    platform: v.union(v.literal('ios'), v.literal('android'), v.literal('web'), v.literal('unknown')),
    enabled: v.boolean(),
    lastSeenAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_profile', ['profileId']).index('by_venue', ['venueId']).index('by_token', ['token']),
  blackoutDates: defineTable({
    venueId: v.id('venues'),
    startDate: v.string(), // YYYY-MM-DD (inclusive)
    endDate: v.string(), // YYYY-MM-DD (inclusive)
    reason: v.string(),
    createdBy: v.id('profiles'),
    createdAt: v.number(),
  }).index('by_venue', ['venueId']),
  timeEntries: defineTable({
    profileId: v.id('profiles'),
    venueId: v.id('venues'),
    clockInAt: v.number(),
    clockOutAt: v.optional(v.number()),
    clockInLat: v.number(),
    clockInLng: v.number(),
    clockInAccuracyM: v.number(),
    clockInMocked: v.boolean(),
    clockOutLat: v.optional(v.number()),
    clockOutLng: v.optional(v.number()),
    clockOutAccuracyM: v.optional(v.number()),
    clockOutMocked: v.optional(v.boolean()),
    isOpen: v.boolean(),
  }).index('by_profileId_and_isOpen', ['profileId', 'isOpen']).index('by_venueId', ['venueId']).index('by_venue_clockInAt', ['venueId', 'clockInAt']).index('by_isOpen', ['isOpen']),
  staffRequests: defineTable({
    venueId: v.id('venues'),
    profileId: v.id('profiles'),
    kind: v.union(v.literal('add_shift'), v.literal('drop_shift'), v.literal('time_off'), v.literal('availability')),
    status: requestStatus,
    title: v.string(),
    details: v.string(),
    requestedForDate: v.optional(v.string()),
    requestedShiftId: v.optional(v.id('scheduleShifts')),
    requestedRangeStart: v.optional(v.string()),
    requestedRangeEnd: v.optional(v.string()),
    availability: v.optional(v.array(v.object({
      dayIndex: v.number(),
      startMinutes: v.number(),
      endMinutes: v.number(),
      available: v.boolean(),
    }))),
    reviewerId: v.optional(v.id('profiles')),
    reviewedAt: v.optional(v.number()),
    responseNotes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_venueId', ['venueId']).index('by_profileId', ['profileId']).index('by_status', ['status']).index('by_kind', ['kind']),
  guests: defineTable({
    venueId: v.id('venues'),
    fullName: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    lifecycleStage: v.optional(v.union(v.literal('lead'), v.literal('regular'), v.literal('vip'), v.literal('lapsed'))),
    source: v.optional(v.string()),
    birthday: v.optional(v.string()),
    company: v.optional(v.string()),
    marketingOptIn: v.optional(v.boolean()),
    favoriteTable: v.optional(v.string()),
    preferredServer: v.optional(v.string()),
    dietaryNotes: v.optional(v.string()),
    tags: v.array(v.string()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
    // Lowercased fullName for indexed name lookups (POS check → guest linking).
    // Written on guest create/rename; legacy rows are backfilled lazily on match.
    nameLower: v.optional(v.string()),
  })
    .index('by_venue', ['venueId'])
    .index('by_phone', ['phone'])
    .index('by_email', ['email'])
    .index('by_venue_nameLower', ['venueId', 'nameLower']),
  posConnections: defineTable({
    venueId: v.id('venues'),
    provider: posProvider,
    externalLocationId: v.optional(v.string()),
    status: posConnectionStatus,
    // Per-connection webhook secret. Inbound webhooks must present this in
    // addition to the deployment-wide transport secret, so a leaked global
    // secret can't post for a venue it doesn't hold the connection secret for.
    webhookSecret: v.optional(v.string()),
    lastSyncAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_venue', ['venueId']).index('by_venue_and_provider', ['venueId', 'provider']),
  posChecks: defineTable({
    venueId: v.id('venues'),
    provider: posProvider,
    externalCheckId: v.string(),
    tableLabel: v.optional(v.string()),
    tableId: v.optional(v.id('tables')),
    serverName: v.optional(v.string()),
    serverId: v.optional(v.id('profiles')),
    guestName: v.optional(v.string()),
    guestId: v.optional(v.id('guests')),
    openedAt: v.number(),
    closedAt: v.optional(v.number()),
    // Check-level financials
    subtotalCents: v.number(),
    taxCents: v.optional(v.number()),
    tipCents: v.number(),
    totalCents: v.number(),
    discountCents: v.optional(v.number()),
    compCents: v.optional(v.number()),
    promoCents: v.optional(v.number()),
    // Guest + service context
    guestCount: v.optional(v.number()),
    revenueCenter: v.optional(v.string()),
    tenderType: v.optional(v.string()),
    // Menu items (embedded, keeps queries fast for item-mix analytics)
    menuItems: v.optional(v.array(v.object({
      name: v.string(),
      category: v.optional(v.string()),
      quantity: v.number(),
      priceCents: v.number(),
    }))),
    status: posCheckStatus,
    raw: v.optional(v.any()),
    updatedAt: v.number(),
  }).index('by_venue_openedAt', ['venueId', 'openedAt']).index('by_provider_external', ['provider', 'externalCheckId']).index('by_venue_provider_external', ['venueId', 'provider', 'externalCheckId']).index('by_guest', ['guestId']),
  // Labor punches from POS (Toast-style: one row per clock-in/out per employee).
  posLaborPunches: defineTable({
    venueId: v.id('venues'),
    provider: posProvider,
    externalEmployeeId: v.string(),
    employeeName: v.string(),
    jobTitle: v.optional(v.string()),
    clockInAt: v.number(),
    clockOutAt: v.optional(v.number()),
    regularMinutes: v.optional(v.number()),
    overtimeMinutes: v.optional(v.number()),
    declaredTipsCents: v.optional(v.number()),
    tipsCents: v.optional(v.number()),
    regularPayCents: v.optional(v.number()),
    overtimePayCents: v.optional(v.number()),
    totalPayCents: v.optional(v.number()),
    businessDate: v.string(),  // YYYY-MM-DD service date
    updatedAt: v.number(),
  })
    .index('by_venue_date', ['venueId', 'businessDate'])
    .index('by_venue_employee', ['venueId', 'externalEmployeeId']),
  payrollExports: defineTable({
    venueId: v.id('venues'),
    provider: v.union(v.literal('gusto'), v.literal('adp'), v.literal('paychex'), v.literal('csv')),
    periodStart: v.number(),
    periodEnd: v.number(),
    rowCount: v.number(),
    totalHours: v.number(),
    createdBy: v.id('profiles'),
    createdAt: v.number(),
  }).index('by_venue_createdAt', ['venueId', 'createdAt']),
  reservations: defineTable({
    venueId: v.id('venues'),
    guestId: v.optional(v.id('guests')),
    guestName: v.string(),
    guestPhone: v.optional(v.string()),
    guestEmail: v.optional(v.string()),
    guestCompany: v.optional(v.string()),
    partySize: v.number(),
    reservationTime: v.number(),
    durationMinutes: v.number(),
    source: externalReservationSource,
    status: reservationStatus,
    specialRequests: v.optional(v.string()),
    occasion: v.optional(v.string()),
    tags: v.array(v.string()),
    isPrivateEvent: v.optional(v.boolean()),
    eventName: v.optional(v.string()),
    eventStatus: v.optional(privateEventStatus),
    eventSpace: v.optional(v.string()),
    setupStyle: v.optional(v.string()),
    menuNotes: v.optional(v.string()),
    beverageNotes: v.optional(v.string()),
    billingNotes: v.optional(v.string()),
    contractStatus: v.optional(v.string()),
    beoStatus: v.optional(v.string()),
    estimatedValueCents: v.optional(v.number()),
    depositDueCents: v.optional(v.number()),
    externalId: v.optional(v.string()),
    toastCheckGuid: v.optional(v.string()),
    depositStatus: v.optional(v.string()),
    depositAmount: v.optional(v.number()),
    checkInAt: v.optional(v.number()),
    seatedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  }).index('by_venue_time', ['venueId', 'reservationTime']).index('by_venue_status', ['venueId', 'status']).index('by_guest', ['guestId']).index('by_external_id', ['externalId']).index('by_venue_external_id', ['venueId', 'externalId']),
  reservationConnections: defineTable({
    venueId: v.id('venues'),
    provider: reservationProvider,
    externalVenueId: v.optional(v.string()),
    status: integrationStatus,
    // Per-connection webhook secret (see posConnections.webhookSecret).
    webhookSecret: v.optional(v.string()),
    lastSyncAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_venue', ['venueId']).index('by_venue_and_provider', ['venueId', 'provider']),
  reservationSyncEvents: defineTable({
    venueId: v.id('venues'),
    provider: reservationProvider,
    externalEventId: v.string(),
    eventType: v.string(),
    reservationId: v.optional(v.id('reservations')),
    payload: v.any(),
    processedAt: v.number(),
    status: v.union(v.literal('processed'), v.literal('skipped'), v.literal('error')),
    errorMessage: v.optional(v.string()),
  }).index('by_provider_external_id', ['provider', 'externalEventId']).index('by_venue_provider_external_id', ['venueId', 'provider', 'externalEventId']).index('by_venue_processedAt', ['venueId', 'processedAt']),
  barInventoryItems: defineTable({
    venueId: v.id('venues'),
    name: v.string(),
    category: barStockCategory,
    area: v.optional(v.string()),
    unit: v.string(),
    parLevel: v.number(),
    onHand: v.number(),
    unitCostCents: v.optional(v.number()),
    supplier: v.optional(v.string()),
    sku: v.optional(v.string()),
    notes: v.optional(v.string()),
    lastCountedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_venue', ['venueId']).index('by_venue_category', ['venueId', 'category']).index('by_venue_name', ['venueId', 'name']),
  barInventoryMovements: defineTable({
    venueId: v.id('venues'),
    itemId: v.id('barInventoryItems'),
    movementType: barStockMovementType,
    quantity: v.number(),
    previousOnHand: v.number(),
    nextOnHand: v.number(),
    notes: v.optional(v.string()),
    createdBy: v.id('profiles'),
    createdAt: v.number(),
  }).index('by_venue_createdAt', ['venueId', 'createdAt']).index('by_item_createdAt', ['itemId', 'createdAt']),
  managerGoals: defineTable({
    venueId: v.id('venues'),
    title: v.string(),
    details: v.optional(v.string()),
    period: managerGoalPeriod,
    targetDate: v.string(),
    status: managerGoalStatus,
    createdBy: v.id('profiles'),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_venue_targetDate', ['venueId', 'targetDate']).index('by_venue_status', ['venueId', 'status']),
  venueEvents: defineTable({
    venueId: v.id('venues'),
    title: v.string(),
    startsAt: v.number(),
    endsAt: v.optional(v.number()),
    expectedGuests: v.optional(v.number()),
    notes: v.optional(v.string()),
    reservationId: v.optional(v.id('reservations')),
    createdBy: v.id('profiles'),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_venue_startsAt', ['venueId', 'startsAt']).index('by_reservation', ['reservationId']),
  reservationSettings: defineTable({
    venueId: v.id('venues'),
    defaultDiningMinutes: v.number(),
    defaultTurnMinutes: v.number(),
    bookingWindowDays: v.number(),
    minLeadHours: v.number(),
    updatedAt: v.number(),
  }).index('by_venue', ['venueId']),
  waitlist: defineTable({
    venueId: v.id('venues'),
    guestId: v.optional(v.id('guests')),
    guestName: v.string(),
    guestPhone: v.optional(v.string()),
    partySize: v.number(),
    source: v.union(v.literal('host'), v.literal('direct'), v.literal('walk_in')),
    status: waitlistStatus,
    requestedAt: v.number(),
    readyAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_venue_time', ['venueId', 'requestedAt']).index('by_venue_status', ['venueId', 'status']),
  tableAssignments: defineTable({
    venueId: v.id('venues'),
    reservationId: v.optional(v.id('reservations')),
    waitlistId: v.optional(v.id('waitlist')),
    tableId: v.id('tables'),
    holdType: assignmentHoldType,
    startsAt: v.number(),
    endsAt: v.number(),
    createdAt: v.number(),
    releasedAt: v.optional(v.number()),
    releasedReason: v.optional(v.string()),
  }).index('by_table_time', ['tableId', 'startsAt']).index('by_reservation', ['reservationId']).index('by_waitlist', ['waitlistId']).index('by_venue_time', ['venueId', 'startsAt']),
  floorPlans: defineTable({
    venueId: v.id('venues'),
    name: v.string(),
    width: v.number(),
    height: v.number(),
    backgroundImageUrl: v.union(v.string(), v.null()),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_venue', ['venueId']).index('by_venue_active', ['venueId', 'isActive']),
  floorChairs: defineTable({
    venueId: v.id('venues'),
    floorPlanId: v.id('floorPlans'),
    x: v.number(),
    y: v.number(),
    rotation: v.number(),
    label: v.optional(v.string()),
  }).index('by_floor_plan', ['floorPlanId']).index('by_venue', ['venueId']),
  tables: defineTable({
    floorPlanId: v.id('floorPlans'),
    label: v.string(),
    shape: tableShape,
    seats: v.number(),
    // How attached seat chairs are labeled: 1,2,3 / A,B,C / hidden.
    seatLabelStyle: v.optional(v.union(v.literal('number'), v.literal('letter'), v.literal('none'))),
    x: v.number(),
    y: v.number(),
    width: v.number(),
    height: v.number(),
    rotation: v.number(),
    section: tableSection,
    minSpend: v.number(),
    isReservable: v.boolean(),
  }).index('by_floor_plan', ['floorPlanId']).index('by_floor_plan_section', ['floorPlanId', 'section']),
  tableStates: defineTable({
    venueId: v.id('venues'),
    tableId: v.id('tables'),
    status: tableStatus,
    partySize: v.optional(v.number()),
    serverId: v.optional(v.id('profiles')),
    toastCheckGuid: v.optional(v.string()),
    seatedAt: v.optional(v.number()),
    lastActivityAt: v.number(),
    notes: v.optional(v.string()),
    // Tables merged for one big party share a group id; split clears it.
    mergeGroupId: v.optional(v.string()),
  }).index('by_table', ['tableId']).index('by_status', ['status']).index('by_server', ['serverId']).index('by_venue', ['venueId']).index('by_venue_merge_group', ['venueId', 'mergeGroupId']),
  tableStateHistory: defineTable({
    venueId: v.id('venues'),
    tableId: v.id('tables'),
    fromStatus: tableStatus,
    toStatus: tableStatus,
    actorId: v.optional(v.id('profiles')),
    partySize: v.optional(v.number()),
    timestamp: v.number(),
    metadata: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null()))),
  }).index('by_table_time', ['tableId', 'timestamp']).index('by_venue_time', ['venueId', 'timestamp']),
  subscriptions: defineTable({
    venueId: v.id('venues'),
    status: v.union(v.literal('trialing'), v.literal('active'), v.literal('past_due'), v.literal('cancelled'), v.literal('expired'), v.literal('paused')),
    platform: v.union(v.literal('stripe'), v.literal('apple'), v.null()),
    planId: v.string(),
    priceCents: v.number(),
    currency: v.string(),
    trialStartedAt: v.number(),
    trialEndsAt: v.number(),
    currentPeriodStart: v.union(v.number(), v.null()),
    currentPeriodEnd: v.union(v.number(), v.null()),
    cancelAtPeriodEnd: v.boolean(),
    cancelledAt: v.union(v.number(), v.null()),
    externalSubscriptionId: v.union(v.string(), v.null()),
    externalCustomerId: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
    dataRetentionWarnedAt: v.optional(v.number()),
    lastStripeEventAt: v.optional(v.number()),
    lastRevenueCatEventAt: v.optional(v.number()),
  }).index('by_venue', ['venueId']).index('by_status', ['status']).index('by_external_id', ['externalSubscriptionId']),
  subscriptionEvents: defineTable({
    venueId: v.id('venues'),
    source: v.union(v.literal('stripe'), v.literal('apple'), v.literal('internal')),
    externalEventId: v.string(),
    eventType: v.string(),
    payload: v.any(),
    processedAt: v.union(v.number(), v.null()),
    status: v.union(v.literal('pending'), v.literal('processed'), v.literal('skipped'), v.literal('error')),
    errorMessage: v.union(v.string(), v.null()),
  }).index('by_source_external_id', ['source', 'externalEventId']).index('by_venue_time', ['venueId', 'processedAt']),
  paymentMethods: defineTable({
    venueId: v.id('venues'),
    stripePaymentMethodId: v.string(),
    brand: v.string(),
    last4: v.string(),
    expMonth: v.number(),
    expYear: v.number(),
    isDefault: v.boolean(),
    createdAt: v.number(),
  }).index('by_venue', ['venueId']),
  invoices: defineTable({
    venueId: v.id('venues'),
    stripeInvoiceId: v.string(),
    amountCents: v.number(),
    currency: v.string(),
    status: v.union(v.literal('draft'), v.literal('open'), v.literal('paid'), v.literal('void'), v.literal('uncollectible')),
    invoiceUrl: v.union(v.string(), v.null()),
    hostedInvoiceUrl: v.union(v.string(), v.null()),
    periodStart: v.number(),
    periodEnd: v.number(),
    createdAt: v.number(),
    paidAt: v.union(v.number(), v.null()),
  }).index('by_venue_time', ['venueId', 'createdAt']).index('by_stripe_id', ['stripeInvoiceId']),

  invites: defineTable({
    venueId: v.id('venues'),
    token: v.string(),
    role,
    jobTitle: v.string(),
    createdBy: v.id('profiles'),
    usedBy: v.optional(v.id('profiles')),
    expiresAt: v.number(),
    createdAt: v.number(),
  }).index('by_token', ['token']).index('by_venue', ['venueId']),

  // AI-generated "Cosmic Insights" for the dashboard. A cron regenerates a
  // fresh batch every 8 hours; the dashboard shows the latest batch.
  cosmicInsights: defineTable({
    kind: v.string(),
    title: v.string(),
    body: v.string(),
    batchAt: v.number(),
  }).index('by_batchAt', ['batchAt']),
});
