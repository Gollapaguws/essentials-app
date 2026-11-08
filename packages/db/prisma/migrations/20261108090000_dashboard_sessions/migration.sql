-- Server-side dashboard sessions: the row id is a hash of the httpOnly cookie,
-- and the Supabase tokens are stored encrypted so a database read alone cannot
-- impersonate a signed-in user.
CREATE TABLE "DashboardSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authUid" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "aal" TEXT NOT NULL DEFAULT 'aal1',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "refreshUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DashboardSession_userId_idx" ON "DashboardSession"("userId");
CREATE INDEX "DashboardSession_expiresAt_idx" ON "DashboardSession"("expiresAt");

ALTER TABLE "DashboardSession" ADD CONSTRAINT "DashboardSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
