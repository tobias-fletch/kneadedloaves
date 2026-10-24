"use client";
import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { PickupLocation } from "@prisma/client";
import { AdminOrderingBanner } from "@/components/OrderingStatus";
import { browserCheckoutStorage, CheckoutStorageError, prepareCheckoutAttempt, receiptDestination, recoverCheckoutAttempt, rememberCheckoutOrder } from "@/lib/checkout-recovery-client";
import { ORDERING_UNAVAILABLE_MESSAGE } from "@/lib/config-messages";
import { describePickup } from "@/lib/pickup-location";
import { DELIVERY_FEE_COPY, type PublicDeliveryQuote } from "@/lib/delivery-pricing";
import { formatMoney } from "@/lib/money";

export function CheckoutForm({ pickupLocations, framed = true, hasCartItems = true, checkoutReady = true, adminTestMode = false, adminSetupReasons = [], contactEmail = "" }: { pickupLocations: PickupLocation[]; framed?: boolean; hasCartItems?: boolean; checkoutReady?: boolean; adminTestMode?: boolean; adminSetupReasons?: string[]; contactEmail?: string }) {
  const [fulfillmentValue, setFulfillmentValue] = useState<"DELIVERY" | "PICKUP">(pickupLocations.length ? "PICKUP" : "DELIVERY");
  const [message, setMessage] = useState("");
  const [showSignInNudge, setShowSignInNudge] = useState(true);
  const [phase, setPhase] = useState<"checking" | "ready" | "submitting" | "blocked" | "navigating">("checking");
  const [hasSavedAttempt, setHasSavedAttempt] = useState(false);
  const submittingRef = useRef(false), generationRef = useRef(0), idempotencyKeyRef = useRef<string | null>(null);
  const fulfillment = fulfillmentValue, setFulfillment = setFulfillmentValue;
  // Delivery is priced by distance (server-side); every active order window can deliver.
  const canFulfill = true;
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryZip, setDeliveryZip] = useState("");
  const [quote, setQuote] = useState<PublicDeliveryQuote | null>(null);
  const [quoteState, setQuoteState] = useState<"idle" | "loading" | "error">("idle");
  const quoteRequestRef = useRef(0);
  const quoteKey = `${deliveryAddress.trim()}|${deliveryZip.trim()}`;
  const [quotedKey, setQuotedKey] = useState("");
  const checkDeliveryFee = useCallback(async () => {
    if (!deliveryAddress.trim() || !/^\d{5}$/.test(deliveryZip.trim())) { setQuote(null); setQuoteState("error"); return; }
    const request = ++quoteRequestRef.current, key = `${deliveryAddress.trim()}|${deliveryZip.trim()}`;
    setQuoteState("loading");
    try {
      const response = await fetch("/api/delivery-quote", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deliveryAddress, deliveryZip }) });
      const body = await response.json();
      if (request !== quoteRequestRef.current) return;
      if (!response.ok) { setQuote({ feeCents: null, inRange: false, message: body.error ?? "We couldn't check delivery right now. Please try again." }); setQuoteState("idle"); setQuotedKey(""); return; }
      setQuote({ feeCents: body.feeCents ?? null, inRange: Boolean(body.inRange), message: String(body.message ?? "") }); setQuotedKey(key); setQuoteState("idle");
    } catch {
      if (request !== quoteRequestRef.current) return;
      setQuote({ feeCents: null, inRange: false, message: "We couldn't check delivery right now. Please try again." }); setQuoteState("idle"); setQuotedKey("");
    }
  }, [deliveryAddress, deliveryZip]);
  const quoteCurrent = quote !== null && quotedKey === quoteKey;
  const deliveryBlocked = fulfillment === "DELIVERY" && quoteCurrent && !quote.inRange;
  const invalidatePendingWork = useCallback(() => { generationRef.current++; submittingRef.current = false; }, []);
  const checkSavedCheckout = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    const generation = ++generationRef.current;
    setPhase("checking"); setMessage("");
    try {
      const result = await recoverCheckoutAttempt(browserCheckoutStorage(), fetch);
      if (generation !== generationRef.current) return;
      if (result.state === "empty") { idempotencyKeyRef.current = null; setHasSavedAttempt(false); setPhase("ready"); }
      else {
        idempotencyKeyRef.current = result.attempt.idempotencyKey; setHasSavedAttempt(true);
        if (result.state === "found") { setPhase("navigating"); window.location.assign(result.url); }
        else { setPhase("ready"); setMessage("We could not find an order for your saved checkout yet. You can retry with the same details or check again."); }
      }
    } catch (error) {
      if (generation !== generationRef.current) return;
      setPhase("blocked");
      setMessage(error instanceof Error && !(error instanceof TypeError) ? error.message : "Your saved checkout could not be checked. Keep this tab open and retry the check before placing another order.");
    } finally { if (generation === generationRef.current) submittingRef.current = false; }
  }, []);
  useEffect(() => {
    void checkSavedCheckout();
    function onPageShow(event: PageTransitionEvent) { if (event.persisted) invalidatePendingWork(); void checkSavedCheckout(); }
    window.addEventListener("pageshow", onPageShow);
    return () => { window.removeEventListener("pageshow", onPageShow); invalidatePendingWork(); };
  }, [checkSavedCheckout, invalidatePendingWork]);
  async function submit(formData: FormData) {
    if (submittingRef.current || phase !== "ready" || !hasCartItems || !checkoutReady) return;
    submittingRef.current = true;
    const generation = ++generationRef.current;
    setPhase("submitting"); setMessage("");
    try {
      const attempt = prepareCheckoutAttempt(browserCheckoutStorage(), () => idempotencyKeyRef.current ??= crypto.randomUUID());
      idempotencyKeyRef.current = attempt.idempotencyKey; setHasSavedAttempt(true);
      const response = await fetch("/api/checkout", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.idempotencyKey }, body: JSON.stringify(Object.fromEntries(formData.entries())) });
      const body = await response.json();
      if (generation !== generationRef.current) return;
      if (response.ok) {
        const url = receiptDestination(body.url, body.orderId);
        rememberCheckoutOrder(browserCheckoutStorage(), attempt.idempotencyKey, body.orderId);
        setPhase("navigating"); window.location.assign(url); return;
      }
      setPhase(response.status >= 500 || response.status === 429 ? "blocked" : "ready");
      setMessage(body.error ?? "Checkout could not be completed. Retry with the same details.");
    } catch (error) {
      if (generation !== generationRef.current) return;
      setPhase("blocked"); setMessage(error instanceof CheckoutStorageError ? error.message : "Checkout was interrupted. Check your saved checkout before trying again so you do not place a duplicate order.");
    } finally { if (generation === generationRef.current) submittingRef.current = false; }
  }
  if (!hasCartItems && phase === "ready" && !hasSavedAttempt) return null;
  return <form onSubmit={event => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }} className={`${framed ? "panel p-4" : "border-t-2 border-ink pt-4"} space-y-4`}>
    {adminTestMode || adminSetupReasons.length > 0 ? <AdminOrderingBanner testMode={adminTestMode} reasons={adminSetupReasons} /> : null}
    {!checkoutReady && adminSetupReasons.length === 0 ? <p className="border-2 border-ink bg-jam p-3 text-sm font-black" role="status">{ORDERING_UNAVAILABLE_MESSAGE}{contactEmail ? <> <Link className="underline" href="/contact">Send us a message</Link> or email {contactEmail}.</> : null}</p> : null}
    {hasCartItems ? <fieldset disabled={phase !== "ready" || !checkoutReady} className="space-y-4">
      <h2 className="font-display text-2xl uppercase tracking-wide">Checkout</h2>
      {showSignInNudge ? <p className="flex items-start justify-between gap-3 border-2 border-ink bg-crumb p-3 text-sm font-medium"><span>Have an account? <Link href="/login" className="font-black underline">Sign in</Link> to link this order to it. Checkout works fine as a guest.</span><button type="button" aria-label="Dismiss" onClick={() => setShowSignInNudge(false)} className="shrink-0 px-1 text-lg font-black">&times;</button></p> : null}
      <div className="grid gap-3 sm:grid-cols-2"><div><label htmlFor="checkout-name">Name</label><input id="checkout-name" name="customerName" autoComplete="name" required /></div><div><label htmlFor="checkout-email">Email</label><input id="checkout-email" name="customerEmail" autoComplete="email" type="email" required /></div></div>
      <div><label htmlFor="checkout-phone">Phone</label><input id="checkout-phone" name="customerPhone" type="tel" autoComplete="tel" /></div>
      <div className="grid grid-cols-2 gap-2"><button type="button" className={fulfillment === "PICKUP" ? "btn-primary" : "btn-secondary"} disabled={!pickupLocations.length} onClick={() => setFulfillment("PICKUP")}>Pickup</button><button type="button" className={fulfillment === "DELIVERY" ? "btn-primary" : "btn-secondary"} onClick={() => setFulfillment("DELIVERY")}>Delivery</button></div>
      <input type="hidden" name="fulfillmentType" value={fulfillment} />
      {fulfillment === "PICKUP" ? <div><label htmlFor="checkout-pickup">Pickup location</label><select id="checkout-pickup" name="pickupLocationId" required>{pickupLocations.map(location => { const pickup = describePickup(location); return <option value={location.id} key={location.id}>{pickup.name} — {pickup.address}</option>; })}</select><p className="mt-1 text-xs text-ink/70">Pickup: {describePickup(pickupLocations[0] ?? { name: "Pickup" }).address}. The bakery confirms the exact spot after payment.</p></div> : <div className="space-y-3">
        <p className="border-2 border-ink bg-crumb p-3 text-sm font-bold">{DELIVERY_FEE_COPY}</p>
        <div><label htmlFor="checkout-address">Delivery address</label><textarea id="checkout-address" name="deliveryAddress" autoComplete="street-address" required rows={3} value={deliveryAddress} onChange={event => setDeliveryAddress(event.target.value)} onBlur={() => { if (deliveryAddress.trim() && /^\d{5}$/.test(deliveryZip.trim()) && quotedKey !== quoteKey) void checkDeliveryFee(); }} /></div>
        <div><label htmlFor="checkout-zip">Delivery ZIP code</label><input id="checkout-zip" name="deliveryZip" required inputMode="numeric" pattern="[0-9]{5}" maxLength={5} autoComplete="postal-code" value={deliveryZip} onChange={event => setDeliveryZip(event.target.value.replace(/\D/g, "").slice(0, 5))} onBlur={() => { if (deliveryAddress.trim() && /^\d{5}$/.test(deliveryZip.trim()) && quotedKey !== quoteKey) void checkDeliveryFee(); }} /></div>
        <button type="button" className="btn-secondary w-full" onClick={() => { void checkDeliveryFee(); }} disabled={quoteState === "loading"}>{quoteState === "loading" ? "Checking delivery fee..." : "Check delivery fee"}</button>
        {quoteState === "error" ? <p role="alert" className="text-sm font-bold">Enter your street address and five-digit ZIP code to check the delivery fee.</p> : null}
        {quoteCurrent && quote ? <div role="status" aria-live="polite" data-testid="delivery-quote" className={`border-2 border-ink p-3 text-sm ${quote.inRange ? "bg-page" : "bg-jam"}`}>{quote.inRange && quote.feeCents !== null ? <p className="font-black">Delivery fee: {quote.feeCents === 0 ? "Free" : formatMoney(quote.feeCents)}</p> : null}<p className={quote.inRange ? "mt-1" : "font-black"}>{quote.message}</p></div> : null}
      </div>}
      <p className="border-2 border-ink bg-crumb p-3 text-sm">Pay with Venmo after placing your order. Your private order page will show the exact amount, payment reference, and deadline. Placing an order does not charge you or confirm payment. The bakery will check the payment before preparing your order.</p>
      {!canFulfill ? <p className="border-2 border-ink bg-jam p-3 text-sm font-black">Checkout is paused until pickup or delivery is configured.</p> : null}
      <button className="btn-primary w-full" disabled={phase !== "ready" || !canFulfill || !checkoutReady || deliveryBlocked}>{phase === "checking" ? "Checking saved checkout..." : phase === "submitting" ? "Creating your order..." : phase === "navigating" ? "Opening your order..." : !checkoutReady ? "Online ordering isn't available" : phase === "blocked" ? "Check saved checkout to continue" : "Place order · Pay with Venmo"}</button>
    </fieldset> : phase === "checking" || phase === "navigating" ? <p role="status" className="text-sm font-bold">{phase === "checking" ? "Checking for your saved order..." : "Opening your order..."}</p> : null}
    {message ? <p role="alert" className="border-2 border-ink bg-crumb p-3 text-sm font-bold">{message}</p> : null}
    {phase === "blocked" || (phase === "ready" && hasSavedAttempt) ? <button className="btn-secondary w-full" type="button" onClick={() => { void checkSavedCheckout(); }}>Check my saved checkout{phase === "ready" ? " again" : ""}</button> : null}
  </form>;
}
