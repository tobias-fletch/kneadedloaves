BEGIN;
-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "checkoutKeyHash" TEXT,
ADD COLUMN     "checkoutPayloadHash" TEXT,
ADD COLUMN     "checkoutRequestHash" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fulfillmentLocation" TEXT,
ADD COLUMN     "paymentDestination" TEXT,
ADD COLUMN     "paymentDueAt" TIMESTAMP(3),
ADD COLUMN     "paymentHandle" TEXT,
ADD COLUMN     "paymentMethod" TEXT,
ADD COLUMN     "paymentReference" TEXT,
ADD COLUMN     "paymentReviewRequestedAt" TIMESTAMP(3),
ADD COLUMN     "paymentState" TEXT NOT NULL DEFAULT 'UNPAID',
ADD COLUMN     "paymentVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "paymentVerifiedBy" TEXT,
ADD COLUMN     "providerTransactionId" TEXT,
ADD COLUMN     "verifiedAmountCents" INTEGER;

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "amountCents" INTEGER,
    "currency" TEXT,
    "providerTransactionId" TEXT,
    "receivedAt" TIMESTAMP(3),
    "note" TEXT,
    "restock" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_providerTransactionId_key" ON "PaymentEvent"("providerTransactionId");

-- CreateIndex
CREATE INDEX "PaymentEvent_orderId_createdAt_idx" ON "PaymentEvent"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_paymentReference_key" ON "Order"("paymentReference");

-- CreateIndex
CREATE UNIQUE INDEX "Order_providerTransactionId_key" ON "Order"("providerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_checkoutKeyHash_key" ON "Order"("checkoutKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "Order_checkoutRequestHash_key" ON "Order"("checkoutRequestHash");

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


COMMIT;
