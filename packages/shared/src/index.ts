export type ApiUser = {
  id: number;
  email: string;
  full_name: string;
  role: string;
  venue_id: number | null;
};

export type ApiVenue = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  geofence_radius_m: number;
};

export type ApiTimeEntry = {
  id: number;
  user_id: number;
  venue_id: number;
  shift_id: number | null;
  clock_in_at: string;
  clock_out_at: string | null;
  clock_in_lat: number;
  clock_in_lng: number;
  clock_in_accuracy_m: number;
  clock_in_mocked: boolean;
  clock_out_lat: number | null;
  clock_out_lng: number | null;
  clock_out_accuracy_m: number | null;
  clock_out_mocked: boolean | null;
};
