"use client";

import React, { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import {
  ADMIN_PAYMENT_METHODS,
  MAX_LINE_QUANTITY,
  describePaymentMatch,
  parseDollarToCents,
  recalculatedOrderTotal
} from "@/lib/admin-order-corrections";

type Item = { id: string; productName: string; quantity: number; unitPriceCents: number };
type PayableOrder = { id: string; customerName: string; totalCents: number; currency: string; summary: string; textOrder: boolean };

async function postJson(url: string, method: "POST" | "PATCH", payload: object) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not save this change.");
  return body;
}

export function OrderCorrectionForms(props: { orderId: string; currency: string; totalCents: number; deliveryFeeCents: number; items: Item[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(props.items.map(item => [item.id, String(item.quantity)])));
  const submitting = useRef(false);

  async function saveQuantity(event: FormEvent<HTMLFormElement>, itemId: string) {
    event.preventDefault();
    if (submitting.current || saved) return;
    const quantity = Number(drafts[itemId]);
    const note = String(new FormData(event.currentTarget).get("note") ?? "");
    submitting.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await postJson(`/api/admin/orders/${props.orderId}/items`, "PATCH", { itemId, quantity, note });
      setSaved(true);
      setMessage(`Quantity saved. Order total is now ${formatMoney(result.totalCents)}. The customer was not emailed, and product stock was not changed.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save this change.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function markPaid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || saved) return;
    const form = new FormData(event.currentTarget);
    submitting.current = true;
    setBusy(true);
    setMessage("");
    try {
      await postJson(`/api/admin/orders/${props.orderId}/mark-paid`, "POST", {
        method: String(form.get("method") ?? ""),
        note: String(form.get("note") ?? ""),
        providerTransactionId: String(form.get("providerTransactionId") ?? "")
      });
      setSaved(true);
      setMessage(`Marked paid for ${formatMoney(props.totalCents)}. The customer was not emailed.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save this change.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <div className="mt-3 space-y-3 border-t-2 border-ink/20 pt-3 print:hidden">
    <div className="border-2 border-ink bg-crumb p-3">
      <h3 className="font-black uppercase tracking-wide">Edit quantity</h3>
      <p className="mt-1 text-sm">The order total is recalculated from each item&apos;s saved unit price. This does not change product stock or email the customer.</p>
      {props.items.map(item => {
        const draft = drafts[item.id] ?? String(item.quantity);
        const quantity = Number(draft);
        let preview = "";
        if (Number.isInteger(quantity)) {
          try { preview = `New order total ${formatMoney(recalculatedOrderTotal(props.items, item.id, quantity, props.deliveryFeeCents).totalCents)}.`; }
          catch { preview = ""; }
        }
        return <form key={item.id} onSubmit={event => { void saveQuantity(event, item.id); }} className="mt-3 space-y-3">
          <fieldset disabled={busy || saved} className="space-y-3 disabled:opacity-60">
            <label className="block">{item.productName} quantity
              <input name="quantity" type="number" inputMode="numeric" min={1} max={MAX_LINE_QUANTITY} step={1} required value={draft} onChange={event => setDrafts(current => ({ ...current, [item.id]: event.target.value }))} />
            </label>
            <p className="text-sm">Saved unit price {formatMoney(item.unitPriceCents)}. Current line {formatMoney(item.quantity * item.unitPriceCents)}. {preview}</p>
            <label className="block">Note (optional)<input name="note" type="text" maxLength={1000} autoComplete="off" /></label>
            <button className="btn-secondary" type="submit">{busy ? "Saving..." : "Save quantity"}</button>
          </fieldset>
        </form>;
      })}
    </div>
    <form onSubmit={event => { void markPaid(event); }} className="border-2 border-ink bg-crumb p-3">
      <h3 className="font-black uppercase tracking-wide">Mark this order paid</h3>
      <p className="mt-1 text-sm">Records {formatMoney(props.totalCents)} {props.currency} as paid. A transaction ID and an open payment deadline are not required. The customer is not emailed, and the Reconcile Venmo form is unchanged.</p>
      <fieldset disabled={busy || saved} className="mt-3 space-y-3 disabled:opacity-60">
        <label className="block">Payment method
          <select name="method" required defaultValue="VENMO">{ADMIN_PAYMENT_METHODS.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}</select>
        </label>
        <label className="block">Transaction ID (optional)<input name="providerTransactionId" autoComplete="off" maxLength={160} /></label>
        <label className="block">Note (optional)<input name="note" type="text" maxLength={1000} autoComplete="off" /></label>
        <button className="btn-primary" type="submit">{busy ? "Saving..." : `Mark paid · ${formatMoney(props.totalCents)}`}</button>
      </fieldset>
    </form>
    {message ? <p role={saved ? "status" : "alert"} aria-live="polite" className="border-2 border-ink bg-page p-3 text-sm font-bold">{message}</p> : null}
  </div>;
}

export function SharedPaymentForm(props: { orders: PayableOrder[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  if (props.orders.length < 2) return null;
  const chosen = props.orders.filter(order => selected.includes(order.id));
  const currencies = new Set(chosen.map(order => order.currency));
  const parsed = amount.trim() ? parseDollarToCents(amount) : null;
  const match = currencies.size > 1 ? null : describePaymentMatch(amount.trim() ? parsed : null, chosen.map(order => order.totalCents));
  const mismatch = Boolean(chosen.length >= 2 && amount.trim() && (parsed === null || !match?.matches));
  const ready = chosen.length >= 2 && currencies.size === 1 && parsed !== null && match?.matches === true;

  function toggle(id: string) {
    setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || saved || !ready || parsed === null) return;
    const form = new FormData(event.currentTarget);
    submitting.current = true;
    setBusy(true);
    setMessage("");
    try {
      await postJson("/api/admin/orders/payments", "POST", {
        orderIds: chosen.map(order => order.id),
        amountCents: parsed,
        method: String(form.get("method") ?? ""),
        note: String(form.get("note") ?? ""),
        providerTransactionId: String(form.get("providerTransactionId") ?? "")
      });
      setSaved(true);
      setMessage("Payment recorded. Each selected order is marked paid and linked to it. The customer was not emailed.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save this change.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <form onSubmit={event => { void submit(event); }} className="border-2 border-ink bg-crumb p-3 print:hidden">
    <h2 className="font-black uppercase tracking-wide">One payment for several orders</h2>
    <p className="mt-1 text-sm">Use this when one Venmo or cash payment covers more than one order. The amount has to equal the selected orders&apos; totals or it will not be saved. No transaction ID or open deadline is required, and the customer is not emailed.</p>
    <fieldset disabled={busy || saved} className="mt-3 space-y-3 disabled:opacity-60">
      <div className="grid gap-2">
        {props.orders.map(order => <label key={order.id} className="flex items-start gap-3 border-2 border-ink bg-page p-3 text-sm normal-case tracking-normal">
          <input className="mt-1 h-4 w-4 shrink-0" type="checkbox" checked={selected.includes(order.id)} onChange={() => toggle(order.id)} />
          <span><span className="font-black">{order.customerName}</span> · {order.summary || "No items"} · {formatMoney(order.totalCents)} {order.currency}{order.textOrder ? " · Text order" : ""}<span className="mt-1 block break-all font-mono text-xs">{order.id}</span></span>
        </label>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">Amount received<input name="amount" type="text" inputMode="decimal" placeholder="0.00" autoComplete="off" value={amount} onChange={event => { setAmount(event.target.value); setMessage(""); }} required /></label>
        <label className="block">Payment method<select name="method" required defaultValue="VENMO">{ADMIN_PAYMENT_METHODS.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label>
      </div>
      <label className="block">Transaction ID (optional)<input name="providerTransactionId" autoComplete="off" maxLength={160} /></label>
      <label className="block">Note (optional)<input name="note" type="text" maxLength={1000} autoComplete="off" /></label>
      <p className="text-sm font-bold" role={mismatch ? "alert" : "status"}>{chosen.length < 2 ? "Select at least two orders." : currencies.size > 1 ? "Selected orders must use the same currency. Nothing will be saved." : match?.message}</p>
      <button className="btn-primary" type="submit" disabled={!ready || busy || saved}>{busy ? "Saving..." : "Record payment and mark these orders paid"}</button>
    </fieldset>
    {message ? <p role={saved ? "status" : "alert"} aria-live="polite" className="mt-3 border-2 border-ink bg-page p-3 text-sm font-bold">{message}</p> : null}
  </form>;
}
