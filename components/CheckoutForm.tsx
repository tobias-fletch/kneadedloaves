"use client";
import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { DeliveryZone, PickupLocation } from "@prisma/client";
import { browserCheckoutStorage, CheckoutStorageError, prepareCheckoutAttempt, receiptDestination, recoverCheckoutAttempt, rememberCheckoutOrder } from "@/lib/checkout-recovery-client";

export function CheckoutForm({ deliveryZones, pickupLocations, framed = true, hasCartItems = true }: { deliveryZones: DeliveryZone[]; pickupLocations: PickupLocation[]; framed?: boolean; hasCartItems?: boolean }) {
  const [fulfillment, setFulfillment] = useState<"DELIVERY" | "PICKUP">(pickupLocations.length ? "PICKUP" : "DELIVERY");
  const [message, setMessage] = useState("");
  const [showSignInNudge, setShowSignInNudge] = useState(true);
  const [phase, setPhase] = useState<"checking" | "ready" | "submitting" | "blocked" | "navigating">("checking");
  const [hasSavedAttempt, setHasSavedAttempt] = useState(false);
  const submittingRef = useRef(false), generationRef = useRef(0), idempotencyKeyRef = useRef<string | null>(null);
  const canFulfill = pickupLocations.length > 0 || deliveryZones.length > 0;
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
    if (submittingRef.current || phase !== "ready" || !hasCartItems) return;
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
    {hasCartItems ? <fieldset disabled={phase !== "ready"} className="space-y-4">
      <h2 className="font-display text-2xl uppercase tracking-wide">Checkout</h2>
      {showSignInNudge ? <p className="flex items-start justify-between gap-3 border-2 border-ink bg-crumb p-3 text-sm font-medium"><span>Have an account? <Link href="/login" className="font-black underline">Sign in</Link> to link this order to it. Checkout works fine as a guest.</span><button type="button" aria-label="Dismiss" onClick={() => setShowSignInNudge(false)} className="shrink-0 px-1 text-lg font-black">&times;</button></p> : null}
      <div className="grid gap-3 sm:grid-cols-2"><div><label htmlFor="checkout-name">Name</label><input id="checkout-name" name="customerName" autoComplete="name" required /></div><div><label htmlFor="checkout-email">Email</label><input id="checkout-email" name="customerEmail" autoComplete="email" type="email" required /></div></div>
      <div><label htmlFor="checkout-phone">Phone</label><input id="checkout-phone" name="customerPhone" type="tel" autoComplete="tel" /></div>
      <div className="grid grid-cols-2 gap-2"><button type="button" className={fulfillment === "PICKUP" ? "btn-primary" : "btn-secondary"} disabled={!pickupLocations.length} onClick={() => setFulfillment("PICKUP")}>Pickup</button><button type="button" className={fulfillment === "DELIVERY" ? "btn-primary" : "btn-secondary"} disabled={!deliveryZones.length} onClick={() => setFulfillment("DELIVERY")}>Delivery</button></div>
      <input type="hidden" name="fulfillmentType" value={fulfillment} />
      {fulfillment === "PICKUP" ? <div><label htmlFor="checkout-pickup">Pickup location</label><select id="checkout-pickup" name="pickupLocationId" required>{pickupLocations.map(location => <option value={location.id} key={location.id}>{location.name}</option>)}</select></div> : <><div><label htmlFor="checkout-zone">Delivery zone</label><select id="checkout-zone" name="deliveryZoneId" required>{deliveryZones.map(zone => <option value={zone.id} key={zone.id}>{zone.name} ({zone.zipCodes.join(", ")})</option>)}</select></div><div><label htmlFor="checkout-address">Delivery address</label><textarea id="checkout-address" name="deliveryAddress" autoComplete="street-address" required rows={3} /><label>Delivery ZIP code<input name="deliveryZip" required inputMode="numeric" pattern="[0-9]{5}" maxLength={5} autoComplete="postal-code" /></label></div></>}
      <p className="border-2 border-ink bg-crumb p-3 text-sm">Pay with Venmo after placing your order. Your private order page will show the exact amount, payment reference, and deadline. Placing an order does not charge you or confirm payment. The bakery will check the payment before preparing your order.</p>
      {!canFulfill ? <p className="border-2 border-ink bg-jam p-3 text-sm font-black">Checkout is paused until pickup or delivery is configured.</p> : null}
      <button className="btn-primary w-full" disabled={phase !== "ready" || !canFulfill}>{phase === "checking" ? "Checking saved checkout..." : phase === "submitting" ? "Creating your order..." : phase === "navigating" ? "Opening your order..." : phase === "blocked" ? "Check saved checkout to continue" : "Place order · Pay with Venmo"}</button>
    </fieldset> : phase === "checking" || phase === "navigating" ? <p role="status" className="text-sm font-bold">{phase === "checking" ? "Checking for your saved order..." : "Opening your order..."}</p> : null}
    {message ? <p role="alert" className="border-2 border-ink bg-crumb p-3 text-sm font-bold">{message}</p> : null}
    {phase === "blocked" || (phase === "ready" && hasSavedAttempt) ? <button className="btn-secondary w-full" type="button" onClick={() => { void checkSavedCheckout(); }}>Check my saved checkout{phase === "ready" ? " again" : ""}</button> : null}
  </form>;
}
