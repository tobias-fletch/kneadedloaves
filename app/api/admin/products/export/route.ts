import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { exportCatalog } from "@/lib/catalog-export";

export async function GET() {
  await requireAdmin();
  const catalog = await prisma.$transaction(tx => exportCatalog(tx), { isolationLevel: "RepeatableRead" });
  return NextResponse.json(catalog, { headers: {
    "Content-Disposition": 'attachment; filename="kneaded-loaves-catalog.json"',
    "Cache-Control": "private, no-store"
  } });
}
