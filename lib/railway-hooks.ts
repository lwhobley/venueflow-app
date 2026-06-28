import { useCallback } from 'react';
import { useMutation as useReactMutation, useQuery as useReactQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import type { RailwayFunctionRef } from './railway-api';

type QueryArgs = Record<string, unknown> | 'skip' | undefined;
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/* eslint-disable @typescript-eslint/no-explicit-any -- route fns are type-erased by design */
type Route = {
  path: string | ((args: any) => string);
  method?: Method;
  body?: (args: any) => any;
  invalidate?: unknown[][];
};

const queryRoutes: Record<string, Route> = {
  'app.getMe': { path: '/v1/app/me' },
  'app.getDashboard': { path: '/v1/app/dashboard' },
  'app.getNotifications': { path: '/v1/app/notifications' },
  'app.getClockBoard': { path: '/v1/app/clock-board' },
  'app.getMyTimeClock': { path: '/v1/app/time-clock' },
  'app.getMyVenueBilling': { path: '/v1/app/billing' },
  'app.listVenueStaff': { path: '/v1/app/staff' },
  'app.listStaffRequests': { path: '/v1/staff-requests' },
  'app.getManagerInsights': { path: '/v1/app/manager-insights' },
  'app.exportTimeEntriesCsv': { path: '/v1/app/time-entries/csv' },
  'staffAuth.listVenueRoles': { path: '/v1/app/venue-roles' },
  'scheduling.getMyAvailability': { path: '/v1/scheduling/availability/me' },
  'scheduling.getAvailabilitySettings': { path: '/v1/scheduling/availability/settings' },
  'scheduling.listBlackouts': { path: '/v1/scheduling/blackouts' },
  'scheduling.getManagerSchedule': { path: '/v1/scheduling/manager' },
  'scheduling.getLaborForecast': { path: '/v1/scheduling/labor-forecast' },
  'scheduling.previewAutoSchedule': { path: (args) => `/v1/scheduling/auto-schedule/preview?weekStartDate=${encodeURIComponent(args.weekStartDate ?? '')}` },
  'scheduling.listScheduleTemplates': { path: '/v1/scheduling/templates' },
  'scheduling.getMySchedule': { path: '/v1/scheduling/me' },
  'scheduling.getMyShiftSwaps': { path: '/v1/scheduling/swaps/me' },
  'scheduling.listShiftSwaps': { path: '/v1/scheduling/swaps' },
  'pos.getPosOverview': { path: '/v1/pos/overview' },
  'pos.getSalesSummaryDashboard': { path: (args) => `/v1/pos/sales/summary?windowDays=${args.windowDays ?? 7}${args.startTs ? `&startTs=${args.startTs}` : ''}${args.endTs ? `&endTs=${args.endTs}` : ''}` },
  'pos.getSalesByServer': { path: (args) => `/v1/pos/sales/by-server?windowDays=${args.windowDays ?? 7}${args.startTs ? `&startTs=${args.startTs}` : ''}${args.endTs ? `&endTs=${args.endTs}` : ''}` },
  'pos.getTopMenuItems': { path: (args) => `/v1/pos/sales/top-items?windowDays=${args.windowDays ?? 7}&limit=${args.limit ?? 30}${args.startTs ? `&startTs=${args.startTs}` : ''}${args.endTs ? `&endTs=${args.endTs}` : ''}` },
  'pos.getLaborSummary': { path: (args) => `/v1/pos/labor?windowDays=${args.windowDays ?? 7}${args.startTs ? `&startTs=${args.startTs}` : ''}${args.endTs ? `&endTs=${args.endTs}` : ''}` },
  'operations.getManagerDashboard': { path: '/v1/operations/manager-dashboard' },
  'reservations.getReservationsPage': { path: '/v1/reservations' },
  'reservations.exportReservationsCsv': { path: '/v1/reservations/export-csv' },
  'payroll.getPayrollSummary': { path: (args) => `/v1/payroll/summary${args.startDate ? `?startDate=${args.startDate}&endDate=${args.endDate ?? ''}` : ''}` },
  'payroll.exportPayrollCsv': { path: (args) => `/v1/payroll/export-csv${args.startDate ? `?startDate=${args.startDate}&endDate=${args.endDate ?? ''}` : ''}` },
  'barInventory.getBarStock': { path: '/v1/bar-inventory' },
  'barInventory.getUsageVelocity': { path: '/v1/bar-inventory/velocity' },
  'barInventory.getItemMovements': { path: (args) => `/v1/bar-inventory/${args.itemId}/movements?limit=${args.limit ?? 50}` },
  'barInventory.exportStockCsv': { path: '/v1/bar-inventory/export-csv' },
  'barInventory.exportMovementsCsv': { path: '/v1/bar-inventory/movements/export-csv' },
  'barInventory.getShrinkageReport': { path: '/v1/bar-inventory/shrinkage' },
  'barInventory.getPurchaseOrder': { path: '/v1/bar-inventory/purchase-order' },
  'barInventory.exportPurchaseOrderCsv': { path: '/v1/bar-inventory/purchase-order/export-csv' },
  'barInventory.getCostHistory': { path: (args) => `/v1/bar-inventory/cost-history/${args.itemId}` },
  'barInventory.getAgingReport': { path: '/v1/bar-inventory/aging' },
  'cosmicInsights.getLatestInsights': { path: '/v1/insights' },
  'floor.getActiveFloorPlan': { path: '/v1/floor/active' },
  'floor.getFloorStats': { path: '/v1/floor/stats' },
  'floorBinding.getActiveFloorPlan': { path: '/v1/floor/active' },
  'floorBinding.getUnassignedReservations': { path: (args) => `/v1/floor/unassigned-reservations?withinMinutes=${args.withinMinutes ?? 120}` },
  'floorBinding.getOpenWaitlist': { path: '/v1/floor/waitlist' },
  'chat.listConversations': { path: '/v1/chat/conversations' },
  'chat.listDirectory': { path: '/v1/chat/directory' },
  'chat.getMessages': { path: (args) => `/v1/chat/conversations/${args.conversationId}/messages` },
  'guests.listGuests': {
    path: (args) =>
      `/v1/guests?page=${args.page ?? 0}&limit=${args.limit ?? 100}${args.search ? `&q=${encodeURIComponent(args.search)}` : ''}`,
  },
  'guests.getGuestProfile': { path: (args) => `/v1/guests/${args.guestId}` },
  'crm.listLeads': {
    path: (args) =>
      `/v1/crm/leads?page=${args.page ?? 0}&limit=${args.limit ?? 100}${args.search ? `&search=${encodeURIComponent(args.search)}` : ''}`,
  },
  'crm.listBeos': { path: (args) => `/v1/crm/beos?page=${args.page ?? 0}&limit=${args.limit ?? 100}` },
  'crm.listContracts': { path: (args) => `/v1/crm/contracts?page=${args.page ?? 0}&limit=${args.limit ?? 100}` },
  'crm.getLead': { path: (args) => `/v1/crm/leads/${args.leadId}` },
  'crm.getForecast': { path: '/v1/crm/forecast' },
  'crm.getSourceRoi': { path: '/v1/crm/source-roi' },
  'crm.getStaleLeads': { path: (args) => `/v1/crm/stale-leads${args?.days ? `?days=${args.days}` : ''}` },
  'crm.getLeadActivity': { path: (args) => `/v1/crm/leads/${args.leadId}/activity` },
  'crm.listTemplates': { path: '/v1/crm/templates' },
  'reservations.getCoverPacing': { path: (args) => `/v1/reservations/cover-pacing?date=${encodeURIComponent(args.date)}` },
  'reservations.guestAutofill': {
    path: (args) =>
      `/v1/reservations/guest-autofill${args?.email ? `?email=${encodeURIComponent(args.email)}` : args?.phone ? `?phone=${encodeURIComponent(args.phone)}` : ''}`,
  },
  'reservations.listHolds': { path: '/v1/reservations/holds' },
  'reservationIntegrations.getReservationIntegrationOverview': { path: '/v1/integrations/reservations' },
};

const mutationRoutes: Record<string, Route> = {
  'app.markNotificationRead': {
    path: (args) => `/v1/app/notifications/${args.notificationId ?? args.id ?? args}/read`,
    method: 'POST',
    invalidate: [['app', 'getNotifications']],
  },
  'app.updateVenue': {
    path: '/v1/app/venue',
    method: 'PATCH',
    body: ({ name, latitude, longitude, geofenceRadiusM }) => ({ name, latitude, longitude, geofenceRadiusM }),
    invalidate: [['app', 'getMe'], ['app', 'getDashboard']],
  },
  'app.deleteMyAccount': { path: '/v1/app/me', method: 'DELETE' },
  'app.clockIn': { path: '/v1/app/clock-in', method: 'POST', body: locationBody, invalidate: clockInvalidations() },
  'app.clockOut': { path: '/v1/app/clock-out', method: 'POST', body: locationBody, invalidate: clockInvalidations() },
  'app.breakStart': { path: '/v1/app/time-clock/break-start', method: 'POST', body: (args) => ({ type: args.type }), invalidate: clockInvalidations() },
  'app.breakEnd': { path: '/v1/app/time-clock/break-end', method: 'POST', body: () => ({}), invalidate: clockInvalidations() },
  'app.upsertVenueStaff': {
    path: '/v1/app/staff',
    method: 'POST',
    body: ({ venueId, staffId, email, fullName, role, jobTitle, phone, altPhone, address, dateOfBirth, certifications }) => ({ venueId, staffId, email, fullName, role, jobTitle, phone, altPhone, address, dateOfBirth, certifications }),
    invalidate: [['app', 'listVenueStaff'], ['app', 'getDashboard']],
  },
  'app.deactivateVenueStaff': {
    path: (args) => `/v1/app/staff/${args.staffId ?? args.id ?? args}`,
    method: 'DELETE',
    invalidate: [['app', 'listVenueStaff'], ['app', 'getDashboard']],
  },
  'staffAuth.addVenueRole': {
    path: '/v1/app/venue-roles',
    method: 'POST',
    body: ({ name }) => ({ name }),
    invalidate: [['staffAuth.listVenueRoles']],
  },
  'staffAuth.removeVenueRole': {
    path: (args) => `/v1/app/venue-roles/${args.roleId ?? args.id ?? args}`,
    method: 'DELETE',
    invalidate: [['staffAuth.listVenueRoles']],
  },
  'invites.createInvite': {
    path: '/v1/app/invites',
    method: 'POST',
    body: ({ role, jobTitle }) => ({ role, jobTitle }),
  },
  'app.createStaffRequest': {
    path: '/v1/staff-requests',
    method: 'POST',
    body: stripVenue,
    invalidate: [['app', 'listStaffRequests'], ['staffRequests', 'list']],
  },
  'app.reviewStaffRequest': {
    path: (args) => `/v1/staff-requests/${args.requestId ?? args.id}`,
    method: 'PATCH',
    body: ({ status, responseNotes }) => ({ status, responseNotes }),
    invalidate: [['app', 'listStaffRequests'], ['staffRequests', 'list']],
  },
  'scheduling.setMyAvailability': {
    path: '/v1/scheduling/availability/me',
    method: 'POST',
    body: (args) => ({ weekStart: args.weekStart, rows: args.rows ?? args.availability ?? [] }),
    invalidate: [['scheduling', 'getMyAvailability'], ['scheduling', 'getManagerSchedule']],
  },
  'scheduling.updateAvailabilitySettings': {
    path: '/v1/scheduling/availability/settings',
    method: 'PATCH',
    body: ({ anchor, lengthDays, availabilityUnlocked }) => ({ anchor, lengthDays, availabilityUnlocked }),
    invalidate: [['scheduling', 'getAvailabilitySettings'], ['scheduling', 'getMyAvailability'], ['scheduling', 'getManagerSchedule']],
  },
  'scheduling.addBlackout': {
    path: '/v1/scheduling/blackouts',
    method: 'POST',
    body: stripVenue,
    invalidate: [['scheduling', 'listBlackouts']],
  },
  'scheduling.removeBlackout': {
    path: (args) => `/v1/scheduling/blackouts/${args.blackoutId ?? args.id ?? args}`,
    method: 'DELETE',
    invalidate: [['scheduling', 'listBlackouts']],
  },
  'scheduling.createShift': {
    path: '/v1/scheduling/shifts',
    method: 'POST',
    body: stripVenue,
    invalidate: scheduleInvalidations(),
  },
  'scheduling.updateShift': {
    path: (args) => `/v1/scheduling/shifts/${args.shiftId ?? args.id}`,
    method: 'PATCH',
    body: stripVenueAndIds,
    invalidate: scheduleInvalidations(),
  },
  'scheduling.assignShift': {
    path: (args) => `/v1/scheduling/shifts/${args.shiftId ?? args.id}/assign`,
    method: 'PATCH',
    body: ({ profileId }) => ({ profileId }),
    invalidate: scheduleInvalidations(),
  },
  'scheduling.unassignShift': {
    path: (args) => `/v1/scheduling/shifts/${args.shiftId ?? args.id}/assign`,
    method: 'PATCH',
    body: () => ({ profileId: undefined }),
    invalidate: scheduleInvalidations(),
  },
  'scheduling.deleteShift': {
    path: (args) => `/v1/scheduling/shifts/${args.shiftId ?? args.id ?? args}`,
    method: 'DELETE',
    invalidate: scheduleInvalidations(),
  },
  'scheduling.publishSchedule': { path: '/v1/scheduling/publish', method: 'POST', body: () => ({}), invalidate: scheduleInvalidations() },
  'scheduling.setLaborBudget': {
    path: '/v1/scheduling/labor-budget',
    method: 'PATCH',
    body: ({ weeklyLaborBudgetHours }) => ({ weeklyLaborBudgetHours }),
    invalidate: scheduleInvalidations(),
  },
  'scheduling.saveScheduleTemplate': {
    path: '/v1/scheduling/templates',
    method: 'POST',
    body: ({ name }) => ({ name }),
    invalidate: [['scheduling', 'listScheduleTemplates']],
  },
  'scheduling.applyScheduleTemplate': {
    path: (args) => `/v1/scheduling/templates/${args.templateId ?? args.id}/apply`,
    method: 'POST',
    body: ({ replace }) => ({ replace }),
    invalidate: scheduleInvalidations(),
  },
  'scheduling.deleteScheduleTemplate': {
    path: (args) => `/v1/scheduling/templates/${args.templateId ?? args.id ?? args}`,
    method: 'DELETE',
    invalidate: [['scheduling', 'listScheduleTemplates']],
  },
  'scheduling.copyDayShifts': { path: '/v1/scheduling/copy-day', method: 'POST', body: stripVenue, invalidate: scheduleInvalidations() },
  'scheduling.clearWeek': { path: '/v1/scheduling/clear-week', method: 'POST', body: () => ({}), invalidate: scheduleInvalidations() },
  'scheduling.restoreShifts': { path: '/v1/scheduling/restore-shifts', method: 'POST', body: ({ shifts }) => ({ shifts }), invalidate: scheduleInvalidations() },
  'scheduling.applyAutoSchedule': {
    path: '/v1/scheduling/auto-schedule/apply',
    method: 'POST',
    body: ({ assignments, weekStartDate }) => ({ assignments, weekStartDate }),
    invalidate: scheduleInvalidations(),
  },
  'scheduling.claimOpenShift': {
    path: (args) => `/v1/scheduling/shifts/${args.shiftId ?? args.id}/claim`,
    method: 'POST',
    body: () => ({}),
    invalidate: scheduleInvalidations(),
  },
  'scheduling.requestDropShift': {
    path: '/v1/staff-requests',
    method: 'POST',
    body: ({ shiftId }) => ({
      kind: 'drop_shift',
      title: 'Drop shift request',
      details: 'Requesting manager approval to drop this assigned shift.',
      requestedShiftId: shiftId,
    }),
    invalidate: [['app', 'listStaffRequests'], ...scheduleInvalidations()],
  },
  'scheduling.proposeShiftSwap': { path: '/v1/scheduling/swaps', method: 'POST', body: stripVenue, invalidate: scheduleInvalidations() },
  'scheduling.respondToShiftSwap': {
    path: (args) => `/v1/scheduling/swaps/${args.swapId ?? args.id}/respond`,
    method: 'PATCH',
    body: ({ accept }) => ({ accept }),
    invalidate: scheduleInvalidations(),
  },
  'scheduling.reviewShiftSwap': {
    path: (args) => `/v1/scheduling/swaps/${args.swapId ?? args.id}/review`,
    method: 'PATCH',
    body: ({ approve }) => ({ approve }),
    invalidate: scheduleInvalidations(),
  },
  'pos.upsertPosConnection': { path: '/v1/pos/connections', method: 'POST', body: ({ provider, externalLocationId, status }) => ({ provider, externalLocationId, status }) },
  'reservationIntegrations.upsertReservationConnection': { path: '/v1/integrations/reservations', method: 'POST', body: stripVenue },
  'guests.rotateLeadsWebhookSecret': { path: '/v1/guests/rotate-webhook-secret', method: 'POST', body: () => ({}), invalidate: [['guests', 'list']] },
  'operations.upsertManagerGoal': { path: '/v1/operations/manager-goal', method: 'PATCH', body: stripVenue, invalidate: [['operations', 'dashboard']] },
  'barInventory.upsertBarItem': { path: '/v1/bar-inventory', method: 'POST', body: stripVenue, invalidate: [['barInventory', 'stock']] },
  'barInventory.recordBarStockMovement': { path: (args) => `/v1/bar-inventory/${args.itemId}/movement`, method: 'POST', body: ({ movementType, quantity, notes }) => ({ movementType, quantity, notes }), invalidate: [['barInventory', 'stock']] },
  'barInventory.importParsedBarItems': { path: '/v1/bar-inventory/import', method: 'POST', body: ({ items }) => ({ items }), invalidate: [['barInventory', 'stock']] },
  'barInventory.parseBarInventoryInput': { path: '/v1/bar-inventory/parse', method: 'POST', body: ({ text, imageBase64, imageMimeType }) => ({ text, imageBase64, imageMimeType }) },
  'barInventory.updateItemCost': { path: (args) => `/v1/bar-inventory/${args.itemId}/cost`, method: 'PATCH', body: ({ unitCostCents }) => ({ unitCostCents }), invalidate: [['barInventory', 'stock']] },
  'barInventory.lookupBySku': { path: (args) => `/v1/bar-inventory/sku/${encodeURIComponent(args.sku)}`, method: 'GET' },
  'barInventory.sendPurchaseOrderEmail': { path: '/v1/bar-inventory/purchase-order/send-email', method: 'POST', body: () => ({}) },
  'barInventory.sendInventoryDigest': { path: '/v1/bar-inventory/send-digest', method: 'POST', body: () => ({}) },
  'chat.ensureChatSetup': { path: '/v1/chat/setup', method: 'POST', body: () => ({}), invalidate: [['chat', 'conversations']] },
  'chat.openDm': { path: '/v1/chat/dm', method: 'POST', body: ({ targetProfileId }) => ({ targetProfileId }), invalidate: [['chat', 'conversations']] },
  'chat.createGroup': { path: '/v1/chat/group', method: 'POST', body: ({ name, memberIds }) => ({ name, memberIds }), invalidate: [['chat', 'conversations']] },
  'chat.deleteConversation': { path: (args) => `/v1/chat/conversations/${args.conversationId ?? args.id ?? args}`, method: 'DELETE', invalidate: [['chat', 'conversations']] },
  'chat.sendMessage': { path: (args) => `/v1/chat/conversations/${args.conversationId}/messages`, method: 'POST', body: (args) => ({ text: args.text, shiftId: args.shiftId, swapId: args.swapId, imageUrl: args.imageUrl }), invalidate: [['chat', 'getMessages']] },
  'chat.toggleReaction': { path: (args) => `/v1/chat/messages/${args.messageId}/react`, method: 'POST', body: ({ emoji }) => ({ emoji }), invalidate: [['chat', 'getMessages']] },
  'chat.editMessage': { path: (args) => `/v1/chat/messages/${args.messageId}`, method: 'PATCH', body: ({ text }) => ({ text }), invalidate: [['chat', 'getMessages']] },
  'chat.uploadImage': { path: '/v1/chat/images', method: 'POST', body: ({ dataBase64, mimeType }) => ({ dataBase64, mimeType }) },
  'floor.saveFloorPlan': { path: '/v1/floor', method: 'POST', body: ({ tables }) => ({ tables }), invalidate: [['floor', 'active'], ['floor', 'stats']] },
  'floor.clearActiveFloorPlan': { path: '/v1/floor', method: 'DELETE', invalidate: [['floor', 'active'], ['floor', 'stats']] },
  'tables.markDirty': { path: (args) => `/v1/floor/tables/${args.tableId ?? args.id ?? args}/status`, method: 'PATCH', body: () => ({ status: 'dirty' }), invalidate: [['floor', 'active'], ['floor', 'stats']] },
  'tables.markClean': { path: (args) => `/v1/floor/tables/${args.tableId ?? args.id ?? args}/status`, method: 'PATCH', body: () => ({ status: 'available' }), invalidate: [['floor', 'active'], ['floor', 'stats']] },
  'tables.mergeTablesForParty': { path: '/v1/floor/tables/merge', method: 'POST', body: stripVenue, invalidate: [['floor', 'active']] },
  'tables.splitMergedTables': { path: (args) => `/v1/floor/tables/${args.tableId}/split`, method: 'POST', body: () => ({}), invalidate: [['floor', 'active']] },
  'floorBinding.releaseAssignment': { path: (args) => `/v1/floor/assignments/${args.tableId ?? args.id ?? args}`, method: 'DELETE', invalidate: [['floor', 'active'], ['floor', 'stats']] },
  'floorBinding.assignReservationToTables': { path: '/v1/floor/assign-reservation', method: 'POST', body: ({ reservationId, tableIds }) => ({ reservationId, tableIds }), invalidate: [['floor', 'active']] },
  'floorBinding.addToWaitlist': { path: '/v1/floor/waitlist', method: 'POST', body: ({ guestName, partySize, phone, notes }) => ({ guestName, partySize, phone, notes }), invalidate: [['floor', 'waitlist']] },
  'floorBinding.markWaitlistReady': { path: (args) => `/v1/floor/waitlist/${args.waitlistId ?? args.id ?? args}/ready`, method: 'PATCH', body: () => ({}), invalidate: [['floor', 'waitlist']] },
  'floorBinding.removeFromWaitlist': { path: (args) => `/v1/floor/waitlist/${args.waitlistId ?? args.id ?? args}`, method: 'DELETE', invalidate: [['floor', 'waitlist']] },
  'floorBinding.assignWaitlistToTables': { path: '/v1/floor/assign-waitlist', method: 'POST', body: ({ waitlistId, tableIds }) => ({ waitlistId, tableIds }), invalidate: [['floor', 'active'], ['floor', 'waitlist']] },
  'guests.upsertGuest': { path: '/v1/guests', method: 'POST', body: stripVenue, invalidate: [['guests', 'list']] },
  'guests.ingestLeads': { path: '/v1/guests/ingest-leads', method: 'POST', body: ({ leads }) => ({ leads }), invalidate: [['guests', 'list']] },
  'guests.removeGuest': { path: (args) => `/v1/guests/${args.guestId ?? args.id ?? args}`, method: 'DELETE', invalidate: [['guests', 'list']] },
  'crm.saveLead': { path: '/v1/crm/leads', method: 'POST', body: stripVenue, invalidate: [['crm', 'leads']] },
  'crm.saveBeo': { path: '/v1/crm/beos', method: 'POST', body: stripVenue, invalidate: [['crm', 'beos']] },
  'crm.saveContract': { path: '/v1/crm/contracts', method: 'POST', body: stripVenue, invalidate: [['crm', 'contracts']] },
  'crm.convertBeoToContract': { path: (args) => `/v1/crm/beos/${args.beoId ?? args.id}/convert`, method: 'POST', body: () => ({}), invalidate: [['crm', 'beos'], ['crm', 'contracts']] },
  'crm.addNote': { path: (args) => `/v1/crm/leads/${args.leadId}/notes`, method: 'POST', body: ({ text }) => ({ text }), invalidate: [['crm', 'leads']] },
  'crm.emailBeo': {
    path: (args) => `/v1/crm/beos/${args.beoId}/email`,
    method: 'POST',
    body: ({ toEmail, message }) => ({ toEmail, message }),
    invalidate: [['crm', 'beos']],
  },
  'crm.saveTemplate': {
    path: '/v1/crm/templates',
    method: 'POST',
    body: stripVenue,
    invalidate: [['crm', 'templates']],
  },
  'crm.deleteTemplate': {
    path: (args) => `/v1/crm/templates/${args.templateId}`,
    method: 'DELETE',
    body: () => ({}),
    invalidate: [['crm', 'templates']],
  },
  'crm.renderTemplate': {
    path: (args) => `/v1/crm/templates/${args.templateId}/render`,
    method: 'POST',
    body: ({ leadId, beoId }) => ({ leadId, beoId }),
  },
  'reservations.saveReservation': { path: '/v1/reservations', method: 'POST', body: stripVenue, invalidate: [['reservations', 'page']] },
  'reservations.removeReservation': { path: (args) => `/v1/reservations/${args.reservationId ?? args.id ?? args}`, method: 'DELETE', invalidate: [['reservations', 'page']] },
  'reservations.createHold': {
    path: '/v1/reservations/holds',
    method: 'POST',
    body: ({ startsAt, endsAt, reason }) => ({ startsAt, endsAt, reason }),
    invalidate: [['reservations', 'holds']],
  },
  'reservations.deleteHold': {
    path: (args) => `/v1/reservations/holds/${args.holdId}`,
    method: 'DELETE',
    invalidate: [['reservations', 'holds']],
  },
  'payroll.recordPayrollExport': { path: '/v1/payroll/record-export', method: 'POST', body: stripVenue },
  'push.registerPushToken': {
    path: '/v1/push/token',
    method: 'POST',
    body: ({ token, platform }) => ({ token, platform }),
  },
};

export function useQuery<T = any>(ref: RailwayFunctionRef, args?: QueryArgs): T {
  const key = getKey(ref);
  const route = queryRoutes[key];
  const enabled = args !== 'skip';
  const query = useReactQuery({
    queryKey: [key, args],
    enabled,
    queryFn: () => (route ? requestRoute<T>(route, args) : Promise.resolve(defaultQueryResult(key) as T)),
  });
  return query.data as T;
}

export function useMutation<TArgs = any, TResult = any>(
  ref: RailwayFunctionRef,
): (args: TArgs) => Promise<TResult> {
  const key = getKey(ref);
  const route = mutationRoutes[key];
  const queryClient = useQueryClient();
  const mutation = useReactMutation({
    mutationFn: async (args: TArgs) => {
      if (!route) {
        throw new Error('This feature is still being moved to the Railway API.');
      }
      return requestRoute<TResult>(route, args);
    },
    onSuccess: async () => {
      const invalidations = route?.invalidate ?? [[key]];
      await Promise.all(invalidations.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });
  const mutateAsync = mutation.mutateAsync;
  return useCallback((args: TArgs) => mutateAsync(args), [mutateAsync]);
}

export function useAction<TArgs = any, TResult = any>(
  ref: RailwayFunctionRef,
): (args: TArgs) => Promise<TResult> {
  return useMutation<TArgs, TResult>(ref);
}

export function useAuthActions() {
  return {
    signIn: async () => {
      throw new Error('Use Railway password auth instead.');
    },
    signOut: async () => undefined,
  };
}

function getKey(ref: RailwayFunctionRef) {
  return ref.__railwayKey;
}

function requestRoute<T>(route: Route, args: any): Promise<T> {
  const path = typeof route.path === 'function' ? route.path(args ?? {}) : route.path;
  return apiRequest<T>(path, {
    method: route.method ?? 'GET',
    body: route.method && route.method !== 'GET' && route.method !== 'DELETE' ? route.body?.(args ?? {}) ?? args ?? {} : undefined,
  });
}

function stripVenue(args: any) {
  const { venueId, ...rest } = args ?? {};
  return rest;
}

function stripVenueAndIds(args: any) {
  const { venueId, shiftId, id, ...rest } = args ?? {};
  return rest;
}

function locationBody(args: any) {
  return {
    lat: args.lat,
    lng: args.lng,
    accuracy: args.accuracy,
    mocked: args.mocked,
  };
}

function clockInvalidations() {
  return [['app', 'getClockBoard'], ['app', 'getDashboard'], ['app', 'getMyTimeClock']];
}

function scheduleInvalidations() {
  return [['scheduling', 'getManagerSchedule'], ['scheduling', 'getLaborForecast'], ['scheduling', 'getMySchedule'], ['scheduling', 'getMyShiftSwaps'], ['scheduling', 'listShiftSwaps']];
}

function defaultQueryResult(key: string) {
  if (key.includes('list') || key.includes('export') || key.includes('getMyShiftSwaps')) return [];
  if (key.endsWith('getManagerDashboard')) return null;
  if (key.endsWith('getManagerInsights')) return null;
  if (key.includes('Dashboard')) return null;
  if (key.includes('Overview')) return null;
  if (key.includes('Page')) return null;
  if (key.includes('Stats')) return null;
  if (key.includes('FloorPlan')) return null;
  return null;
}
