-- One row per changelog release announced by email to members. The release date
-- is the id, so a restart, a redeploy or a second API instance cannot mail the
-- same notes twice.
CREATE TABLE "WhatsNewBroadcast" (
    "release" TEXT NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsNewBroadcast_pkey" PRIMARY KEY ("release")
);

-- The 2026-11-12 notes shipped together with this feature: members can already
-- read them on the site, so they are recorded as announced rather than mailing
-- everyone about notes that are not new. The next release does get mailed.
INSERT INTO "WhatsNewBroadcast" ("release", "sentCount") VALUES ('2026-11-12', 0);
