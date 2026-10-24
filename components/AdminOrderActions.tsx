"use client";
import React, { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
type Props = { orderId: string; status: string; paymentMethod: string | null; paymentState: string; totalCents: number; currency: string; reference: string | null; dueAt: string | null; fulfillmentType: string; hasPaymentEvidence: boolean; hasPaymentDiscrepancy: boolean; inventoryRestored: boolean };
type PaymentAction = "verify" | "review" | "refund";
const nextStatuses: Record<string, string[]> = { PENDING: ["CANCELLED"], PAID: ["PREPARING"], PREPARING: ["READY"], READY: ["OUT_FOR_DELIVERY", "COMPLETED"], OUT_FOR_DELIVERY: ["COMPLETED"], COMPLETED: [], CANCELLED: [] };
function parseAmount(value: string) { if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null; const [whole, fraction = ""] = value.split("."); const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0")); return Number.isSafeInteger(cents) && cents > 0 ? cents : null; }
export function AdminOrderActions(props: Props) {
  const router = useRouter();
  const canVerify = props.status === "PENDING" && !props.hasPaymentDiscrepancy && !props.inventoryRestored && ["UNPAID", "REVIEW"].includes(props.paymentState) && Boolean(props.dueAt && new Date(props.dueAt).getTime() > Date.now());
  const canRefund = ["VERIFIED", "REVIEW"].includes(props.paymentState) && props.hasPaymentEvidence;
  const canReview = props.paymentMethod === "VENMO";
  const [action, setAction] = useState<PaymentAction>(canVerify ? "verify" : props.status === "COMPLETED" && canRefund ? "refund" : "review");
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [message, setMessage] = useState("");
  const submittingRef = useRef(false);
  const allowedStatuses = (nextStatuses[props.status] ?? []).filter(status => (status !== "OUT_FOR_DELIVERY" || props.fulfillmentType === "DELIVERY") && (status === "CANCELLED" || props.paymentMethod !== "VENMO" || props.paymentState === "VERIFIED"));
  async function mutate(url: string, method: "POST" | "PATCH", payload: object, success: string) {
    if (submittingRef.current || saved) return;
    submittingRef.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save this change. Check the details and try again.");
      setSaved(true); setMessage(success); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save this change. Please try again."); }
    finally { submittingRef.current = false; setBusy(false); }
  }
  async function submitPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submittingRef.current || saved) return;
    const form = new FormData(event.currentTarget), amountCents = parseAmount(String(form.get("amount") ?? "").trim()), currency = String(form.get("currency") ?? "").trim().toUpperCase(), date = new Date(String(form.get("receivedAt") ?? ""));
    if (amountCents === null || !/^[A-Z]{3}$/.test(currency) || !Number.isFinite(date.getTime())) { setMessage("Enter a positive amount with no more than two decimal places, a three-letter currency, and a valid transaction date."); return; }
    if (action === "verify" && (amountCents !== props.totalCents || currency !== props.currency)) { setMessage("The received amount and currency must exactly match the order to mark it paid. Choose ‘Record payment issue / late payment’ to save different payment evidence."); return; }
    await mutate(`/api/admin/orders/${props.orderId}/payment`, "POST", { action, amountCents, currency, providerTransactionId: String(form.get("providerTransactionId") ?? "").trim(), receivedAt: date.toISOString(), attested: form.get("attested") === "on", restock: form.get("restock") === "true", note: String(form.get("note") ?? "").trim() || undefined }, action === "verify" ? "Payment verified and order marked paid." : action === "refund" ? "External refund recorded. No money was sent by this app." : "Payment issue recorded for review. This does not mark the order paid or reopen it.");
  }
  return <div className="mt-3 space-y-3 border-t-2 border-ink/20 pt-3 print:hidden">
    {props.paymentMethod === "VENMO" && (canVerify || canReview || canRefund) ? <details className="border-2 border-ink bg-crumb p-3"><summary className="cursor-pointer font-black uppercase tracking-wide">Reconcile Venmo payment</summary><div className="mt-3 space-y-3">
      <p className="text-sm">Check the bakery’s Venmo account independently. A customer’s message or screenshot is not proof that money arrived. These controls record checks and refunds completed in Venmo; they do not move money.</p>
      <p className="text-sm font-bold">Expected: {formatMoney(props.totalCents)} {props.currency}. Reference: <span className="break-all font-mono">{props.reference ?? "No reference recorded"}</span></p>
      {!canVerify ? <p className="border-2 border-ink bg-page p-3 text-sm font-bold">This order cannot be marked paid here in its current state. Record late or mismatched payments for review. Cancelled and expired orders stay closed.</p> : null}
      <form onSubmit={submitPayment} className="space-y-3"><fieldset key={action} disabled={busy || saved} className="space-y-3 disabled:opacity-60">
        <label className="block">Action<select value={action} onChange={event => { setAction(event.target.value as PaymentAction); setMessage(""); }}>{canVerify ? <option value="verify">Verify exact payment and mark paid</option> : null}{canReview ? <option value="review">Record payment issue / late payment</option> : null}{canRefund ? <option value="refund">Record a refund already sent in Venmo</option> : null}</select></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block">{action === "refund" ? "Amount refunded" : "Amount actually received"}<input name="amount" type="text" inputMode="decimal" placeholder="0.00" pattern="[0-9]+(\.[0-9]{1,2})?" required /></label><label className="block">Currency<input name="currency" defaultValue={props.currency} pattern="[A-Za-z]{3}" minLength={3} maxLength={3} required /></label></div>
        <label className="block">{action === "refund" ? "Venmo refund transaction ID" : "Venmo payment transaction ID"}<input name="providerTransactionId" autoComplete="off" minLength={3} maxLength={160} pattern="[A-Za-z0-9_\-]+" title="Use the provider transaction ID: letters, numbers, underscores, or hyphens." required /></label>
        <label className="block">{action === "refund" ? "Refund sent at" : "Payment received at"} (your local time)<input name="receivedAt" type="datetime-local" step="1" required /></label>
        <label className="block">{action === "review" ? "Issue / review notes" : action === "refund" ? "Refund reason / notes" : "Notes (optional)"}<textarea name="note" rows={2} maxLength={1000} required={action !== "verify"} /></label>
        {action === "refund" ? <><p className="text-sm">Record only a refund already completed in Venmo. Refunds block further fulfillment for this order. Partial refunds leave the payment under review.</p>{props.inventoryRestored ? <><input type="hidden" name="restock" value="false" /><p className="text-sm font-bold">Inventory was already returned to stock. This refund will not add it again.</p></> : <label className="block">Inventory decision<select name="restock" defaultValue="" required><option value="" disabled>Choose whether to return items to stock</option><option value="false">No · Do not return items to stock</option><option value="true">Yes · Items can still be sold; return them to stock</option></select></label>}</> : null}
        <label className="flex items-start gap-3 border-2 border-ink bg-page p-3 text-sm normal-case tracking-normal"><input className="mt-1 h-4 w-4 shrink-0" type="checkbox" name="attested" required /><span>{action === "refund" ? "I independently checked the completed refund in the bakery’s Venmo account and confirmed its recipient, amount, currency, transaction ID, and date." : action === "verify" ? "I independently checked the completed payment in the bakery’s Venmo account and confirmed the recipient, exact amount and currency, full order reference, transaction ID, and receipt date." : "I independently checked this payment evidence in the bakery’s Venmo account. The amount, currency, transaction ID, and date entered match that evidence."}</span></label>
        <button className="btn-primary" type="submit">{busy ? "Saving..." : action === "verify" ? "Verify payment · Mark paid" : action === "refund" ? "Record external refund" : "Save for review"}</button>
      </fieldset></form>
    </div></details> : null}
    {allowedStatuses.length ? <form onSubmit={event => { event.preventDefault(); void mutate(`/api/admin/orders/${props.orderId}`, "PATCH", { status: String(new FormData(event.currentTarget).get("status")) }, "Order status updated."); }} className="space-y-3"><fieldset disabled={busy || saved} className="space-y-3 disabled:opacity-60"><label className="block">Next order status<select name="status" required>{allowedStatuses.map(status => <option key={status} value={status}>{status === "CANCELLED" ? "Cancel pending order and release inventory" : status.replaceAll("_", " ")}</option>)}</select></label>{props.status === "PENDING" ? <label className="flex items-start gap-3 text-sm normal-case tracking-normal"><input className="mt-1 h-4 w-4 shrink-0" type="checkbox" required /><span>I want to cancel this pending order. This releases its reserved stock and does not send a refund.</span></label> : null}<button className="btn-secondary" type="submit">{busy ? "Saving..." : props.status === "PENDING" ? "Cancel order" : "Update fulfillment status"}</button></fieldset></form> : props.paymentMethod === "VENMO" && props.paymentState === "REVIEW" && !["CANCELLED", "COMPLETED"].includes(props.status) ? <p className="text-sm font-bold">Fulfillment is on hold while payment needs review.</p> : null}
    {message ? <p role={saved ? "status" : "alert"} aria-live="polite" className="border-2 border-ink bg-crumb p-3 text-sm font-bold">{message}</p> : null}
  </div>;
}
