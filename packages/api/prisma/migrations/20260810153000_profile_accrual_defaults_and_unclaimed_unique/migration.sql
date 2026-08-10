-- New hires should not receive full PTO/sick balances by default.
-- Existing balances are left untouched.
ALTER TABLE "Profile" ALTER COLUMN "sickHoursAccrued" SET DEFAULT 0;
ALTER TABLE "Profile" ALTER COLUMN "ptoHoursAccrued" SET DEFAULT 0;

-- At most one unclaimed roster profile per venue + email (case-insensitive).
-- Postgres UNIQUE allows multiple NULLs in (userId, venueId), so unclaimed
-- rows need a partial unique index. Prefer the oldest row when duplicates exist.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "venueId", lower(email)
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "Profile"
  WHERE "userId" IS NULL
    AND "venueId" IS NOT NULL
)
UPDATE "Profile" p
SET email = p.email || '+dup-' || substr(p.id, 1, 8)
FROM ranked r
WHERE p.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "Profile_unclaimed_venue_email_key"
  ON "Profile" ("venueId", lower(email))
  WHERE "userId" IS NULL AND "venueId" IS NOT NULL;
