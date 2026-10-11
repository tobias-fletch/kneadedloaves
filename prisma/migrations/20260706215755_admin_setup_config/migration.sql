-- CreateTable
CREATE TABLE "AppConfig" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "secret" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("key")
);
