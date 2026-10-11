import { createHash } from "crypto";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function Receipt({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string }> }) {
  const { id } = await params;
  const { token } = await searchParams;
  const session = await getSession();
  const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
  const validToken = token && /^[a-f0-9]{64}$/.test(token) && order?.receiptTokenHash === createHash("sha256").update(token).digest("hex");
  if (!order || (!validToken && session?.sub !== order.userId && session?.role !== "ADMIN")) notFound();
  return <main className="section"><div className="panel p-5"><h1 className="text-2xl font-black">Your order</h1><p>Order #{order.id.slice(-6).toUpperCase()} · {order.status.replaceAll("_", " ")}</p>{order.status === "PENDING" && <p>Payment has not been confirmed.</p>}<ul className="my-4">{order.items.map(item => <li key={item.id}>{item.quantity} × {item.productName}</li>)}</ul><p>Total: {formatMoney(order.totalCents)}</p><p>{order.fulfillmentInstructions}</p><p className="mt-4 text-sm">Keep this private link to check your order status.</p></div></main>;
}
