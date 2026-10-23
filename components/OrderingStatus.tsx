import React from "react";
import { ORDERING_UNAVAILABLE_MESSAGE } from "@/lib/config-messages";
import { PICKUP_AREA } from "@/lib/pickup-location";

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

export function PickupAreaNote() {
  return (
    <p className="mt-2 text-sm font-medium text-ink/80">
      Pickup area: {PICKUP_AREA}. The bakery confirms the exact spot after payment.
    </p>
  );
}
