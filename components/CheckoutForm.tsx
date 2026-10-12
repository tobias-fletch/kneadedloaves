"use client";

import Link from "next/link";
import { useRef, useState } from "react";
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
  const [showSignInNudge, setShowSignInNudge] = useState(true);
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);
  const canFulfill = pickupLocations.length > 0 || deliveryZones.length > 0;

  async function submit(formData: FormData) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setMessage("");
    const payload = Object.fromEntries(formData.entries());
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
    <form action={submit} className={`${framed ? "panel p-4" : "border-t-2 border-ink pt-4"} space-y-4`}>
      <h2 className="font-display text-2xl uppercase tracking-wide">Checkout</h2>
      {showSignInNudge ? (
        <p className="flex items-start justify-between gap-3 border-2 border-ink bg-crumb p-3 text-sm font-medium text-ink">
          <span>
            Have an account? <Link href="/login" className="font-black underline">Sign in</Link> to link this order to it. Checkout works fine as a guest.
          </span>
          <button type="button" aria-label="Dismiss" onClick={() => setShowSignInNudge(false)} className="shrink-0 px-1 text-lg font-black leading-none">
            &times;
          </button>
        </p>
      ) : null}
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
          {!pickupLocations.length ? <p className="mt-1 text-xs font-bold text-crust">No pickup locations are active.</p> : null}
        </div>
      ) : (
        <>
          <div>
            <label>Delivery zone</label>
            <select name="deliveryZoneId" required>
              {deliveryZones.map((zone) => (
                <option value={zone.id} key={zone.id}>
                  {zone.name} ({zone.zipCodes.join(", ")})
                </option>
              ))}
            </select>
            {!deliveryZones.length ? <p className="mt-1 text-xs font-bold text-crust">No delivery zones are active.</p> : null}
          </div>
          <div>
            <label>Delivery address</label>
            <textarea name="deliveryAddress" required rows={3} />
            <label>Delivery ZIP code<input name="deliveryZip" required inputMode="numeric" pattern="[0-9]{5}" maxLength={5} autoComplete="postal-code" /></label>
          </div>
        </>
      )}
      {!canFulfill ? <p className="border-2 border-ink bg-jam p-3 text-sm font-black uppercase tracking-wide text-ink">Checkout is paused until pickup or delivery is configured.</p> : null}
      <button className="btn-primary w-full" disabled={loading || !canFulfill}>
        {loading ? "Preparing checkout..." : "Place order"}
      </button>
      {message ? <p className="border-2 border-ink bg-crumb p-3 text-sm font-bold text-ink">{message}</p> : null}
    </form>
  );
}
