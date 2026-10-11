"use client";

import { useEffect, useRef, useState } from "react";
import type { DeliveryZone, PickupLocation } from "@prisma/client";

export function CheckoutForm({
  deliveryZones,
  pickupLocations,
  framed = true
}: {
  deliveryZones: DeliveryZone[];
  pickupLocations: PickupLocation[];
  framed?: boolean;
}) {
  const defaultFulfillment = pickupLocations.length ? "PICKUP" : "DELIVERY";
  const [fulfillment, setFulfillment] = useState<"DELIVERY" | "PICKUP">(defaultFulfillment);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);
  const attemptRef = useRef<{ key: string; details: string } | null>(null);
  const [options, setOptions] = useState<{ providers: string[]; windows: { id: string; label: string; cutoff: string }[] } | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/checkout/options", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (active) setOptions(data);
    }).catch(() => { if (active) setMessage("Checkout availability could not be loaded. Please reopen your cart."); });
    return () => { active = false; };
  }, []);
  const checkoutReady = Boolean(options?.providers.length && options?.windows.length);
  const canFulfill = pickupLocations.length > 0 || deliveryZones.length > 0;

  async function submit(formData: FormData) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setMessage("");
    const payload = Object.fromEntries(formData.entries());
    const details = JSON.stringify(payload);
    let attempt = attemptRef.current;
    try { attempt = JSON.parse(sessionStorage.getItem("bakery-checkout-attempt") || "null"); } catch { /* In-memory retries still work with disabled browser storage. */ }
    if (!attempt || attempt.details !== details) {
      attempt = { key: crypto.randomUUID(), details };
      try { sessionStorage.setItem("bakery-checkout-attempt", JSON.stringify(attempt)); } catch { /* Storage can be disabled in private browsing. */ }
    }
    attemptRef.current = attempt;
    payload.checkoutKey = attempt.key;
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json();
      if (body.url) {
        window.location.href = body.url;
        return;
      }
      setLoading(false);
      submittingRef.current = false;
      if (response.ok) window.dispatchEvent(new Event("cart:updated"));
      setMessage(response.ok ? body.message : body.error ?? "Checkout failed");
    } catch {
      setLoading(false);
      submittingRef.current = false;
      setMessage("Checkout failed. Please try again.");
    }
  }

  return (
    <form action={submit} className={`${framed ? "panel p-4" : "border-t border-amber-200 pt-4"} space-y-4`}>
      <h2 className="text-lg font-black">Checkout</h2>
      {options?.windows.length ? <div>
        <label htmlFor="order-window">Delivery or pickup date</label>
        <select id="order-window" name="orderWindowId" required>
          {options.windows.map(window => <option key={window.id} value={window.id}>{window.label} · Order by {window.cutoff}</option>)}
        </select>
        <p className="mt-1 text-xs text-ink/70">All dates and cutoffs use America/New_York time.</p>
      </div> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label>Name</label>
          <input name="customerName" required />
        </div>
        <div>
          <label>Email</label>
          <input name="customerEmail" required type="email" />
        </div>
      </div>
      <div>
        <label>Phone</label>
        <input name="customerPhone" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          className={fulfillment === "PICKUP" ? "btn-primary" : "btn-secondary"}
          disabled={!pickupLocations.length}
          type="button"
          onClick={() => setFulfillment("PICKUP")}
        >
          Pickup
        </button>
        <button
          className={fulfillment === "DELIVERY" ? "btn-primary" : "btn-secondary"}
          disabled={!deliveryZones.length}
          type="button"
          onClick={() => setFulfillment("DELIVERY")}
        >
          Delivery
        </button>
      </div>
      <input type="hidden" name="fulfillmentType" value={fulfillment} />
      {fulfillment === "PICKUP" ? (
        <div>
          <label>Pickup location</label>
          <select name="pickupLocationId" required>
            {pickupLocations.map((location) => (
              <option value={location.id} key={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          {!pickupLocations.length ? <p className="mt-1 text-xs font-semibold text-jam">No pickup locations are active.</p> : null}
        </div>
      ) : (
        <>
          <div>
            <label>Delivery zone</label>
            <select name="deliveryZoneId" required>
              {deliveryZones.map((zone) => (
                <option value={zone.id} key={zone.id}>
                  {zone.name} ({zone.zipCodes.join(", ")}) · ${(zone.feeCents / 100).toFixed(2)} delivery
                </option>
              ))}
            </select>
            {!deliveryZones.length ? <p className="mt-1 text-xs font-semibold text-jam">No delivery zones are active.</p> : null}
          </div>
          <div>
            <label>Delivery address</label>
            <textarea name="deliveryAddress" required rows={3} />
            <label>Delivery ZIP code<input name="deliveryZip" required inputMode="numeric" pattern="[0-9]{5}" maxLength={5} autoComplete="postal-code" /></label>
          </div>
        </>
      )}
      {options?.providers.length ? <div>
        <label htmlFor="payment-provider">Pay securely with</label>
        <select id="payment-provider" name="paymentProvider" required>
          {options.providers.map(provider => <option key={provider} value={provider}>{provider === "STRIPE" ? "Card (Stripe)" : "PayPal"}</option>)}
        </select>
        <p className="mt-1 text-xs text-ink/70">Your order is confirmed only after payment. Card details stay with the payment provider.</p>
      </div> : null}
      {!checkoutReady ? <p className="rounded-md bg-crumb p-3 text-sm font-semibold text-jam">{options ? "Online checkout is currently closed. Please contact the bakery." : "Checking checkout availability..."}</p> : null}
      {!canFulfill ? <p className="rounded-md bg-crumb p-3 text-sm font-semibold text-jam">Checkout is paused until pickup or delivery is configured.</p> : null}
      <button className="btn-primary w-full" disabled={loading || !canFulfill || !checkoutReady}>
        {loading ? "Preparing checkout..." : "Continue to secure payment"}
      </button>
      {message ? <p className="rounded-md bg-crumb p-3 text-sm font-semibold text-ink">{message}</p> : null}
    </form>
  );
}
