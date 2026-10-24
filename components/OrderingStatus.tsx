import React from "react";
import { ADMIN_CHECKOUT_BLOCKED_LEAD, ADMIN_TEST_MODE_BANNER, ALTERNATE_FULFILLMENT_NOTE, ORDERING_UNAVAILABLE_MESSAGE } from "@/lib/config-messages";
import { DELIVERY_FEE_COPY } from "@/lib/delivery-pricing";
import { PICKUP_AREA } from "@/lib/pickup-location";

export function AdminOrderingBanner({ testMode, reasons }: { testMode: boolean; reasons: string[] }) {
  if (!testMode && reasons.length === 0) return null;
  return (
    <div className="mb-3 border-2 border-ink bg-jam p-3 text-sm font-black" role="status">
      {testMode ? <p>{ADMIN_TEST_MODE_BANNER}</p> : (
        <>
          <p>{ADMIN_CHECKOUT_BLOCKED_LEAD}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 font-bold">
            {reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}

export function OrderingBadge({ orderingOpen, unavailable }: { orderingOpen: boolean; unavailable: boolean }) {
  const label = orderingOpen ? "Orders Open" : unavailable ? "Ordering unavailable" : "Orders Closed";
  const tone = orderingOpen ? "bg-sage text-white" : "bg-jam text-ink";
  return <span className={`badge ${tone}`}>{label}</span>;
}

export function OrderingUnavailableNotice({ email }: { email?: string | null }) {
  const contact = email?.trim() ?? "";
  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-widest text-ink/70">{ORDERING_UNAVAILABLE_MESSAGE}</p>
      {contact ? (
        <p className="mt-1 text-sm font-medium text-ink/80">
          Email <a className="font-black underline" href={`mailto:${contact}`}>{contact}</a>.
        </p>
      ) : null}
    </div>
  );
}

export function AlternateFulfillmentNote({ day, email }: { day: string; email?: string | null }) {
  const contact = email?.trim() ?? "";
  const [before, after] = ALTERNATE_FULFILLMENT_NOTE.replace("{day}", day).split("Email us");
  return (
    <p className="mt-2 text-sm font-medium text-ink/80">
      {before}
      {contact ? <a className="font-black underline" href={`mailto:${contact}`}>Email us</a> : "Email us"}
      {after}
    </p>
  );
}

export function PickupAreaNote() {
  return (
    <>
      <p className="mt-2 text-sm font-medium text-ink/80">
        Pickup: {PICKUP_AREA}. The bakery confirms the exact spot after payment.
      </p>
      <p className="mt-1 text-sm font-medium text-ink/80" data-testid="delivery-fee-copy">
        Delivery: {DELIVERY_FEE_COPY}
      </p>
    </>
  );
}
