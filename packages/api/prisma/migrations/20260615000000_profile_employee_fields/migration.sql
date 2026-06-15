-- Add employee profile detail fields used by the staff management UI.
ALTER TABLE "Profile"
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "altPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "dateOfBirth" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "certifications" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

