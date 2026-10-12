-- Add missing columns from admin_setup_config migration
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- Add missing columns/tables from production_hardening migration
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "receiptTokenHash" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "inventoryRestored" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "AppConfig" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "secret" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "RateLimit" ("key" TEXT PRIMARY KEY, "count" INTEGER NOT NULL DEFAULT 1, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX IF NOT EXISTS "RateLimit_expiresAt_idx" ON "RateLimit"("expiresAt");
CREATE TABLE IF NOT EXISTS "PasswordReset" ("tokenHash" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX IF NOT EXISTS "PasswordReset_expiresAt_idx" ON "PasswordReset"("expiresAt");
CREATE TABLE IF NOT EXISTS "EmailJob" (
  "id" TEXT PRIMARY KEY, "dedupeKey" TEXT NOT NULL, "to" TEXT NOT NULL, "subject" TEXT NOT NULL, "body" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'PENDING', "lastError" TEXT,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "sentAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "EmailJob_dedupeKey_key" ON "EmailJob"("dedupeKey");
CREATE INDEX IF NOT EXISTS "EmailJob_status_availableAt_idx" ON "EmailJob"("status", "availableAt");
CREATE UNIQUE INDEX IF NOT EXISTS "Order_receiptTokenHash_key" ON "Order"("receiptTokenHash");
