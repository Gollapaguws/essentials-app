-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "telegramChatId" TEXT,
  ADD COLUMN "telegramLinkedAt" TIMESTAMP(3),
  ADD COLUMN "telegramLinkCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramLinkCode_key" ON "User"("telegramLinkCode");
