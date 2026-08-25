-- Overnight shifts are stored as endMinutes past midnight (e.g. 22:00-02:00
-- is 1320-1560). The original check required endMinutes <= 1440 and
-- endMinutes > startMinutes, so those writes failed after app validation.

ALTER TABLE "ScheduleShift" DROP CONSTRAINT IF EXISTS "ScheduleShift_time_window_check";
ALTER TABLE "ScheduleShift"
  ADD CONSTRAINT "ScheduleShift_time_window_check"
    CHECK (
      "dayIndex" BETWEEN 0 AND 6
      AND "startMinutes" BETWEEN 0 AND 1439
      AND "endMinutes" BETWEEN 1 AND 2880
      AND "endMinutes" > "startMinutes"
      AND "endMinutes" - "startMinutes" <= 1440
    ) NOT VALID;

ALTER TABLE "Availability" DROP CONSTRAINT IF EXISTS "Availability_time_window_check";
ALTER TABLE "Availability"
  ADD CONSTRAINT "Availability_time_window_check"
    CHECK (
      "dayIndex" BETWEEN 0 AND 6
      AND "startMinutes" BETWEEN 0 AND 1439
      AND "endMinutes" BETWEEN 1 AND 2880
      AND "endMinutes" > "startMinutes"
      AND "endMinutes" - "startMinutes" <= 1440
    ) NOT VALID;

ALTER TABLE "ScheduleShift" VALIDATE CONSTRAINT "ScheduleShift_time_window_check";
ALTER TABLE "Availability" VALIDATE CONSTRAINT "Availability_time_window_check";
