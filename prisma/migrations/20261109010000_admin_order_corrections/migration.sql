-- Admin quantity corrections and recorded payments (one payment may cover several orders).
-- Additive only: new tables. No existing table, column, or row is changed.
-- Order windows, including kl-text-window-20261108 and kl-text-window-20261113, are not touched.
CREATE TABLE IF NOT EXISTS "AdminPayment" (
    "id" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "method" TEXT NOT NULL,
    "providerTransactionId" TEXT,
    "note" TEXT,
    "actorId" TEXT NOT NULL,
    "actorEmail" TEXT,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdminPayment_providerTransactionId_key" ON "AdminPayment"("providerTransactionId");

CREATE TABLE IF NOT EXISTS "AdminPaymentOrder" (
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    CONSTRAINT "AdminPaymentOrder_pkey" PRIMARY KEY ("orderId")
);

CREATE INDEX IF NOT EXISTS "AdminPaymentOrder_paymentId_idx" ON "AdminPaymentOrder"("paymentId");

CREATE TABLE IF NOT EXISTS "AdminOrderAudit" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "actorId" TEXT NOT NULL,
    "actorEmail" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminOrderAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AdminOrderAudit_orderId_createdAt_idx" ON "AdminOrderAudit"("orderId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminOrderAudit_paymentId_idx" ON "AdminOrderAudit"("paymentId");

DO $$ BEGIN
  ALTER TABLE "AdminPaymentOrder" ADD CONSTRAINT "AdminPaymentOrder_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "AdminPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AdminPaymentOrder" ADD CONSTRAINT "AdminPaymentOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AdminOrderAudit" ADD CONSTRAINT "AdminOrderAudit_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AdminOrderAudit" ADD CONSTRAINT "AdminOrderAudit_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "AdminPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
