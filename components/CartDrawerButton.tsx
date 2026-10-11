"use client";

import { ShoppingCart, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { DeliveryZone, PickupLocation } from "@prisma/client";
import { CartSummary } from "@/components/CartSummary";
import { CheckoutForm } from "@/components/CheckoutForm";

type Cart = {
  items: { quantity: number }[];
};

export function CartDrawerButton({
  deliveryZones,
  pickupLocations
}: {
  deliveryZones: DeliveryZone[];
  pickupLocations: PickupLocation[];
}) {
  const [open, setOpen] = useState(false);
  const [itemCount, setItemCount] = useState(0);

  async function loadCount() {
    const response = await fetch("/api/cart", { cache: "no-store" });
    const body = (await response.json()) as Cart;
    setItemCount(response.ok ? body.items.reduce((sum, item) => sum + item.quantity, 0) : 0);
  }

  useEffect(() => {
    loadCount();
    window.addEventListener("cart:updated", loadCount);
    return () => window.removeEventListener("cart:updated", loadCount);
  }, []);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <>
      <button className="btn-secondary px-3" type="button" onClick={() => setOpen(true)} aria-label="Open cart">
        <ShoppingCart size={18} />
        Cart
        <span className="badge bg-crumb text-ink">{itemCount}</span>
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 bg-ink/35 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Cart">
          <button className="absolute inset-0 h-full w-full cursor-default" type="button" aria-label="Close cart" onClick={() => setOpen(false)} />
          <div className="relative ml-auto flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-y-auto rounded-lg bg-white shadow-soft">
            <div className="flex items-center justify-between border-b border-amber-200 p-4">
              <h2 className="text-lg font-black">Your cart</h2>
              <button className="btn-secondary px-3" type="button" onClick={() => setOpen(false)} aria-label="Close cart">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <CartSummary framed={false} onItemCountChange={setItemCount} />
              {itemCount > 0 ? <CheckoutForm deliveryZones={deliveryZones} pickupLocations={pickupLocations} framed={false} /> : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
