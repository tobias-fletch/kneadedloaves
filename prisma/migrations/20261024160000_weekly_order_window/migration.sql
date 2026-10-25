-- Weekly order window. Additive only: two NEW tables, nothing existing is altered or rewritten.
-- With no WeeklyOrderSchedule row (the state right after this migration), the site keeps using
-- the existing one-off OrderWindow rows exactly as before. Older app builds ignore these tables.
CREATE TABLE IF NOT EXISTS "WeeklyOrderSchedule" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "windowName" TEXT NOT NULL DEFAULT 'Weekly Bake',
    "openWeekday" INTEGER NOT NULL DEFAULT 1,
    "openTime" TEXT NOT NULL DEFAULT '09:00',
    "closeWeekday" INTEGER NOT NULL DEFAULT 6,
    "closeTime" TEXT NOT NULL DEFAULT '21:00',
    "fulfillmentWeekday" INTEGER NOT NULL DEFAULT 0,
    "maxOrders" INTEGER,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "pauseMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WeeklyOrderSchedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WeeklyOrderWeek" (
    "weekKey" TEXT NOT NULL,
    "orderWindowId" TEXT,
    "overrideOpensAt" TIMESTAMP(3),
    "overrideClosesAt" TIMESTAMP(3),
    "overrideFulfillmentDate" TIMESTAMP(3),
    "skip" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WeeklyOrderWeek_pkey" PRIMARY KEY ("weekKey")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WeeklyOrderWeek_orderWindowId_key" ON "WeeklyOrderWeek"("orderWindowId");

-- The foreign key lives on the new (empty) table; OrderWindow itself gets no new column.
ALTER TABLE "WeeklyOrderWeek" ADD CONSTRAINT "WeeklyOrderWeek_orderWindowId_fkey" FOREIGN KEY ("orderWindowId") REFERENCES "OrderWindow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
