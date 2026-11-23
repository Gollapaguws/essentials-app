-- Extra local parts that deliver to a provisioned mailbox.
ALTER TABLE "UserMailbox" ADD COLUMN "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
