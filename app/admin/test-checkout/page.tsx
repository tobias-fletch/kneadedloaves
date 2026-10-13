import { requireAdmin } from "@/lib/auth";
import { CheckoutTrial } from "@/components/CheckoutTrial";
export const dynamic = "force-dynamic";
export const metadata = { title: "Test checkout · Kneaded Loaves", robots: { index: false, follow: false } };
export default async function TestCheckoutPage() {
  await requireAdmin();
  return <CheckoutTrial />;
}
