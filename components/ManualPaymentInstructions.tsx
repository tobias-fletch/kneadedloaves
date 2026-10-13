"use client";
import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { browserCheckoutStorage, clearCheckoutAttemptForOrder } from "@/lib/checkout-recovery-client";
type Props = { orderId: string; token?: string; status: string; paymentState: string; totalCents: number; currency: string; reference: string | null; destination: string | null; handle: string | null; dueAt: string | null; deadlinePassed: boolean; reviewRequestedAt: string | null };
function safeVenmoDestination(value: string | null) {
  try { if (!value) return null; const url = new URL(value); return url.protocol === "https:" && ["venmo.com", "www.venmo.com", "account.venmo.com"].includes(url.hostname) && !url.username && !url.password && !url.port && url.pathname !== "/" ? url.href : null; } catch { return null; }
}
export function ManualPaymentInstructions(props: Props) {
  const router = useRouter();
  const [expired, setExpired] = useState(props.deadlinePassed), [requested, setRequested] = useState(Boolean(props.reviewRequestedAt));
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [recoveryNotice, setRecoveryNotice] = useState("");
  const submittingRef = useRef(false);
  const verified = props.paymentState === "VERIFIED", refunded = props.paymentState === "REFUNDED", stopped = props.status === "CANCELLED" || expired;
  const destination = safeVenmoDestination(props.destination);
  const mayPay = props.status === "PENDING" && !stopped && !verified && !refunded && !requested && props.paymentState !== "REVIEW";
  useEffect(() => {
    function finishRecovery() {
      try { clearCheckoutAttemptForOrder(browserCheckoutStorage(), props.orderId); setRecoveryNotice(""); }
      catch { setRecoveryNotice("Your order is saved. This browser could not finish resetting checkout. Keep this private receipt link; contact the bakery if checkout keeps returning to this order."); }
    }
    // The server authorizes the private receipt before this component can mount.
    finishRecovery(); window.addEventListener("pageshow", finishRecovery);
    return () => window.removeEventListener("pageshow", finishRecovery);
  }, [props.orderId]);
  useEffect(() => { setRequested(Boolean(props.reviewRequestedAt)); }, [props.reviewRequestedAt]);
  useEffect(() => {
    if (!props.dueAt) return;
    const deadline = new Date(props.dueAt).getTime();
    if (!Number.isFinite(deadline)) return;
    let timer: ReturnType<typeof setTimeout>;
    function check() { const remaining = deadline - Date.now(); if (remaining <= 0) setExpired(true); else timer = setTimeout(check, Math.min(remaining + 1, 2_147_483_647)); }
    check(); return () => clearTimeout(timer);
  }, [props.dueAt]);
  async function requestReview() {
    if (submittingRef.current || requested) return;
    submittingRef.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/orders/${props.orderId}/payment-review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: props.token }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "We could not request a payment check. Please try again.");
      setRequested(true); setMessage("Payment check requested. Your payment is still unverified until the bakery checks its Venmo account. This does not extend the reservation deadline."); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "We could not request a payment check. Please try again."); }
    finally { submittingRef.current = false; setBusy(false); }
  }
  return <section className="border-2 border-ink bg-crumb p-4 sm:p-5" aria-labelledby="payment-heading">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="payment-heading" className="font-display text-2xl uppercase tracking-wide">Venmo payment</h2><span className="badge bg-page">{refunded ? "Refund recorded" : verified ? "Payment verified" : requested || props.paymentState === "REVIEW" ? "Payment review" : "Payment unverified"}</span></div>
    {refunded ? <p className="mt-3">The bakery has recorded a refund sent through Venmo. Check your Venmo account for the refund. Do not send another payment for this order.</p> : verified ? <p className="mt-3">The bakery has checked and verified your payment. You do not need to pay again.</p> : <>
      {stopped ? <p className="mt-3 border-2 border-ink bg-page p-3 font-bold">{props.status === "CANCELLED" ? "This order is cancelled." : "The payment deadline has passed."} Do not send a new payment. If you already paid, request a payment check below. A late payment does not reopen the order.</p> : requested || props.paymentState === "REVIEW" ? <p className="mt-3 font-bold">The bakery needs to check this payment. Do not pay again while it is being reviewed. A review request is not payment confirmation.</p> : <p className="mt-3">Your order is awaiting payment. Payment must be checked by the bakery before the deadline to keep this reservation. Send the exact amount to the saved Venmo destination and request a check promptly after paying.</p>}
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <div><dt className="text-xs font-black uppercase tracking-widest">Order total</dt><dd className="mt-1 text-2xl font-black">{formatMoney(props.totalCents)} <span className="text-sm">{props.currency}</span></dd></div>
        <div><dt className="text-xs font-black uppercase tracking-widest">Payment deadline</dt><dd className="mt-1 font-bold">{props.dueAt ? <time dateTime={props.dueAt}>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(props.dueAt))} UTC</time> : "No payment deadline recorded. Contact the bakery before paying."}</dd></div>
        <div className="sm:col-span-2"><dt className="text-xs font-black uppercase tracking-widest">Payment note / reference</dt><dd className="mt-1 break-all border-2 border-ink bg-page p-3 font-mono text-lg font-bold">{props.reference ?? "No reference recorded. Contact the bakery before paying."}</dd><p className="mt-1 text-sm">Include the full reference in your Venmo payment note. Do not include this private receipt link.</p></div>
        <div className="sm:col-span-2"><dt className="text-xs font-black uppercase tracking-widest">Saved recipient</dt><dd className="mt-1 break-all font-bold">{props.handle ?? "Recipient details unavailable"}</dd></div>
      </dl>
      {mayPay && destination && props.reference && props.dueAt ? <div className="mt-4 space-y-2"><a className="btn-primary w-full sm:w-auto" href={destination} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer">Open bakery Venmo</a><p className="text-xs">Opens Venmo in a new tab. Check the recipient, enter {formatMoney(props.totalCents)} {props.currency}, and add the full reference above. Opening Venmo does not make a payment.</p></div> : mayPay ? <p className="mt-4 border-2 border-ink bg-page p-3 font-bold">Payment details are incomplete. Contact the bakery before paying.</p> : null}
      <div className="mt-5 border-t-2 border-ink pt-4"><p className="mb-3 text-sm">Already sent payment? Ask the bakery to check its Venmo account. This button does not charge you, verify payment, extend the deadline, or change a cancelled order.</p><button className="btn-secondary w-full sm:w-auto" type="button" onClick={requestReview} disabled={busy || requested}>{busy ? "Requesting payment check..." : requested ? "Payment check requested" : "I sent payment · Request a check"}</button></div>
    </>}
    {message ? <p role="status" aria-live="polite" className="mt-3 border-2 border-ink bg-page p-3 text-sm font-bold">{message}</p> : null}
    {recoveryNotice ? <p role="status" className="mt-3 text-sm">{recoveryNotice}</p> : null}
  </section>;
}
