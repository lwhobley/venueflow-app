-- Keep application-validated operational values valid even when rows are
-- written by a repair script, migration, or future integration.

ALTER TABLE "Venue"
  ADD CONSTRAINT "Venue_coordinates_check"
    CHECK ("latitude" >= -90 AND "latitude" <= 90 AND "longitude" >= -180 AND "longitude" <= 180) NOT VALID,
  ADD CONSTRAINT "Venue_geofence_radius_check"
    CHECK ("geofenceRadiusM" > 0 AND "geofenceRadiusM" < 'Infinity'::double precision) NOT VALID,
  ADD CONSTRAINT "Venue_pay_period_check"
    CHECK ("payPeriodLengthDays" > 0 AND "earlyClockInWindowMin" >= 0) NOT VALID,
  ADD CONSTRAINT "Venue_labor_budget_check"
    CHECK ("weeklyLaborBudgetHours" IS NULL OR ("weeklyLaborBudgetHours" >= 0 AND "weeklyLaborBudgetHours" < 'Infinity'::double precision)) NOT VALID;

ALTER TABLE "ScheduleShift"
  ADD CONSTRAINT "ScheduleShift_time_window_check"
    CHECK ("dayIndex" BETWEEN 0 AND 6 AND "startMinutes" BETWEEN 0 AND 1439 AND "endMinutes" BETWEEN 1 AND 1440 AND "endMinutes" > "startMinutes") NOT VALID;

ALTER TABLE "Availability"
  ADD CONSTRAINT "Availability_time_window_check"
    CHECK ("dayIndex" BETWEEN 0 AND 6 AND "startMinutes" BETWEEN 0 AND 1439 AND "endMinutes" BETWEEN 1 AND 1440 AND "endMinutes" > "startMinutes") NOT VALID;

ALTER TABLE "BlackoutDate"
  ADD CONSTRAINT "BlackoutDate_time_window_check"
    CHECK ("endDate" > "startDate") NOT VALID;

ALTER TABLE "Reservation"
  ADD CONSTRAINT "Reservation_party_duration_check"
    CHECK ("partySize" > 0 AND "durationMinutes" > 0) NOT VALID,
  ADD CONSTRAINT "Reservation_money_check"
    CHECK (("estimatedValueCents" IS NULL OR "estimatedValueCents" >= 0) AND ("depositDueCents" IS NULL OR "depositDueCents" >= 0)) NOT VALID;

ALTER TABLE "Waitlist"
  ADD CONSTRAINT "Waitlist_party_size_check"
    CHECK ("partySize" > 0) NOT VALID;

ALTER TABLE "ReservationHold"
  ADD CONSTRAINT "ReservationHold_time_window_check"
    CHECK ("endsAt" > "startsAt") NOT VALID;

ALTER TABLE "FloorPlan"
  ADD CONSTRAINT "FloorPlan_dimensions_check"
    CHECK (width > 0 AND width < 'Infinity'::double precision AND height > 0 AND height < 'Infinity'::double precision) NOT VALID;

ALTER TABLE "FloorTable"
  ADD CONSTRAINT "FloorTable_geometry_check"
    CHECK (seats > 0 AND width > 0 AND width < 'Infinity'::double precision AND height > 0 AND height < 'Infinity'::double precision AND "minSpend" >= 0) NOT VALID;

ALTER TABLE "TableState"
  ADD CONSTRAINT "TableState_party_size_check"
    CHECK ("partySize" IS NULL OR "partySize" > 0) NOT VALID;

ALTER TABLE "TableAssignment"
  ADD CONSTRAINT "TableAssignment_time_window_check"
    CHECK ("endsAt" > "startsAt") NOT VALID;

ALTER TABLE "VenueDocument"
  ADD CONSTRAINT "VenueDocument_size_check"
    CHECK ("sizeBytes" >= 0) NOT VALID;

ALTER TABLE "User"
  ADD CONSTRAINT "User_failed_sign_in_count_check"
    CHECK ("failedSignInCount" >= 0) NOT VALID;

ALTER TABLE "PasswordCredential"
  ADD CONSTRAINT "PasswordCredential_iterations_check"
    CHECK (iterations > 0) NOT VALID;

ALTER TABLE "Venue" VALIDATE CONSTRAINT "Venue_coordinates_check";
ALTER TABLE "Venue" VALIDATE CONSTRAINT "Venue_geofence_radius_check";
ALTER TABLE "Venue" VALIDATE CONSTRAINT "Venue_pay_period_check";
ALTER TABLE "Venue" VALIDATE CONSTRAINT "Venue_labor_budget_check";
ALTER TABLE "ScheduleShift" VALIDATE CONSTRAINT "ScheduleShift_time_window_check";
ALTER TABLE "Availability" VALIDATE CONSTRAINT "Availability_time_window_check";
ALTER TABLE "BlackoutDate" VALIDATE CONSTRAINT "BlackoutDate_time_window_check";
ALTER TABLE "Reservation" VALIDATE CONSTRAINT "Reservation_party_duration_check";
ALTER TABLE "Reservation" VALIDATE CONSTRAINT "Reservation_money_check";
ALTER TABLE "Waitlist" VALIDATE CONSTRAINT "Waitlist_party_size_check";
ALTER TABLE "ReservationHold" VALIDATE CONSTRAINT "ReservationHold_time_window_check";
ALTER TABLE "FloorPlan" VALIDATE CONSTRAINT "FloorPlan_dimensions_check";
ALTER TABLE "FloorTable" VALIDATE CONSTRAINT "FloorTable_geometry_check";
ALTER TABLE "TableState" VALIDATE CONSTRAINT "TableState_party_size_check";
ALTER TABLE "TableAssignment" VALIDATE CONSTRAINT "TableAssignment_time_window_check";
ALTER TABLE "VenueDocument" VALIDATE CONSTRAINT "VenueDocument_size_check";
ALTER TABLE "User" VALIDATE CONSTRAINT "User_failed_sign_in_count_check";
ALTER TABLE "PasswordCredential" VALIDATE CONSTRAINT "PasswordCredential_iterations_check";
