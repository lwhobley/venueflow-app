import type { Id } from './ids';

export type Role = 'admin' | 'owner' | 'manager' | 'server' | 'staff';

export type Venue = {
  id: Id<'venues'>;
  name: string;
  latitude: number;
  longitude: number;
  geofence_radius_m: number;
};

export type VenueSummary = {
  id: string;
  name: string;
  role: Role;
  profileId?: string;
};

export type UserSummary = {
  id: string;
  email: string;
  full_name: string;
  email_verified: boolean;
  role: Role;
  job_title: string;
  venue_id: Id<'venues'> | null;
  all_access: boolean;
};

export type TeamMember = {
  id: string;
  full_name: string;
  role: Role;
  job_title: string;
  venue_name: string;
  is_clocked_in: boolean;
};

export type ScheduleShift = {
  id: string;
  day_index: number;
  day_label: string;
  start_time: string;
  end_time: string;
  member_id: string | null;
  member_name: string;
  job_title: string;
  station: string;
  status: 'scheduled' | 'open' | 'covered';
  notes?: string;
};

export type ClockEntry = {
  id: string;
  member_id: string;
  member_name: string;
  role: Role;
  job_title: string;
  venue_id: string;
  venue_name: string;
  clock_in_at: number;
  clock_out_at: number | null;
  clock_in_lat: number;
  clock_in_lng: number;
  clock_in_accuracy_m: number;
  clock_in_mocked: boolean;
  clock_out_lat: number | null;
  clock_out_lng: number | null;
  clock_out_accuracy_m: number | null;
  clock_out_mocked: boolean | null;
  is_open: boolean;
};

export type AvailabilityBlock = {
  day_index: number;
  start_minutes: number;
  end_minutes: number;
  available: boolean;
};

export type StaffRequestKind = 'add_shift' | 'drop_shift' | 'time_off' | 'sick_leave' | 'time_correction' | 'other';
export type StaffRequestStatus = 'pending' | 'approved' | 'denied' | 'cancelled';

export type StaffRequest = {
  id: string;
  venue_id: string;
  profile_id: string;
  kind: StaffRequestKind;
  status: StaffRequestStatus;
  title: string;
  details: string;
  requested_for_date: string | null;
  requested_shift_id: string | null;
  requested_range_start: string | null;
  requested_range_end: string | null;
  availability: AvailabilityBlock[] | null;
  reviewer_id: string | null;
  reviewed_at: number | null;
  response_notes: string | null;
  created_at: number;
  updated_at: number;
};

export type TimeEntry = ClockEntry;
