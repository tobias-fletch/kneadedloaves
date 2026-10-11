-- Additive migration. Back up and test against a copy before applying to shop data.
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'PAYPAL');
CREATE TYPE "PaymentState" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'REVIEW');
ALTER TABLE "Order"
 ADD COLUMN "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "taxCents" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "paymentProvider" "PaymentProvider",
 ADD COLUMN "paymentState" "PaymentState" NOT NULL DEFAULT 'PENDING',
 ADD COLUMN "providerPaymentId" TEXT,
 ADD COLUMN "paypalOrderId" TEXT,
 ADD COLUMN "paymentUrl" TEXT,
 ADD COLUMN "providerRequest" TEXT,
 ADD COLUMN "paymentReviewReason" TEXT,
 ADD COLUMN "checkoutKey" TEXT,
 ADD COLUMN "checkoutPayloadHash" TEXT,
 ADD COLUMN "checkoutCartId" TEXT,
 ADD COLUMN "reservationExpiresAt" TIMESTAMP(3),
 ADD COLUMN "paidAt" TIMESTAMP(3),
 ADD COLUMN "refundedCents" INTEGER NOT NULL DEFAULT 0;
-- Preserve legacy fulfillment state; do not imply legacy payments were provider-verified.
UPDATE "Order" SET "paymentState" = 'REVIEW' WHERE "status" NOT IN ('PENDING', 'CANCELLED');
CREATE UNIQUE INDEX "Order_stripeCheckoutSessionId_key" ON "Order"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX "Order_providerPaymentId_key" ON "Order"("providerPaymentId");
CREATE UNIQUE INDEX "Order_paypalOrderId_key" ON "Order"("paypalOrderId");
CREATE UNIQUE INDEX "Order_checkoutKey_key" ON "Order"("checkoutKey");
CREATE INDEX "Order_reservationExpiresAt_idx" ON "Order"("reservationExpiresAt");
CREATE TABLE "PaymentEvent" (
 "id" TEXT NOT NULL,
 "provider" "PaymentProvider" NOT NULL,
 "eventType" TEXT NOT NULL,
 "orderId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "PaymentEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
