-- Additional payment on an order that already has one recorded payment.
-- Additive only: one new table. No existing table, column, or row is changed.
CREATE TABLE IF NOT EXISTS "AdminPaymentTopUp" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminPaymentTopUp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdminPaymentTopUp_paymentId_key" ON "AdminPaymentTopUp"("paymentId");
CREATE INDEX IF NOT EXISTS "AdminPaymentTopUp_orderId_createdAt_idx" ON "AdminPaymentTopUp"("orderId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "AdminPaymentTopUp" ADD CONSTRAINT "AdminPaymentTopUp_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AdminPaymentTopUp" ADD CONSTRAINT "AdminPaymentTopUp_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "AdminPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
