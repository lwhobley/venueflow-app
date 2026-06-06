#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const prisma = new PrismaClient();

const tableMap = {
  users: { delegate: 'user', fields: ['id', 'email', 'phone', 'createdAt'] },
  venues: { delegate: 'venue' },
  profiles: { delegate: 'profile' },
  venueRoles: { delegate: 'venueRole' },
  teams: { delegate: 'team' },
  scheduleShifts: { delegate: 'scheduleShift' },
  scheduleTemplates: { delegate: 'scheduleTemplate' },
  shiftSwaps: { delegate: 'shiftSwap' },
  availability: { delegate: 'availability' },
  conversations: { delegate: 'conversation' },
  messages: { delegate: 'message' },
  notificationEvents: { delegate: 'notificationEvent', omit: ['readBy'] },
  notificationReads: { delegate: 'notificationRead' },
  scheduleEmailEvents: { delegate: 'scheduleEmailEvent' },
  pushTokens: { delegate: 'pushToken' },
  blackoutDates: { delegate: 'blackoutDate' },
  timeEntries: { delegate: 'timeEntry' },
  staffRequests: { delegate: 'staffRequest' },
  guests: { delegate: 'guest' },
  posConnections: { delegate: 'posConnection' },
  posChecks: { delegate: 'posCheck' },
  posLaborPunches: { delegate: 'posLaborPunch' },
  payrollExports: { delegate: 'payrollExport' },
  reservations: { delegate: 'reservation' },
  reservationConnections: { delegate: 'reservationConnection' },
  reservationSyncEvents: { delegate: 'reservationSyncEvent' },
  barInventoryItems: { delegate: 'barInventoryItem' },
  barInventoryMovements: { delegate: 'barInventoryMovement' },
  managerGoals: { delegate: 'managerGoal' },
  venueEvents: { delegate: 'venueEvent' },
  reservationSettings: { delegate: 'reservationSetting' },
  waitlist: { delegate: 'waitlist' },
  tableAssignments: { delegate: 'tableAssignment' },
  floorPlans: { delegate: 'floorPlan' },
  floorChairs: { delegate: 'floorChair' },
  tables: { delegate: 'floorTable' },
  tableStates: { delegate: 'tableState' },
  tableStateHistory: { delegate: 'tableStateHistory' },
  subscriptions: { delegate: 'subscription' },
  subscriptionEvents: { delegate: 'subscriptionEvent' },
  paymentMethods: { delegate: 'paymentMethod' },
  invoices: { delegate: 'invoice' },
  invites: { delegate: 'invite' },
  crmLeads: { delegate: 'crmLead' },
  crmNotes: { delegate: 'crmNote' },
  crmBeos: { delegate: 'crmBeo' },
  crmContracts: { delegate: 'crmContract' },
  crmActivityLog: { delegate: 'crmActivityLog' },
  cosmicInsights: { delegate: 'cosmicInsight' },
};

const importOrder = [
  'users',
  'venues',
  'profiles',
  'venueRoles',
  'teams',
  'floorPlans',
  'tables',
  'floorChairs',
  'tableStates',
  'guests',
  'scheduleShifts',
  'scheduleTemplates',
  'availability',
  'blackoutDates',
  'staffRequests',
  'shiftSwaps',
  'conversations',
  'messages',
  'notificationEvents',
  'notificationReads',
  'scheduleEmailEvents',
  'pushTokens',
  'timeEntries',
  'reservations',
  'waitlist',
  'tableAssignments',
  'tableStateHistory',
  'posConnections',
  'posChecks',
  'posLaborPunches',
  'payrollExports',
  'reservationConnections',
  'reservationSyncEvents',
  'barInventoryItems',
  'barInventoryMovements',
  'managerGoals',
  'venueEvents',
  'reservationSettings',
  'subscriptions',
  'subscriptionEvents',
  'paymentMethods',
  'invoices',
  'invites',
  'crmLeads',
  'crmNotes',
  'crmBeos',
  'crmContracts',
  'crmActivityLog',
  'cosmicInsights',
];

const dateFields = new Set([
  'createdAt',
  'updatedAt',
  'trialEndsAt',
  'schedulePublishedAt',
  'scheduleUpdatedAfterPublishAt',
  'lastMessageAt',
  'lastSeenAt',
  'readAt',
  'clockInAt',
  'clockOutAt',
  'reviewedAt',
  'deletedAt',
  'openedAt',
  'closedAt',
  'lastSyncAt',
  'businessDate',
  'reservationTime',
  'depositDueDate',
  'checkInAt',
  'seatedAt',
  'completedAt',
  'readyAt',
  'requestedAt',
  'startsAt',
  'endsAt',
  'releasedAt',
  'timestamp',
  'periodStart',
  'periodEnd',
  'processedAt',
  'lastActivityAt',
  'lastCountedAt',
  'completedAt',
  'targetDate',
  'expiresAt',
  'eventDate',
  'contractDate',
  'clientSignatureDate',
  'trialStartedAt',
  'trialEndsAt',
  'currentPeriodStart',
  'currentPeriodEnd',
  'cancelledAt',
  'dataRetentionWarnedAt',
  'lastStripeEventAt',
  'lastRevenueCatEventAt',
  'paidAt',
  'sentAt',
  'batchAt',
]);

const textDateFields = new Set(['businessDate', 'targetDate']);

const createdAtTables = new Set([
  'users',
  'venues',
  'profiles',
  'scheduleShifts',
  'blackoutDates',
  'scheduleTemplates',
  'staffRequests',
  'messages',
  'notificationEvents',
  'pushTokens',
  'timeEntries',
  'shiftSwaps',
  'guests',
  'reservations',
  'waitlist',
  'floorPlans',
  'tableAssignments',
  'posConnections',
  'crmLeads',
  'crmNotes',
  'crmBeos',
  'crmContracts',
  'subscriptions',
  'paymentMethods',
  'invoices',
  'scheduleEmailEvents',
  'payrollExports',
  'reservationConnections',
  'barInventoryItems',
  'barInventoryMovements',
  'managerGoals',
  'venueEvents',
  'invites',
  'crmActivityLog',
]);

function usage() {
  console.error('Usage: node packages/api/scripts/import-convex-export.mjs <convex-export-dir> [--dry-run]');
  process.exit(1);
}

function loadRows(exportDir, table) {
  const jsonPath = join(exportDir, `${table}.json`);
  const jsonlPath = join(exportDir, `${table}.jsonl`);
  const nestedJsonlPath = join(exportDir, table, 'documents.jsonl');
  const nestedJsonPath = join(exportDir, table, 'documents.json');
  if (existsSync(jsonPath)) {
    const parsed = JSON.parse(readFileSync(jsonPath, 'utf8'));
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.documents)) return parsed.documents;
    if (Array.isArray(parsed.data)) return parsed.data;
    throw new Error(`${jsonPath} must contain an array, documents array, or data array`);
  }
  if (existsSync(jsonlPath)) {
    return readFileSync(jsonlPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  if (existsSync(nestedJsonPath)) {
    const parsed = JSON.parse(readFileSync(nestedJsonPath, 'utf8'));
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.documents)) return parsed.documents;
    if (Array.isArray(parsed.data)) return parsed.data;
    throw new Error(`${nestedJsonPath} must contain an array, documents array, or data array`);
  }
  if (existsSync(nestedJsonlPath)) {
    return readFileSync(nestedJsonlPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  return [];
}

function toDate(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  return new Date(value);
}

function normalizeRow(table, source, config) {
  const row = { ...source };
  row.id = row.id ?? row._id;
  delete row._id;
  const creationTime = row._creationTime;
  delete row._creationTime;

  for (const field of config.omit ?? []) {
    delete row[field];
  }

  if (createdAtTables.has(table) && !row.createdAt && creationTime) row.createdAt = creationTime;
  if ('updatedAt' in row === false && needsUpdatedAt(table)) row.updatedAt = row.createdAt ?? creationTime ?? Date.now();

  for (const [field, value] of Object.entries(row)) {
    if (value === undefined) delete row[field];
    if (!dateFields.has(field) || textDateFields.has(field) || value === null || value === undefined) continue;
    row[field] = toDate(value);
  }

  if (config.fields) {
    for (const field of Object.keys(row)) {
      if (!config.fields.includes(field)) delete row[field];
    }
  }

  return row;
}

function needsUpdatedAt(table) {
  return [
    'venues',
    'profiles',
    'scheduleShifts',
    'availability',
    'staffRequests',
    'pushTokens',
    'guests',
    'reservations',
    'waitlist',
    'floorPlans',
    'tableStates',
    'posConnections',
    'posChecks',
    'posLaborPunches',
    'crmLeads',
    'crmBeos',
    'crmContracts',
    'subscriptions',
    'reservationConnections',
    'barInventoryItems',
    'managerGoals',
    'venueEvents',
    'reservationSettings',
  ].includes(table);
}

async function upsertRows(table, rows, dryRun) {
  const config = tableMap[table];
  const delegate = prisma[config.delegate];
  if (!delegate) throw new Error(`Prisma delegate ${config.delegate} is not available`);

  const normalized = rows.map((row) => normalizeRow(table, row, config));
  if (dryRun) return normalized.length;

  for (const row of normalized) {
    if (!row.id) throw new Error(`${table} row is missing _id/id`);
    const update = { ...row };
    delete update.id;
    await delegate.upsert({
      where: { id: row.id },
      update,
      create: row,
    });
  }
  return normalized.length;
}

async function ensureUsersFromProfiles(profileRows, dryRun) {
  const userRows = profileRows
    .filter((row) => row.userId)
    .map((row) => ({
      id: row.userId,
      email: row.email ?? null,
      createdAt: toDate(row._creationTime ?? Date.now()),
    }));
  const unique = new Map(userRows.map((row) => [row.id, row]));
  if (dryRun || unique.size === 0) return unique.size;
  for (const row of unique.values()) {
    await prisma.user.upsert({
      where: { id: row.id },
      update: { email: row.email },
      create: row,
    });
  }
  return unique.size;
}

const exportDir = process.argv[2] ? resolve(process.argv[2]) : null;
const dryRun = process.argv.includes('--dry-run');
if (!exportDir) usage();

try {
  let total = 0;
  for (const table of importOrder) {
    const rows = loadRows(exportDir, table);
    if (rows.length === 0) continue;
    if (table === 'profiles' && loadRows(exportDir, 'users').length === 0) {
      const stubbed = await ensureUsersFromProfiles(rows, dryRun);
      if (stubbed > 0) console.log(`${dryRun ? 'Validated' : 'Upserted'} ${stubbed} profile user stubs`);
    }
    const count = await upsertRows(table, rows, dryRun);
    total += count;
    console.log(`${dryRun ? 'Validated' : 'Imported'} ${count} ${table}`);
  }
  console.log(`${dryRun ? 'Dry run complete' : 'Import complete'}: ${total} rows`);
} finally {
  await prisma.$disconnect();
}
