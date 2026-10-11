"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
export function PaymentStatus({ orderId, receiptToken, paypalApproved, pending }: { orderId: string; receiptToken: string; paypalApproved: boolean; pending: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!pending) { try { sessionStorage.removeItem("bakery-checkout-attempt"); } catch { /* Browser storage is optional. */ } window.dispatchEvent(new Event("cart:updated")); return; }
    if (!paypalApproved) return;
    let active = true;
    fetch("/api/payments/paypal/capture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, receiptToken }) }).then(async response => {
      const result = await response.json();
      if (!active) return;
      if (!response.ok) setMessage(result.error || "Payment is still being checked.");
      router.refresh();
    }).catch(() => { if (active) setMessage("Payment is still being checked. Refresh before creating another order."); });
    return () => { active = false; };
  }, [orderId, receiptToken, paypalApproved, pending, router]);
  return <div className="mt-4 space-y-2">{message ? <p role="status">{message}</p> : null}{pending ? <button type="button" className="btn-secondary" onClick={() => router.refresh()}>Refresh payment status</button> : null}</div>;
}
