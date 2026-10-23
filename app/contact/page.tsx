import React from "react";
import type { Metadata } from "next";
import { Instagram, Mail } from "lucide-react";
import { ContactForm } from "@/components/ContactForm";
import { getContactDetails, instagramProfileUrl } from "@/lib/contact";

export const metadata: Metadata = {
  title: "Contact | Kneaded Loaves",
  description: "Questions about an order, special requests, pickup timing or delivery notes? Send Kneaded Loaves a message."
};

export default async function ContactPage() {
  const contact = await getContactDetails();

  return (
    <main className="section space-y-6">
      <div>
        <h1 className="text-3xl font-black">Contact {contact.bakeryName}</h1>
        <p className="mt-2 text-ink/70">Order questions, special requests, pickup timing, or delivery notes? Send a message and I&rsquo;ll reply by email.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="panel p-5 sm:p-6" aria-labelledby="contact-form-title">
          <h2 id="contact-form-title" className="font-display text-2xl uppercase tracking-wide">Send a message</h2>
          <p className="mb-4 mt-1 text-sm text-ink/70">You&rsquo;ll get a short confirmation with a copy of your note.</p>
          <ContactForm email={contact.email} />
        </section>
        <aside className="space-y-4">
          <div className="panel flex items-center gap-3 p-5">
            <Mail className="shrink-0 text-jam" size={24} aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-black">Email</p>
              {/* Plain text on purpose: no mailto link. */}
              <p className="break-all text-sm text-ink/70">{contact.email}</p>
            </div>
          </div>
          {contact.instagramHandle ? (
            <a
              className="panel flex items-center gap-3 p-5 transition hover:border-jam"
              href={instagramProfileUrl(contact.instagramHandle)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${contact.bakeryName} on Instagram`}
            >
              <Instagram className="shrink-0 text-jam" size={24} aria-hidden="true" />
              <div>
                <p className="font-black">Instagram</p>
                <p className="text-sm text-ink/70">@{contact.instagramHandle}</p>
              </div>
            </a>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
