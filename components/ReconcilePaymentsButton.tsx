"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function ReconcilePaymentsButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  return <div><button className="btn-secondary" type="button" disabled={busy} onClick={async () => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/payments/reconcile", { method: "POST" });
      const result = await response.json();
      setMessage(response.ok ? `Payment check finished. ${result.unresolved} expired or uncertain reservations still need review.` : result.error);
      router.refresh();
    } catch { setMessage("Payment check could not finish. Please retry."); }
    finally { setBusy(false); }
  }}>{busy ? "Checking payments..." : "Check pending payments"}</button>{message ? <p className="mt-2 text-sm" role="status">{message}</p> : null}</div>;
}
