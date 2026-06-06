// Response mappers that mirror the shapes returned by convex/app.ts, so the
// NestJS API is wire-compatible with the existing clients during migration.

type ClockProfile = { id: string; fullName: string; role: string; jobTitle: string };
type ClockVenue = { id: string; name: string };
type TimeEntryRow = {
  id: string;
  clockInAt: Date;
  clockOutAt: Date | null;
  clockInLat: number;
  clockInLng: number;
  clockInAccuracyM: number;
  clockInMocked: boolean;
  clockOutLat: number | null;
  clockOutLng: number | null;
  clockOutAccuracyM: number | null;
  clockOutMocked: boolean | null;
  isOpen: boolean;
};

export function dayLabel(index: number): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][index] ?? 'Day';
}

export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${mins.toString().padStart(2, '0')} ${suffix}`;
}

export function mapClockEntry(entry: TimeEntryRow, profile: ClockProfile, venue: ClockVenue) {
  return {
    _id: entry.id,
    memberId: profile.id,
    memberName: profile.fullName,
    role: profile.role,
    jobTitle: profile.jobTitle,
    venueId: venue.id,
    venueName: venue.name,
    clockInAt: entry.clockInAt.getTime(),
    clockOutAt: entry.clockOutAt?.getTime() ?? null,
    clockInLat: entry.clockInLat,
    clockInLng: entry.clockInLng,
    clockInAccuracyM: entry.clockInAccuracyM,
    clockInMocked: entry.clockInMocked,
    clockOutLat: entry.clockOutLat ?? null,
    clockOutLng: entry.clockOutLng ?? null,
    clockOutAccuracyM: entry.clockOutAccuracyM ?? null,
    clockOutMocked: entry.clockOutMocked ?? null,
    isOpen: entry.isOpen,
  };
}

type ProfileRow = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  jobTitle: string;
  venueId: string | null;
  allAccess: boolean;
};

export function mapProfile(profile: ProfileRow) {
  return {
    _id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    role: profile.role,
    jobTitle: profile.jobTitle,
    venueId: profile.venueId,
    allAccess: profile.allAccess,
  };
}

type StaffRequestRow = {
  id: string;
  venueId: string;
  profileId: string;
  kind: string;
  status: string;
  title: string;
  details: string;
  requestedForDate: string | null;
  requestedShiftId: string | null;
  requestedRangeStart: string | null;
  requestedRangeEnd: string | null;
  availability: unknown;
  reviewerId: string | null;
  reviewedAt: Date | null;
  responseNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type VenueRoleRow = {
  id: string;
  name: string;
};

export function mapVenueRole(role: VenueRoleRow) {
  return {
    _id: role.id,
    name: role.name,
  };
}

type VenueRow = {
  id: string;
  createdAt: Date;
  name: string;
  latitude: number;
  longitude: number;
  geofenceRadiusM: number;
  subscriptionStatus: string | null;
  subscriptionPlatform: string | null;
};

export function mapVenue(venue: VenueRow) {
  return {
    _id: venue.id,
    _creationTime: venue.createdAt.getTime(),
    name: venue.name,
    latitude: venue.latitude,
    longitude: venue.longitude,
    geofenceRadiusM: venue.geofenceRadiusM,
    subscriptionStatus: venue.subscriptionStatus ?? null,
    subscriptionPlatform: venue.subscriptionPlatform ?? null,
  };
}

type ProfileFullRow = {
  id: string;
  createdAt: Date;
  tokenIdentifier: string | null;
  email: string;
  fullName: string;
  role: string;
  jobTitle: string;
  venueId: string | null;
  allAccess: boolean;
};

export function mapProfileFull(profile: ProfileFullRow) {
  return {
    _id: profile.id,
    _creationTime: profile.createdAt.getTime(),
    tokenIdentifier: profile.tokenIdentifier ?? null,
    email: profile.email,
    fullName: profile.fullName,
    role: profile.role,
    jobTitle: profile.jobTitle,
    venueId: profile.venueId ?? null,
    allAccess: profile.allAccess,
  };
}

type ScheduleShiftRow = {
  id: string;
  venueId: string;
  profileId: string | null;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  jobTitle: string;
  station: string;
  notes: string | null;
  status: string;
};

export function mapScheduleShift(
  shift: ScheduleShiftRow,
  memberName: string | null = null,
  conflict = false,
) {
  return {
    _id: shift.id,
    venueId: shift.venueId,
    profileId: shift.profileId ?? null,
    memberName,
    dayIndex: shift.dayIndex,
    dayLabel: dayLabel(shift.dayIndex),
    startMinutes: shift.startMinutes,
    endMinutes: shift.endMinutes,
    startTime: minutesToTime(shift.startMinutes),
    endTime: minutesToTime(shift.endMinutes),
    jobTitle: shift.jobTitle,
    station: shift.station,
    notes: shift.notes ?? null,
    status: shift.status,
    conflict,
  };
}

type AvailabilityRow = {
  id: string;
  venueId: string;
  profileId: string;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  available: boolean;
  updatedAt: Date;
};

export function mapAvailability(row: AvailabilityRow) {
  return {
    _id: row.id,
    venueId: row.venueId,
    profileId: row.profileId,
    dayIndex: row.dayIndex,
    startMinutes: row.startMinutes,
    endMinutes: row.endMinutes,
    available: row.available,
    updatedAt: row.updatedAt.getTime(),
  };
}

type BlackoutRow = {
  id: string;
  venueId: string;
  startDate: string;
  endDate: string;
  reason: string;
  createdBy: string;
  createdAt: Date;
};

export function mapBlackout(row: BlackoutRow) {
  return {
    _id: row.id,
    venueId: row.venueId,
    startDate: row.startDate,
    endDate: row.endDate,
    reason: row.reason,
    createdBy: row.createdBy,
    createdAt: row.createdAt.getTime(),
  };
}

export function shiftConflictsWithAvailability(
  avail: { dayIndex: number; startMinutes: number; endMinutes: number; available: boolean }[],
  dayIndex: number,
  start: number,
  end: number,
): boolean {
  const dayRows = avail.filter((a) => a.dayIndex === dayIndex);
  if (dayRows.length === 0) return false;
  const blocked = dayRows.some((a) => !a.available && a.startMinutes < end && a.endMinutes > start);
  if (blocked) return true;
  const covered = dayRows.some((a) => a.available && a.startMinutes <= start && a.endMinutes >= end);
  return !covered;
}

export function mapStaffRequest(request: StaffRequestRow) {
  return {
    _id: request.id,
    venueId: request.venueId,
    profileId: request.profileId,
    kind: request.kind,
    status: request.status,
    title: request.title,
    details: request.details,
    requestedForDate: request.requestedForDate ?? null,
    requestedShiftId: request.requestedShiftId ?? null,
    requestedRangeStart: request.requestedRangeStart ?? null,
    requestedRangeEnd: request.requestedRangeEnd ?? null,
    availability: request.availability ?? null,
    reviewerId: request.reviewerId ?? null,
    reviewedAt: request.reviewedAt?.getTime() ?? null,
    responseNotes: request.responseNotes ?? null,
    createdAt: request.createdAt.getTime(),
    updatedAt: request.updatedAt.getTime(),
  };
}
