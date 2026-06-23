-- Add role/shift channel columns to Conversation
ALTER TABLE "Conversation" ADD COLUMN "roleName" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "shiftDate" TEXT;

-- Add rich message fields to Message
ALTER TABLE "Message" ADD COLUMN "shiftId" TEXT;
ALTER TABLE "Message" ADD COLUMN "swapId" TEXT;
ALTER TABLE "Message" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "Message" ADD COLUMN "reactions" JSONB;

-- CreateTable
CREATE TABLE "ConversationRead" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationRead_conversationId_idx" ON "ConversationRead"("conversationId");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "ConversationRead_conversationId_profileId_key" ON "ConversationRead"("conversationId", "profileId");

-- AddForeignKey
ALTER TABLE "ConversationRead" ADD CONSTRAINT "ConversationRead_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationRead" ADD CONSTRAINT "ConversationRead_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
