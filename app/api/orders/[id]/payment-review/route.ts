import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lockOrder } from "@/lib/manual-payments";
import { rateLimit, readJson } from "@/lib/request";
import { queueEmail } from "@/lib/email-queue";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await rateLimit(request, "payment-review", 20)) return NextResponse.json({ error: "Please wait before trying again." }, { status: 429 });
  const session = await getSession();
  const body = await readJson(request) as { token?: unknown } | null;
  const { id } = await params;
  try {
    await prisma.$transaction(async tx => {
      const order = await lockOrder(tx, id);
      const validToken = typeof body?.token === "string" && /^[a-f0-9]{64}$/.test(body.token) && createHash("sha256").update(body.token).digest("hex") === order.receiptTokenHash;
      if (!validToken && (!session || (session.sub !== order.userId && session.role !== "ADMIN"))) throw new Error("Not found");
      if (order.paymentMethod !== "VENMO" || ["VERIFIED", "REFUNDED"].includes(order.paymentState)) return;
      if (order.paymentReviewRequestedAt) return;
      await tx.order.update({ where: { id }, data: { paymentReviewRequestedAt: new Date(), paymentState: "REVIEW" } });
      await tx.paymentEvent.create({ data: { orderId: id, type: "CUSTOMER_REVIEW", actorId: session?.sub, note: "Customer reports payment; no payment has been verified." } });
      const settings = await tx.adminSettings.findFirst();
      if (settings?.emailNotificationsEnabled && settings.notificationEmail) await queueEmail({ dedupeKey: `payment-review:${id}`, to: settings.notificationEmail, subject: "Bakery payment needs review", body: `Customer requested payment review for ${order.paymentReference}. Independently inspect Venmo before marking paid. Customer attestation is not payment proof.` }, tx);
    });
    return NextResponse.json({ message: "Review requested. Payment has not been verified; this does not extend your reservation deadline." });
  } catch { return NextResponse.json({ error: "Order not found or unavailable." }, { status: 404 }); }
}
