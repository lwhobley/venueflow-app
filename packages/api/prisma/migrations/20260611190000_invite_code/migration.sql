-- AlterTable
ALTER TABLE "Invite" ADD COLUMN     "code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Invite_code_key" ON "Invite"("code");
