-- Add enum values used by the remaining Convex-backed modules.
ALTER TYPE "ReservationSource" ADD VALUE IF NOT EXISTS 'generic';
CREATE TYPE "BarStockCategory" AS ENUM ('spirit', 'wine', 'beer', 'mixer', 'garnish', 'supply', 'other');
CREATE TYPE "BarStockMovementType" AS ENUM ('count', 'received', 'waste', 'comp', 'transfer', 'correction');
CREATE TYPE "ManagerGoalPeriod" AS ENUM ('day', 'week');
CREATE TYPE "ManagerGoalStatus" AS ENUM ('open', 'done', 'cancelled');

-- Preserve Convex reservation fields that were not represented in the first
-- Postgres mirror. These are nullable so existing Railway databases can widen
-- without rewriting data.
ALTER TABLE "Reservation" ADD COLUMN "depositDueCents" INTEGER;
ALTER TABLE "Reservation" ADD COLUMN "toastCheckGuid" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "depositStatus" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "depositAmount" DOUBLE PRECISION;
ALTER TABLE "Reservation" ADD COLUMN "checkInAt" TIMESTAMP(3);
ALTER TABLE "Reservation" ADD COLUMN "seatedAt" TIMESTAMP(3);
ALTER TABLE "Reservation" ADD COLUMN "completedAt" TIMESTAMP(3);

CREATE TABLE "CrmActivityLog" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "actorId" TEXT,
    "kind" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrmActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "stripePaymentMethodId" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "expMonth" INTEGER NOT NULL,
    "expYear" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "invoiceUrl" TEXT,
    "hostedInvoiceUrl" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VenueRole" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "VenueRole_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "memberCount" INTEGER NOT NULL,
    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScheduleEmailEvent" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "shiftId" TEXT,
    "kind" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScheduleEmailEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PayrollExport" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "totalHours" DOUBLE PRECISION NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayrollExport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReservationConnection" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "provider" "ReservationSource" NOT NULL,
    "externalVenueId" TEXT,
    "status" "IntegrationStatus" NOT NULL,
    "webhookSecret" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReservationConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReservationSyncEvent" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "provider" "ReservationSource" NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "reservationId" TEXT,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    CONSTRAINT "ReservationSyncEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BarInventoryItem" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "BarStockCategory" NOT NULL,
    "area" TEXT,
    "unit" TEXT NOT NULL,
    "parLevel" DOUBLE PRECISION NOT NULL,
    "onHand" DOUBLE PRECISION NOT NULL,
    "unitCostCents" INTEGER,
    "supplier" TEXT,
    "sku" TEXT,
    "notes" TEXT,
    "lastCountedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BarInventoryItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BarInventoryMovement" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "movementType" "BarStockMovementType" NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "previousOnHand" DOUBLE PRECISION NOT NULL,
    "nextOnHand" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BarInventoryMovement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagerGoal" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "period" "ManagerGoalPeriod" NOT NULL,
    "targetDate" TEXT NOT NULL,
    "status" "ManagerGoalStatus" NOT NULL,
    "createdBy" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManagerGoal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VenueEvent" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "expectedGuests" INTEGER,
    "notes" TEXT,
    "reservationId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VenueEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReservationSetting" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "defaultDiningMinutes" INTEGER NOT NULL,
    "defaultTurnMinutes" INTEGER NOT NULL,
    "bookingWindowDays" INTEGER NOT NULL,
    "minLeadHours" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReservationSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TableStateHistory" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "fromStatus" "TableStatus" NOT NULL,
    "toStatus" "TableStatus" NOT NULL,
    "actorId" TEXT,
    "partySize" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    CONSTRAINT "TableStateHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "usedBy" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrmActivityLog_leadId_createdAt_idx" ON "CrmActivityLog"("leadId", "createdAt");
CREATE INDEX "CrmActivityLog_venueId_createdAt_idx" ON "CrmActivityLog"("venueId", "createdAt");
CREATE INDEX "PaymentMethod_venueId_idx" ON "PaymentMethod"("venueId");
CREATE INDEX "Invoice_venueId_createdAt_idx" ON "Invoice"("venueId", "createdAt");
CREATE INDEX "Invoice_stripeInvoiceId_idx" ON "Invoice"("stripeInvoiceId");
CREATE INDEX "VenueRole_venueId_idx" ON "VenueRole"("venueId");
CREATE INDEX "Team_venueId_idx" ON "Team"("venueId");
CREATE INDEX "ScheduleEmailEvent_venueId_sentAt_idx" ON "ScheduleEmailEvent"("venueId", "sentAt");
CREATE INDEX "ScheduleEmailEvent_profileId_sentAt_idx" ON "ScheduleEmailEvent"("profileId", "sentAt");
CREATE INDEX "PayrollExport_venueId_createdAt_idx" ON "PayrollExport"("venueId", "createdAt");
CREATE INDEX "ReservationConnection_venueId_idx" ON "ReservationConnection"("venueId");
CREATE INDEX "ReservationConnection_venueId_provider_idx" ON "ReservationConnection"("venueId", "provider");
CREATE INDEX "ReservationSyncEvent_provider_externalEventId_idx" ON "ReservationSyncEvent"("provider", "externalEventId");
CREATE INDEX "ReservationSyncEvent_venueId_provider_externalEventId_idx" ON "ReservationSyncEvent"("venueId", "provider", "externalEventId");
CREATE INDEX "ReservationSyncEvent_venueId_processedAt_idx" ON "ReservationSyncEvent"("venueId", "processedAt");
CREATE INDEX "BarInventoryItem_venueId_idx" ON "BarInventoryItem"("venueId");
CREATE INDEX "BarInventoryItem_venueId_category_idx" ON "BarInventoryItem"("venueId", "category");
CREATE INDEX "BarInventoryItem_venueId_name_idx" ON "BarInventoryItem"("venueId", "name");
CREATE INDEX "BarInventoryMovement_venueId_createdAt_idx" ON "BarInventoryMovement"("venueId", "createdAt");
CREATE INDEX "BarInventoryMovement_itemId_createdAt_idx" ON "BarInventoryMovement"("itemId", "createdAt");
CREATE INDEX "ManagerGoal_venueId_targetDate_idx" ON "ManagerGoal"("venueId", "targetDate");
CREATE INDEX "ManagerGoal_venueId_status_idx" ON "ManagerGoal"("venueId", "status");
CREATE INDEX "VenueEvent_venueId_startsAt_idx" ON "VenueEvent"("venueId", "startsAt");
CREATE INDEX "VenueEvent_reservationId_idx" ON "VenueEvent"("reservationId");
CREATE INDEX "ReservationSetting_venueId_idx" ON "ReservationSetting"("venueId");
CREATE INDEX "TableStateHistory_tableId_timestamp_idx" ON "TableStateHistory"("tableId", "timestamp");
CREATE INDEX "TableStateHistory_venueId_timestamp_idx" ON "TableStateHistory"("venueId", "timestamp");
CREATE INDEX "Invite_token_idx" ON "Invite"("token");
CREATE INDEX "Invite_venueId_idx" ON "Invite"("venueId");
