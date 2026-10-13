"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/money";

type CartItem = {
  id: string;
  quantity: number;
  product: {
    id: string;
    name: string;
    priceCents: number;
  };
};

type Cart = {
  items: CartItem[];
};

export function CartSummary({ framed = true, onItemCountChange }: { framed?: boolean; onItemCountChange?: (count: number) => void }) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadCart() {
    setLoading(true);
    const response = await fetch("/api/cart", { cache: "no-store" });
    const body = await response.json();
    setCart(response.ok ? body : { items: [] });
    setLoading(false);
  }

  async function updateQuantity(productId: string, quantity: number) {
    setMessage("");
    const response = await fetch("/api/cart", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, quantity })
    });
    const body = await response.json();
    if (response.ok) {
      setCart(body);
      window.dispatchEvent(new Event("cart:updated"));
    } else {
      setMessage(body.error ?? "Could not update cart.");
    }
  }

  async function removeItem(productId: string) {
    setMessage("");
    const response = await fetch("/api/cart", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId })
    });
    const body = await response.json();
    if (response.ok) {
      setCart(body);
      window.dispatchEvent(new Event("cart:updated"));
    } else {
      setMessage(body.error ?? "Could not remove item.");
    }
  }

  useEffect(() => {
    loadCart();
    window.addEventListener("cart:updated", loadCart);
    window.addEventListener("pageshow", loadCart);
    return () => { window.removeEventListener("cart:updated", loadCart); window.removeEventListener("pageshow", loadCart); };
  }, []);

  const items = useMemo(() => cart?.items ?? [], [cart]);
  const totalCents = useMemo(
    () => items.reduce((sum, item) => sum + item.product.priceCents * item.quantity, 0),
    [items]
  );
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  useEffect(() => {
    onItemCountChange?.(itemCount);
  }, [itemCount, onItemCountChange]);

  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-2xl uppercase tracking-wide">Cart</h2>
        <span className="badge bg-jam text-ink">{itemCount} item{itemCount === 1 ? "" : "s"}</span>
      </div>
      {loading ? (
        <p className="mt-3 text-sm text-ink/70">Loading cart...</p>
      ) : items.length ? (
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <div className="border-2 border-ink bg-page p-3 shadow-hard-sm" key={item.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold">{item.product.name}</p>
                  <p className="text-xs text-ink/60">
                    {item.quantity} x {formatMoney(item.product.priceCents)}
                  </p>
                </div>
                <p className="text-lg font-black text-ink">{formatMoney(item.product.priceCents * item.quantity)}</p>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button className="btn-secondary min-h-8 px-3 py-1" type="button" onClick={() => updateQuantity(item.product.id, item.quantity - 1)}>
                    -
                  </button>
                  <span className="min-w-8 text-center text-sm font-bold">{item.quantity}</span>
                  <button className="btn-secondary min-h-8 px-3 py-1" type="button" onClick={() => updateQuantity(item.product.id, item.quantity + 1)}>
                    +
                  </button>
                </div>
                <button className="text-sm font-black uppercase tracking-wide text-crust underline" type="button" onClick={() => removeItem(item.product.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between border-t-2 border-ink pt-3">
            <p className="font-bold">Subtotal</p>
            <p className="text-xl font-black">{formatMoney(totalCents)}</p>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink/70">Your cart is empty. Add a bake to begin checkout.</p>
      )}
      {message ? <p className="mt-3 border-2 border-ink bg-crumb p-3 text-sm font-bold text-ink">{message}</p> : null}
    </>
  );

  return framed ? <div className="panel p-4">{content}</div> : content;
}
