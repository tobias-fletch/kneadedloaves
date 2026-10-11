"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type WindowValues = {
  id: string;
  name: string;
  opensAt: string;
  closesAt: string;
  fulfillmentDate: string;
  maxOrders: number | null;
  manualOpen: boolean;
  manualClosed: boolean;
};

export function OrderWindowEditor({ window: initial }: { window?: WindowValues }) {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const prefix = initial?.id ?? "new-window";

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage("");
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const { mode, ...fields } = values;
    try {
      const response = await fetch(initial ? `/api/admin/windows/${initial.id}` : "/api/admin/windows", {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, manualOpen: mode === "early", manualClosed: mode === "closed" })
      });
      if (response.redirected) throw new Error("Your admin session expired. Sign in again before saving.");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not save this window.");
      setError(false);
      setMessage(body.warning ?? (initial ? "Window updated." : "Window created."));
      if (!initial) form.reset();
      router.refresh();
    } catch (error) {
      setError(true);
      setMessage(error instanceof Error ? error.message : "Could not save this window. Try again.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={save}>
      <p className="text-sm text-ink/70">All times are America/New_York (Eastern). Create a separate window for each delivery day, with its confirmed time and capacity.</p>
      <div>
        <label htmlFor={`${prefix}-name`}>Window name</label>
        <input id={`${prefix}-name`} name="name" placeholder="Window name" required maxLength={120} defaultValue={initial?.name} />
      </div>
      <div>
        <label htmlFor={`${prefix}-opens`}>Orders open (Eastern)</label>
        <input id={`${prefix}-opens`} name="opensAt" type="datetime-local" step="1" required defaultValue={initial?.opensAt} />
      </div>
      <div>
        <label htmlFor={`${prefix}-closes`}>Order cutoff (Eastern)</label>
        <input id={`${prefix}-closes`} name="closesAt" type="datetime-local" step="1" required defaultValue={initial?.closesAt} />
        <p className="mt-1 text-xs text-ink/70">Thursday for Saturday delivery; Friday for Sunday delivery. Checkout closes at this exact time.</p>
      </div>
      <div>
        <label htmlFor={`${prefix}-fulfillment`}>Saturday or Sunday delivery (Eastern)</label>
        <input id={`${prefix}-fulfillment`} name="fulfillmentDate" type="datetime-local" step="1" required defaultValue={initial?.fulfillmentDate} />
      </div>
      <div>
        <label htmlFor={`${prefix}-capacity`}>Maximum orders for this delivery</label>
        <input id={`${prefix}-capacity`} name="maxOrders" placeholder="Confirmed capacity" type="number" min="1" max="2147483647" step="1" required defaultValue={initial?.maxOrders ?? ""} />
      </div>
      <div>
        <label htmlFor={`${prefix}-mode`}>Ordering status</label>
        <select id={`${prefix}-mode`} name="mode" defaultValue={initial?.manualClosed ? "closed" : initial?.manualOpen ? "early" : "scheduled"}>
          <option value="scheduled">Follow the schedule</option>
          <option value="early">Open early until the cutoff</option>
          <option value="closed">Manually closed</option>
        </select>
      </div>
      <button className="btn-primary w-full" disabled={pending} type="submit">{pending ? "Saving..." : initial ? "Save window" : "Create window"}</button>
      {message ? <p role={error ? "alert" : "status"} className={`text-sm font-semibold ${error ? "text-jam" : "text-sage"}`}>{message}</p> : null}
    </form>
  );
}
