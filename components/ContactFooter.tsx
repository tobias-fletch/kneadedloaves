import React from "react";
import { Instagram } from "lucide-react";
import { ContactFooterButton } from "@/components/ContactFooterButton";
import { instagramProfileUrl, type ContactDetails } from "@/lib/contact";

export function ContactFooter({ contact }: { contact: ContactDetails }) {
  return (
    <footer className="mt-10 border-t-4 border-ink bg-jam">
      <div className="section py-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display text-xl uppercase tracking-wide text-ink">Questions about an order?</p>
            <p className="mt-1 text-sm font-semibold text-ink/80">
              Reach out before the bake day and I’ll get back to you.
            </p>
            {/* Plain text on purpose: the Contact button is the way to write in. */}
            <p className="mt-1 break-all text-sm font-semibold text-ink/80">{contact.email}</p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            {contact.instagramHandle ? (
              <a
                className="inline-flex w-fit items-center gap-2 self-start text-sm font-black text-ink hover:underline sm:self-auto"
                href={instagramProfileUrl(contact.instagramHandle)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${contact.bakeryName} on Instagram`}
              >
                <Instagram size={18} aria-hidden="true" />
                @{contact.instagramHandle}
              </a>
            ) : null}
            <ContactFooterButton href="/contact" />
          </div>
        </div>
      </div>
    </footer>
  );
}
