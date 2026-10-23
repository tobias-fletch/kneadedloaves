import React from "react";
import { Instagram, Mail } from "lucide-react";
import { getContactDetails, instagramProfileUrl } from "@/lib/contact";

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
          <a
            className="panel flex items-center gap-3 p-5 transition hover:border-jam"
            href={instagramProfileUrl(contact.instagramHandle)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${contact.bakeryName} on Instagram`}
          >
            <Instagram className="text-jam" size={24} aria-hidden="true" />
            <div>
              <p className="font-black">Instagram</p>
              <p className="text-sm text-ink/70">@{contact.instagramHandle}</p>
            </div>
          </a>
        ) : null}
      </section>
    </main>
  );
}
