import React from "react";
import { Instagram, Mail } from "lucide-react";
import { getContactDetails } from "@/lib/contact";

export default async function ContactPage() {
  const contact = await getContactDetails();

  return (
    <main className="section space-y-5">
      <div>
        <h1 className="text-3xl font-black">Contact {contact.bakeryName}</h1>
        <p className="mt-2 text-ink/70">Use email for order questions, special requests, pickup timing, or delivery notes.</p>
      </div>
      <section className="grid gap-4 md:grid-cols-2">
        {contact.email ? (
          <a className="panel flex items-center gap-3 p-5 transition hover:border-jam" href={`mailto:${contact.email}`}>
            <Mail className="text-jam" size={24} />
            <div>
              <p className="font-black">Email</p>
              <p className="text-sm text-ink/70">{contact.email}</p>
            </div>
          </a>
        ) : null}
        {contact.instagramHandle ? (
          <div className="panel flex items-center gap-3 p-5 md:col-span-2">
            <Instagram className="text-jam" size={24} />
            <div>
              <p className="font-black">Instagram</p>
              <p className="text-sm text-ink/70">{contact.instagramHandle}</p>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
