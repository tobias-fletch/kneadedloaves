import React from "react";
import { GLUTEN_FREE_ON_REQUEST_NOTE } from "@/lib/config-messages";

export function GlutenFreeNote({ email }: { email?: string | null }) {
  const contact = email?.trim() ?? "";
  return (
    <p className="mt-3 text-sm font-medium leading-6 text-ink/80">
      {GLUTEN_FREE_ON_REQUEST_NOTE}
      {contact ? <> at <a className="font-black underline" href={`mailto:${contact}`}>{contact}</a></> : null}.
    </p>
  );
}
