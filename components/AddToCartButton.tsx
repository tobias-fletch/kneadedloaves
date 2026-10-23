"use client";

import React, { useState } from "react";
import { ShoppingCart } from "lucide-react";

export function AddToCartButton({ productId, disabled }: { productId: string; disabled?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function addToCart() {
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, quantity: 1 })
    });
    const body = await response.json();
    setLoading(false);
    if (response.ok) {
      window.dispatchEvent(new Event("cart:updated"));
      setMessage("Added to cart");
    } else {
      setMessage(body.error ?? "Could not add");
    }
  }

  return (
    <div className="space-y-2">
      <button className="btn-primary w-full" disabled={disabled || loading} onClick={addToCart}>
        <ShoppingCart size={18} />
        {loading ? "Adding..." : "Add to cart"}
      </button>
      {message ? <p className="text-xs font-semibold text-sage">{message}</p> : null}
    </div>
  );
}
