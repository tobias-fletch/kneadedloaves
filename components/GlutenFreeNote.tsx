import Link from "next/link";
import React from "react";
import { GLUTEN_FREE_ON_REQUEST_NOTE } from "@/lib/config-messages";

export function GlutenFreeNote({ email }: { email?: string | null }) {
  const contact = email?.trim() ?? "";
  return (
    <p className="mt-3 text-sm font-medium leading-6 text-ink/80">
      {GLUTEN_FREE_ON_REQUEST_NOTE}
      {contact ? <> at {contact} or <Link className="font-black underline" href="/contact">send us a message</Link></> : null}.
    </p>
  );
}
