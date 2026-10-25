import React from "react";
import type { Metadata } from "next";
import { Instagram, Mail } from "lucide-react";
import { ContactForm } from "@/components/ContactForm";
import { CONTACT_FORM_ID } from "@/lib/contact-form-anchor";
import { getContactDetails, instagramProfileUrl } from "@/lib/contact";

const CONTACT_TITLE = "Contact | Kneaded Loaves";
// Setting openGraph/twitter here replaces the root ones, so the share card image is listed again.
const SHARE_IMAGE_ALT = "Kneaded Loaves, small-batch breads and pastries baked for limited weekly order windows. kneadedloaves.com";
const CONTACT_DESCRIPTION = "Questions about an order, special requests, pickup timing or delivery notes? Send Kneaded Loaves a message and I'll reply by email.";

export const metadata: Metadata = {
  title: CONTACT_TITLE,
  description: CONTACT_DESCRIPTION,
  alternates: { canonical: "/contact" },
  openGraph: {
    siteName: "Kneaded Loaves",
    title: CONTACT_TITLE,
    description: CONTACT_DESCRIPTION,
    url: "/contact",
    type: "website",
    images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: SHARE_IMAGE_ALT, type: "image/png" }]
  },
  twitter: {
    card: "summary_large_image",
    title: CONTACT_TITLE,
    description: CONTACT_DESCRIPTION,
    images: [{ url: "/twitter-image.png", width: 1200, height: 630, alt: SHARE_IMAGE_ALT, type: "image/png" }]
  }
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
        <section id={CONTACT_FORM_ID} className="panel p-5 sm:p-6" aria-labelledby="contact-form-title">
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
