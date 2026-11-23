-- Mailboxes provisioned for accounts on the platform mail server.
CREATE TABLE "UserMailbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "localpart" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMailbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserMailbox_userId_key" ON "UserMailbox"("userId");
CREATE UNIQUE INDEX "UserMailbox_address_key" ON "UserMailbox"("address");
CREATE UNIQUE INDEX "UserMailbox_localpart_key" ON "UserMailbox"("localpart");
CREATE INDEX "UserMailbox_status_idx" ON "UserMailbox"("status");

ALTER TABLE "UserMailbox" ADD CONSTRAINT "UserMailbox_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
