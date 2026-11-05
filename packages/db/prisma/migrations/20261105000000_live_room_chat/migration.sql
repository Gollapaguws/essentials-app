-- Public chat under the front-page stream. Display name + body only: the room
-- is anonymous, and the API throttles posting per IP.
CREATE TABLE "LiveChatMessage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LiveChatMessage_createdAt_idx" ON "LiveChatMessage"("createdAt");
