"use client";

import { ShoppingCart, X } from "lucide-react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { shouldOpenCheckoutRecovery } from "@/lib/checkout-recovery-client";
import type { PickupLocation } from "@prisma/client";
import { CartSummary } from "@/components/CartSummary";
import { CheckoutForm } from "@/components/CheckoutForm";
import { WeeklyWindowNotice } from "@/components/WeeklyWindowNotice";
import type { WeeklyResolution } from "@/lib/weekly-window";

type Cart = {
  items: { quantity: number }[];
};

export function CartDrawerButton({
  pickupLocations,
  checkoutReady = true,
  adminTestMode = false,
  adminSetupReasons = [],
  contactEmail = "",
  weeklyWindow = null
}: {
  pickupLocations: PickupLocation[];
  checkoutReady?: boolean;
  adminTestMode?: boolean;
  adminSetupReasons?: string[];
  contactEmail?: string;
  weeklyWindow?: WeeklyResolution | null;
}) {
  const [open, setOpen] = useState(false);
  const [itemCount, setItemCount] = useState(0);
  const pathname = usePathname();

  async function loadCount() {
    const response = await fetch("/api/cart", { cache: "no-store" });
    const body = (await response.json()) as Cart;
    setItemCount(response.ok ? body.items.reduce((sum, item) => sum + item.quantity, 0) : 0);
  }

  useEffect(() => {
    loadCount();
    window.addEventListener("cart:updated", loadCount);
    function resumeSavedCheckout() {
      try { if (shouldOpenCheckoutRecovery(window.sessionStorage, pathname)) setOpen(true); } catch { /* Checkout explains inaccessible storage before placing an order. */ }
    }
    function onPageShow() { void loadCount(); resumeSavedCheckout(); }
    resumeSavedCheckout(); window.addEventListener("pageshow", onPageShow);
    return () => { window.removeEventListener("cart:updated", loadCount); window.removeEventListener("pageshow", onPageShow); };
  }, [pathname]);

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
        <span className="badge bg-jam text-ink">{itemCount}</span>
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 bg-ink/55 p-4" role="dialog" aria-modal="true" aria-label="Cart">
          <button className="absolute inset-0 h-full w-full cursor-default" type="button" aria-label="Close cart" onClick={() => setOpen(false)} />
          <div className="relative ml-auto flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-y-auto border-4 border-ink bg-page shadow-hard">
            <div className="flex items-center justify-between border-b-2 border-ink bg-crumb p-4">
              <h2 className="font-display text-2xl uppercase tracking-wide">Your cart</h2>
              <button className="btn-secondary px-3" type="button" onClick={() => setOpen(false)} aria-label="Close cart">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <CartSummary framed={false} onItemCountChange={setItemCount} />
              {weeklyWindow ? <WeeklyWindowNotice resolution={weeklyWindow} variant="checkout" /> : null}
              <CheckoutForm checkoutReady={checkoutReady} adminTestMode={adminTestMode} adminSetupReasons={adminSetupReasons} contactEmail={contactEmail} pickupLocations={pickupLocations} framed={false} hasCartItems={itemCount > 0} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
