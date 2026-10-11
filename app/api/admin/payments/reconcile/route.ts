import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { reconcilePayments } from "@/lib/payment-reconciliation";
export const runtime = "nodejs";
export async function POST() {
  await requireAdmin();
  try { return NextResponse.json(await reconcilePayments()); }
  catch { return NextResponse.json({ error: "Reconciliation could not finish. Check provider configuration and retry; reserved stock was kept safe." }, { status: 502 }); }
}
