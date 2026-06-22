CREATE TABLE "EmailTemplate" (
  "id"        TEXT NOT NULL,
  "venueId"   TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "subject"   TEXT NOT NULL,
  "body"      TEXT NOT NULL,
  "variables" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailTemplate_venueId_name_key" ON "EmailTemplate"("venueId", "name");
CREATE INDEX "EmailTemplate_venueId_idx" ON "EmailTemplate"("venueId");

ALTER TABLE "EmailTemplate"
  ADD CONSTRAINT "EmailTemplate_venueId_fkey"
  FOREIGN KEY ("venueId") REFERENCES "Venue"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
