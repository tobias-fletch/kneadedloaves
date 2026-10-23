"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = { windowId: string; opensAt: string; closesAt: string; fulfillmentDate: string; maxOrders: number | null };

/** Edits an existing window. Date-time fields are pre-filled and saved as Eastern Time (America/New_York). */
export function EditWindowForm(props: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSaving(true);
    setMessage("");
    const response = await fetch(`/api/admin/windows/${props.windowId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        opensAt: data.get("opensAt"),
        closesAt: data.get("closesAt"),
        fulfillmentDate: data.get("fulfillmentDate"),
        maxOrders: data.get("maxOrders")
      })
    });
    const body = await response.json().catch(() => ({}));
    setSaving(false);
    if (response.ok) {
      setMessage("Saved.");
      router.refresh();
    } else {
      setMessage(body.error ?? "Could not save window.");
    }
  }

  return (
    <details className="mt-3 border-t-2 border-ink pt-3">
      <summary className="cursor-pointer text-sm font-black uppercase tracking-wide">Edit times</summary>
      <form className="mt-3 space-y-2" onSubmit={save}>
        <label htmlFor={`opensAt-${props.windowId}`}>Opens (Eastern Time)</label>
        <input id={`opensAt-${props.windowId}`} name="opensAt" type="datetime-local" defaultValue={props.opensAt} required />
        <label htmlFor={`closesAt-${props.windowId}`}>Closes (Eastern Time)</label>
        <input id={`closesAt-${props.windowId}`} name="closesAt" type="datetime-local" defaultValue={props.closesAt} required />
        <label htmlFor={`fulfillmentDate-${props.windowId}`}>Delivery/pickup date (Eastern Time)</label>
        <input id={`fulfillmentDate-${props.windowId}`} name="fulfillmentDate" type="datetime-local" defaultValue={props.fulfillmentDate} required />
        <label htmlFor={`maxOrders-${props.windowId}`}>Max orders (blank for no limit)</label>
        <input id={`maxOrders-${props.windowId}`} name="maxOrders" type="number" min={1} defaultValue={props.maxOrders ?? ""} />
        <button className="btn-primary" disabled={saving} type="submit">{saving ? "Saving..." : "Save times"}</button>
        {message ? <p className="text-sm font-semibold text-jam">{message}</p> : null}
      </form>
    </details>
  );
}
