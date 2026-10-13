"use client";
import { useRef, useState } from "react";
import { createTrialOrder, transitionTrial, trialProducts, type TrialAction, type TrialOrder } from "@/lib/checkout-trial";
import { formatMoney } from "@/lib/money";

export function CheckoutTrial() {
  const checkoutFields = useRef<HTMLDivElement>(null);
  const [order, setOrder] = useState<TrialOrder | null>(null);
  const [fulfillment, setFulfillment] = useState<"PICKUP" | "DELIVERY">("PICKUP");
  const [productId, setProductId] = useState<string>(trialProducts[0].id);
  const [quantity, setQuantity] = useState(1);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const total = (trialProducts.find(item => item.id === productId)?.priceCents || 0) * quantity + (fulfillment === "DELIVERY" ? 500 : 0);
  function placeTestOrder() {
    const fields = Array.from(checkoutFields.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select") || []);
    if (!fields.length || fields.some(field => !field.reportValidity())) return;
    const details = Object.fromEntries(fields.filter(field => field.name).map(field => [field.name, field.value]));
    try {
      const next = createTrialOrder(details, productId, quantity, Date.now());
      setOrder(next); setAmount((next.totalCents / 100).toFixed(2)); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Check the test details."); }
  }
  function act(action: TrialAction) {
    if (!order) return;
    try {
      const cents = /^\d+(\.\d{1,2})?$/.test(amount.trim()) ? Math.round(Number(amount) * 100) : NaN;
      setOrder(transitionTrial(order, action, Date.now(), cents)); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Check the test details."); }
  }
  return <section className="space-y-4 max-w-3xl">
    <div className="border-4 border-ink bg-crumb p-4" role="note">
      <h2 className="font-display text-2xl uppercase">TEST checkout · No money moves</h2>
      <p className="mt-2 font-bold">Owner-only rehearsal. Every order and payment on this page is simulated.</p>
      <p className="mt-2 text-sm">Use fictional details. Nothing here is submitted to checkout, emailed, saved as an order, or reserved from stock. There are no Venmo payment links. Refresh or choose “Start another TEST order” to clear the rehearsal. Browser Back may restore this temporary screen.</p>
    </div>
    {!order ? <div ref={checkoutFields} role="form" aria-label="Fictional checkout details" className="panel p-4 space-y-4">
      <h3 className="text-xl font-black">1. Customer checkout</h3>
      <label className="block">Test product<select value={productId} onChange={event => setProductId(event.target.value)}>{trialProducts.map(product => <option key={product.id} value={product.id}>{product.name} · {formatMoney(product.priceCents)}</option>)}</select></label>
      <label className="block">Quantity<input type="number" min={1} max={5} required value={quantity} onChange={event => setQuantity(Number(event.target.value))} /></label>
      <div className="grid gap-3 sm:grid-cols-2"><label>Name<input name="customerName" autoComplete="off" defaultValue="Test Baker" required minLength={2} maxLength={120} /></label><label>Email<input name="customerEmail" autoComplete="off" defaultValue="checkout@example.invalid" type="email" required maxLength={254} /></label></div>
      <label className="block">Fulfillment<select name="fulfillmentType" value={fulfillment} onChange={event => setFulfillment(event.target.value as "PICKUP" | "DELIVERY")}><option value="PICKUP">Test pickup</option><option value="DELIVERY">Test delivery (+$5.00)</option></select></label>
      {fulfillment === "DELIVERY" ? <div className="space-y-3"><label className="block">Fictional address<input name="deliveryAddress" defaultValue="123 Test Lane" required /></label><label className="block">Test ZIP<input name="deliveryZip" defaultValue="00000" required pattern="00000" maxLength={5} inputMode="numeric" /></label></div> : <p className="text-sm">Pickup: Fictional test bakery counter</p>}
      <p className="text-xl font-black">Test total: {formatMoney(total)}</p>
      <button type="button" className="btn-primary w-full" onClick={placeTestOrder}>Place TEST order · No charge</button>
    </div> : <>
      <div className="panel p-4 space-y-3" aria-live="polite">
        <h3 className="text-xl font-black">2. TEST receipt · {order.reference}</h3>
        <p>{order.quantity} × {order.productName} · {order.fulfillment.toLowerCase()}</p>
        <p className="text-xl font-black">{formatMoney(order.totalCents)} USD · {order.status.replaceAll("_", " ")}</p>
        <p>Payment: {order.payment.replaceAll("_", " ").toLowerCase()}</p>
        <p className="text-sm">Simulated verification deadline: {new Date(order.dueAt).toLocaleTimeString()}. In a real order, you would pay the verified business and include the unique payment reference. Do not send a payment for this rehearsal.</p>
        <button type="button" className="btn-secondary w-full" disabled={order.status !== "PENDING" || order.payment === "REVIEW_REQUESTED"} onClick={() => act("claim")}>Simulate “I paid” · Request review</button>
        <p className="text-sm">Requesting review does not mark an order paid.</p>
      </div>
      <div className="panel p-4 space-y-3">
        <h3 className="text-xl font-black">3. Owner payment verification</h3>
        <p className="text-sm">In production, independently check the actual Venmo transaction, recipient, amount and unique reference. This button only rehearses that decision; it cannot verify a real payment.</p>
        <label className="block">Simulated amount received (USD)<input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" disabled={order.status !== "PENDING"} /></label>
        <button type="button" className="btn-primary w-full" disabled={order.status !== "PENDING"} onClick={() => act("verify")}>Simulate owner verification</button>
      </div>
      <div className="panel p-4 space-y-3">
        <h3 className="text-xl font-black">4. Fulfillment and alternative paths</h3>
        <button type="button" className="btn-primary w-full" disabled={["CANCELLED", "EXPIRED", "COMPLETED"].includes(order.status)} onClick={() => act("advance")}>{order.status === "PAID" ? "Start preparing TEST order" : order.status === "PREPARING" ? "Mark TEST order ready" : order.status === "READY" && order.fulfillment === "DELIVERY" ? "Send TEST order out for delivery" : ["READY", "OUT_FOR_DELIVERY"].includes(order.status) ? "Complete TEST order" : "Try fulfillment before verification"}</button>
        <div className="grid gap-2 sm:grid-cols-2"><button type="button" className="btn-secondary" disabled={order.status !== "PENDING"} onClick={() => act("cancel")}>Cancel unpaid TEST order</button><button type="button" className="btn-secondary" disabled={order.status !== "PENDING"} onClick={() => act("expire")}>Simulate deadline expiry</button></div>
        <ol className="list-decimal pl-5 text-sm space-y-2" aria-label="Test order history">{order.history.map((entry, index) => <li key={index}>{entry}</li>)}</ol>
      </div>
      <button type="button" className="btn-secondary w-full" onClick={() => { setOrder(null); setError(""); setAmount(""); }}>Start another TEST order</button>
    </>}
    {error ? <p role="alert" className="border-2 border-ink bg-crumb p-3 font-bold">{error}</p> : null}
    <p className="text-sm text-ink/70">This rehearsal shares the real customer-field validation and currency formatting. It does not test payment-provider settlement, live order persistence, emails, stock concurrency, or recovery across refreshes. Production payment settings are unaffected.</p>
  </section>;
}
