-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'owner', 'manager', 'server', 'staff');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'cancelled', 'expired', 'paused');

-- CreateEnum
CREATE TYPE "SubscriptionPlatform" AS ENUM ('stripe', 'apple');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('scheduled', 'open', 'covered');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('pending', 'approved', 'denied', 'cancelled');

-- CreateEnum
CREATE TYPE "TableShape" AS ENUM ('round', 'square', 'rect', 'booth');

-- CreateEnum
CREATE TYPE "TableSection" AS ENUM ('main', 'patio', 'bar', 'vip');

-- CreateEnum
CREATE TYPE "TableStatus" AS ENUM ('available', 'seated', 'dirty', 'reserved', 'held', 'out_of_service');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('requested', 'confirmed', 'checked_in', 'seated', 'completed', 'no_show', 'cancelled');

-- CreateEnum
CREATE TYPE "ReservationSource" AS ENUM ('direct', 'opentable', 'resy', 'phone', 'walk_in', 'sevenrooms', 'tock', 'google');

-- CreateEnum
CREATE TYPE "PosProvider" AS ENUM ('toast', 'square', 'clover', 'generic');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('connected', 'paused', 'error');

-- CreateEnum
CREATE TYPE "PosCheckStatus" AS ENUM ('open', 'paid', 'void');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('waiting', 'assigned', 'seated', 'completed', 'removed');

-- CreateEnum
CREATE TYPE "HoldType" AS ENUM ('reserved', 'held', 'seated');

-- CreateEnum
CREATE TYPE "CrmLeadStatus" AS ENUM ('new', 'contacted', 'qualified', 'proposal_sent', 'negotiating', 'won', 'lost', 'unqualified', 'on_hold');

-- CreateEnum
CREATE TYPE "BeoStatus" AS ENUM ('draft', 'sent', 'reviewed', 'confirmed', 'amended', 'cancelled');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('draft', 'sent', 'viewed', 'partially_signed', 'fully_signed', 'expired', 'cancelled', 'disputed');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "geofenceRadiusM" DOUBLE PRECISION NOT NULL,
    "code" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "venueType" TEXT,
    "staffRange" TEXT,
    "weeklyLaborBudgetHours" DOUBLE PRECISION,
    "schedulePublishedAt" TIMESTAMP(3),
    "schedulePublishedById" TEXT,
    "scheduleUpdatedAfterPublishAt" TIMESTAMP(3),
    "subscriptionStatus" "SubscriptionStatus",
    "subscriptionPlatform" "SubscriptionPlatform",
    "leadsWebhookSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "tokenIdentifier" TEXT,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "venueId" TEXT,
    "allAccess" BOOLEAN NOT NULL DEFAULT false,
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleShift" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "profileId" TEXT,
    "dayIndex" INTEGER NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "station" TEXT NOT NULL,
    "notes" TEXT,
    "status" "ShiftStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlackoutDate" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlackoutDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleTemplate" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shifts" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Availability" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "dayIndex" INTEGER NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "available" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffRequest" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "requestedForDate" TEXT,
    "requestedShiftId" TEXT,
    "requestedRangeStart" TEXT,
    "requestedRangeEnd" TEXT,
    "availability" JSONB,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "responseNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT,
    "memberIds" TEXT[],
    "lastMessageAt" TIMESTAMP(3),
    "lastMessageText" TEXT,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "profileId" TEXT,
    "audience" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRead" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "clockInAt" TIMESTAMP(3) NOT NULL,
    "clockOutAt" TIMESTAMP(3),
    "clockInLat" DOUBLE PRECISION NOT NULL,
    "clockInLng" DOUBLE PRECISION NOT NULL,
    "clockInAccuracyM" DOUBLE PRECISION NOT NULL,
    "clockInMocked" BOOLEAN NOT NULL,
    "clockOutLat" DOUBLE PRECISION,
    "clockOutLng" DOUBLE PRECISION,
    "clockOutAccuracyM" DOUBLE PRECISION,
    "clockOutMocked" BOOLEAN,
    "isOpen" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guest" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "lifecycleStage" TEXT,
    "source" TEXT,
    "birthday" TEXT,
    "company" TEXT,
    "marketingOptIn" BOOLEAN,
    "favoriteTable" TEXT,
    "preferredServer" TEXT,
    "dietaryNotes" TEXT,
    "tags" TEXT[],
    "notes" TEXT,
    "nameLower" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "guestId" TEXT,
    "guestName" TEXT NOT NULL,
    "guestPhone" TEXT,
    "guestEmail" TEXT,
    "guestCompany" TEXT,
    "partySize" INTEGER NOT NULL,
    "reservationTime" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "source" "ReservationSource" NOT NULL,
    "status" "ReservationStatus" NOT NULL,
    "specialRequests" TEXT,
    "occasion" TEXT,
    "tags" TEXT[],
    "isPrivateEvent" BOOLEAN,
    "eventName" TEXT,
    "eventStatus" TEXT,
    "eventSpace" TEXT,
    "setupStyle" TEXT,
    "menuNotes" TEXT,
    "beverageNotes" TEXT,
    "billingNotes" TEXT,
    "contractStatus" TEXT,
    "beoStatus" TEXT,
    "estimatedValueCents" INTEGER,
    "externalId" TEXT,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Waitlist" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "guestId" TEXT,
    "guestName" TEXT NOT NULL,
    "guestPhone" TEXT,
    "partySize" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "status" "WaitlistStatus" NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "readyAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FloorPlan" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "backgroundImageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FloorPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FloorTable" (
    "id" TEXT NOT NULL,
    "floorPlanId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "shape" "TableShape" NOT NULL,
    "seats" INTEGER NOT NULL,
    "seatLabelStyle" TEXT,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "rotation" DOUBLE PRECISION NOT NULL,
    "section" "TableSection" NOT NULL,
    "minSpend" INTEGER NOT NULL,
    "isReservable" BOOLEAN NOT NULL,

    CONSTRAINT "FloorTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FloorChair" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "floorPlanId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "rotation" DOUBLE PRECISION NOT NULL,
    "label" TEXT,

    CONSTRAINT "FloorChair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableState" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "status" "TableStatus" NOT NULL,
    "partySize" INTEGER,
    "serverId" TEXT,
    "toastCheckGuid" TEXT,
    "seatedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "mergeGroupId" TEXT,

    CONSTRAINT "TableState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableAssignment" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "reservationId" TEXT,
    "waitlistId" TEXT,
    "tableId" TEXT NOT NULL,
    "holdType" "HoldType" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releasedReason" TEXT,

    CONSTRAINT "TableAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosConnection" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "provider" "PosProvider" NOT NULL,
    "externalLocationId" TEXT,
    "status" "IntegrationStatus" NOT NULL,
    "webhookSecret" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosCheck" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "provider" "PosProvider" NOT NULL,
    "externalCheckId" TEXT NOT NULL,
    "tableLabel" TEXT,
    "tableId" TEXT,
    "serverName" TEXT,
    "serverId" TEXT,
    "guestName" TEXT,
    "guestId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "subtotalCents" INTEGER NOT NULL,
    "taxCents" INTEGER,
    "tipCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "discountCents" INTEGER,
    "compCents" INTEGER,
    "promoCents" INTEGER,
    "guestCount" INTEGER,
    "revenueCenter" TEXT,
    "tenderType" TEXT,
    "menuItems" JSONB,
    "status" "PosCheckStatus" NOT NULL,
    "raw" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosLaborPunch" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "provider" "PosProvider" NOT NULL,
    "externalEmployeeId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "jobTitle" TEXT,
    "clockInAt" TIMESTAMP(3) NOT NULL,
    "clockOutAt" TIMESTAMP(3),
    "regularMinutes" INTEGER,
    "overtimeMinutes" INTEGER,
    "declaredTipsCents" INTEGER,
    "tipsCents" INTEGER,
    "regularPayCents" INTEGER,
    "overtimePayCents" INTEGER,
    "totalPayCents" INTEGER,
    "businessDate" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosLaborPunch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmLead" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "guestId" TEXT,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "source" TEXT,
    "status" "CrmLeadStatus" NOT NULL,
    "tags" TEXT[],
    "assignedToId" TEXT,
    "marketingOptIn" BOOLEAN,
    "lastActivityAt" TIMESTAMP(3),
    "estimatedValueCents" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmNote" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmBeo" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "leadId" TEXT,
    "eventName" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3),
    "eventType" TEXT,
    "guestCount" INTEGER,
    "venueSpace" TEXT,
    "setupStyle" TEXT,
    "fbMinimumCents" INTEGER,
    "depositCents" INTEGER,
    "depositDueDate" TIMESTAMP(3),
    "menuAppetizers" TEXT,
    "menuEntrees" TEXT,
    "menuDesserts" TEXT,
    "menuBarPackage" TEXT,
    "specialRequirements" TEXT,
    "internalNotes" TEXT,
    "assignedRepId" TEXT,
    "status" "BeoStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmBeo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmContract" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "leadId" TEXT,
    "beoId" TEXT,
    "contractNumber" TEXT NOT NULL,
    "contractDate" TIMESTAMP(3),
    "eventName" TEXT,
    "eventDate" TIMESTAMP(3),
    "guestCount" INTEGER,
    "venueSpace" TEXT,
    "fbMinimumCents" INTEGER,
    "paymentSchedule" JSONB NOT NULL,
    "cancellationPolicy" TEXT,
    "forceMajeure" BOOLEAN,
    "liabilityWaiver" BOOLEAN,
    "customClauses" TEXT[],
    "clientSignatureName" TEXT,
    "clientSignatureDate" TIMESTAMP(3),
    "status" "ContractStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "platform" "SubscriptionPlatform",
    "planId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "trialStartedAt" TIMESTAMP(3) NOT NULL,
    "trialEndsAt" TIMESTAMP(3) NOT NULL,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "externalSubscriptionId" TEXT,
    "externalCustomerId" TEXT,
    "dataRetentionWarnedAt" TIMESTAMP(3),
    "lastStripeEventAt" TIMESTAMP(3),
    "lastRevenueCatEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionEvent" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,

    CONSTRAINT "SubscriptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CosmicInsight" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "batchAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CosmicInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "AuthAccount_userId_provider_idx" ON "AuthAccount"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "AuthAccount_provider_providerAccountId_key" ON "AuthAccount"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_code_key" ON "Venue"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");

-- CreateIndex
CREATE INDEX "Profile_venueId_idx" ON "Profile"("venueId");

-- CreateIndex
CREATE INDEX "Profile_email_idx" ON "Profile"("email");

-- CreateIndex
CREATE INDEX "Profile_tokenIdentifier_idx" ON "Profile"("tokenIdentifier");

-- CreateIndex
CREATE INDEX "ScheduleShift_venueId_idx" ON "ScheduleShift"("venueId");

-- CreateIndex
CREATE INDEX "ScheduleShift_profileId_idx" ON "ScheduleShift"("profileId");

-- CreateIndex
CREATE INDEX "ScheduleShift_venueId_profileId_dayIndex_idx" ON "ScheduleShift"("venueId", "profileId", "dayIndex");

-- CreateIndex
CREATE INDEX "BlackoutDate_venueId_idx" ON "BlackoutDate"("venueId");

-- CreateIndex
CREATE INDEX "ScheduleTemplate_venueId_idx" ON "ScheduleTemplate"("venueId");

-- CreateIndex
CREATE INDEX "Availability_profileId_idx" ON "Availability"("profileId");

-- CreateIndex
CREATE INDEX "Availability_venueId_idx" ON "Availability"("venueId");

-- CreateIndex
CREATE INDEX "Availability_profileId_dayIndex_idx" ON "Availability"("profileId", "dayIndex");

-- CreateIndex
CREATE INDEX "StaffRequest_venueId_idx" ON "StaffRequest"("venueId");

-- CreateIndex
CREATE INDEX "StaffRequest_profileId_idx" ON "StaffRequest"("profileId");

-- CreateIndex
CREATE INDEX "StaffRequest_status_idx" ON "StaffRequest"("status");

-- CreateIndex
CREATE INDEX "Conversation_venueId_idx" ON "Conversation"("venueId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationEvent_venueId_createdAt_idx" ON "NotificationEvent"("venueId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationEvent_profileId_createdAt_idx" ON "NotificationEvent"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationRead_profileId_idx" ON "NotificationRead"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRead_notificationId_profileId_key" ON "NotificationRead"("notificationId", "profileId");

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

-- CreateIndex
CREATE INDEX "PushToken_profileId_idx" ON "PushToken"("profileId");

-- CreateIndex
CREATE INDEX "PushToken_venueId_idx" ON "PushToken"("venueId");

-- CreateIndex
CREATE INDEX "TimeEntry_venueId_idx" ON "TimeEntry"("venueId");

-- CreateIndex
CREATE INDEX "TimeEntry_profileId_idx" ON "TimeEntry"("profileId");

-- CreateIndex
CREATE INDEX "TimeEntry_profileId_isOpen_idx" ON "TimeEntry"("profileId", "isOpen");

-- CreateIndex
CREATE INDEX "Guest_venueId_idx" ON "Guest"("venueId");

-- CreateIndex
CREATE INDEX "Guest_phone_idx" ON "Guest"("phone");

-- CreateIndex
CREATE INDEX "Guest_email_idx" ON "Guest"("email");

-- CreateIndex
CREATE INDEX "Guest_venueId_nameLower_idx" ON "Guest"("venueId", "nameLower");

-- CreateIndex
CREATE INDEX "Reservation_venueId_reservationTime_idx" ON "Reservation"("venueId", "reservationTime");

-- CreateIndex
CREATE INDEX "Reservation_venueId_status_idx" ON "Reservation"("venueId", "status");

-- CreateIndex
CREATE INDEX "Reservation_guestId_idx" ON "Reservation"("guestId");

-- CreateIndex
CREATE INDEX "Reservation_externalId_idx" ON "Reservation"("externalId");

-- CreateIndex
CREATE INDEX "Reservation_venueId_externalId_idx" ON "Reservation"("venueId", "externalId");

-- CreateIndex
CREATE INDEX "Waitlist_venueId_requestedAt_idx" ON "Waitlist"("venueId", "requestedAt");

-- CreateIndex
CREATE INDEX "Waitlist_venueId_status_idx" ON "Waitlist"("venueId", "status");

-- CreateIndex
CREATE INDEX "FloorPlan_venueId_idx" ON "FloorPlan"("venueId");

-- CreateIndex
CREATE INDEX "FloorPlan_venueId_isActive_idx" ON "FloorPlan"("venueId", "isActive");

-- CreateIndex
CREATE INDEX "FloorTable_floorPlanId_idx" ON "FloorTable"("floorPlanId");

-- CreateIndex
CREATE INDEX "FloorTable_floorPlanId_section_idx" ON "FloorTable"("floorPlanId", "section");

-- CreateIndex
CREATE INDEX "FloorChair_floorPlanId_idx" ON "FloorChair"("floorPlanId");

-- CreateIndex
CREATE INDEX "FloorChair_venueId_idx" ON "FloorChair"("venueId");

-- CreateIndex
CREATE INDEX "TableState_tableId_idx" ON "TableState"("tableId");

-- CreateIndex
CREATE INDEX "TableState_status_idx" ON "TableState"("status");

-- CreateIndex
CREATE INDEX "TableState_serverId_idx" ON "TableState"("serverId");

-- CreateIndex
CREATE INDEX "TableState_venueId_idx" ON "TableState"("venueId");

-- CreateIndex
CREATE INDEX "TableState_venueId_mergeGroupId_idx" ON "TableState"("venueId", "mergeGroupId");

-- CreateIndex
CREATE INDEX "TableAssignment_tableId_startsAt_idx" ON "TableAssignment"("tableId", "startsAt");

-- CreateIndex
CREATE INDEX "TableAssignment_reservationId_idx" ON "TableAssignment"("reservationId");

-- CreateIndex
CREATE INDEX "TableAssignment_waitlistId_idx" ON "TableAssignment"("waitlistId");

-- CreateIndex
CREATE INDEX "TableAssignment_venueId_startsAt_idx" ON "TableAssignment"("venueId", "startsAt");

-- CreateIndex
CREATE INDEX "PosConnection_venueId_idx" ON "PosConnection"("venueId");

-- CreateIndex
CREATE INDEX "PosConnection_venueId_provider_idx" ON "PosConnection"("venueId", "provider");

-- CreateIndex
CREATE INDEX "PosCheck_venueId_openedAt_idx" ON "PosCheck"("venueId", "openedAt");

-- CreateIndex
CREATE INDEX "PosCheck_provider_externalCheckId_idx" ON "PosCheck"("provider", "externalCheckId");

-- CreateIndex
CREATE INDEX "PosCheck_venueId_provider_externalCheckId_idx" ON "PosCheck"("venueId", "provider", "externalCheckId");

-- CreateIndex
CREATE INDEX "PosCheck_guestId_idx" ON "PosCheck"("guestId");

-- CreateIndex
CREATE INDEX "PosLaborPunch_venueId_businessDate_idx" ON "PosLaborPunch"("venueId", "businessDate");

-- CreateIndex
CREATE INDEX "PosLaborPunch_venueId_externalEmployeeId_idx" ON "PosLaborPunch"("venueId", "externalEmployeeId");

-- CreateIndex
CREATE INDEX "CrmLead_venueId_idx" ON "CrmLead"("venueId");

-- CreateIndex
CREATE INDEX "CrmLead_venueId_status_idx" ON "CrmLead"("venueId", "status");

-- CreateIndex
CREATE INDEX "CrmLead_guestId_idx" ON "CrmLead"("guestId");

-- CreateIndex
CREATE INDEX "CrmNote_leadId_createdAt_idx" ON "CrmNote"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmNote_venueId_idx" ON "CrmNote"("venueId");

-- CreateIndex
CREATE INDEX "CrmBeo_venueId_idx" ON "CrmBeo"("venueId");

-- CreateIndex
CREATE INDEX "CrmBeo_leadId_idx" ON "CrmBeo"("leadId");

-- CreateIndex
CREATE INDEX "CrmBeo_venueId_status_idx" ON "CrmBeo"("venueId", "status");

-- CreateIndex
CREATE INDEX "CrmContract_venueId_idx" ON "CrmContract"("venueId");

-- CreateIndex
CREATE INDEX "CrmContract_leadId_idx" ON "CrmContract"("leadId");

-- CreateIndex
CREATE INDEX "CrmContract_beoId_idx" ON "CrmContract"("beoId");

-- CreateIndex
CREATE INDEX "CrmContract_venueId_status_idx" ON "CrmContract"("venueId", "status");

-- CreateIndex
CREATE INDEX "Subscription_venueId_idx" ON "Subscription"("venueId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_externalSubscriptionId_idx" ON "Subscription"("externalSubscriptionId");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_source_externalEventId_idx" ON "SubscriptionEvent"("source", "externalEventId");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_venueId_processedAt_idx" ON "SubscriptionEvent"("venueId", "processedAt");

-- CreateIndex
CREATE INDEX "CosmicInsight_batchAt_idx" ON "CosmicInsight"("batchAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthAccount" ADD CONSTRAINT "AuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleShift" ADD CONSTRAINT "ScheduleShift_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleShift" ADD CONSTRAINT "ScheduleShift_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlackoutDate" ADD CONSTRAINT "BlackoutDate_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffRequest" ADD CONSTRAINT "StaffRequest_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffRequest" ADD CONSTRAINT "StaffRequest_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorPlan" ADD CONSTRAINT "FloorPlan_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorTable" ADD CONSTRAINT "FloorTable_floorPlanId_fkey" FOREIGN KEY ("floorPlanId") REFERENCES "FloorPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorChair" ADD CONSTRAINT "FloorChair_floorPlanId_fkey" FOREIGN KEY ("floorPlanId") REFERENCES "FloorPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableState" ADD CONSTRAINT "TableState_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosCheck" ADD CONSTRAINT "PosCheck_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmNote" ADD CONSTRAINT "CrmNote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmNote" ADD CONSTRAINT "CrmNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmBeo" ADD CONSTRAINT "CrmBeo_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContract" ADD CONSTRAINT "CrmContract_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

