ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "receiptTokenHash" TEXT;
ALTER TABLE "Order" ADD COLUMN "inventoryRestored" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "Order_receiptTokenHash_key" ON "Order"("receiptTokenHash");
CREATE TABLE "RateLimit" ("key" TEXT PRIMARY KEY, "count" INTEGER NOT NULL DEFAULT 1, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "RateLimit_expiresAt_idx" ON "RateLimit"("expiresAt");
CREATE TABLE "PasswordReset" ("tokenHash" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "PasswordReset_expiresAt_idx" ON "PasswordReset"("expiresAt");
CREATE TABLE "EmailJob" (
  "id" TEXT PRIMARY KEY, "dedupeKey" TEXT NOT NULL, "to" TEXT NOT NULL, "subject" TEXT NOT NULL, "body" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'PENDING', "lastError" TEXT,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "sentAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "EmailJob_dedupeKey_key" ON "EmailJob"("dedupeKey");
CREATE INDEX "EmailJob_status_availableAt_idx" ON "EmailJob"("status", "availableAt");
