import { PrismaClient } from "@prisma/client";
import { prismaDatasourceUrl } from "@/lib/preview-database";

// Vercel previews connect only to their own scrubbed Neon branch (Hub #113);
// production and local development keep using DATABASE_URL unchanged.
const datasourceUrl = prismaDatasourceUrl(process.env);

const createClient = () => new PrismaClient({
  ...(datasourceUrl ? { datasourceUrl } : {}),
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  // Hub #63 distance columns are omitted from every default read and RETURNING
  // clause so the app keeps working on a database where the additive migration
  // has not run yet (previews share the production DB and never migrate). Read
  // them only with an explicit select after hasDeliveryDistanceColumns().
  omit: { order: { deliveryDistanceMiles: true, deliveryDistanceVerified: true } }
});

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Typed as the plain client so existing Prisma.TransactionClient helpers keep
// compiling. At runtime, default Order reads do not include the two omitted fields.
export const prisma: PrismaClient = globalForPrisma.prisma ?? (createClient() as unknown as PrismaClient);

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
