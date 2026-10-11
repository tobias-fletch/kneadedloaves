"use client";

import { useMemo, useState } from "react";
import { Mail, MessageCircle, Phone, Send, X } from "lucide-react";
import type { ContactDetails } from "@/lib/contact";
import { buildMailtoUrl } from "@/lib/mailto";

export function ContactButton({ contact }: { contact: ContactDetails }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [fallbackMailto, setFallbackMailto] = useState("");

  const defaultMailto = useMemo(
    () =>
      buildMailtoUrl({
        to: contact.email,
        subject: `Question for ${contact.bakeryName}`,
        body: "Hi, I have a question about an order."
      }),
    [contact.bakeryName, contact.email]
  );

  async function submit(formData: FormData) {
    setStatus("sending");
    setMessage("");
    setFallbackMailto("");

    const payload = {
      name: formData.get("name"),
      email: formData.get("email"),
      phone: formData.get("phone"),
      message: formData.get("message")
    };

    const response = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json();

    if (response.ok) {
      setStatus("sent");
      setMessage("Message sent. Thank you.");
      return;
    }

    setStatus("error");
    setMessage(body.error ?? "Could not send from the site. You can send from your email app instead.");
    setFallbackMailto(body.mailtoUrl ?? defaultMailto);
  }

  return (
    <>
      <button className="btn-primary w-full sm:w-auto" type="button" onClick={() => setOpen(true)}>
        <MessageCircle size={18} />
        Contact
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end bg-ink/55 p-3 sm:items-center sm:justify-center">
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-lg bg-[#fffaf3] shadow-soft sm:max-w-lg">
            <div className="flex items-center justify-between border-b border-amber-200 p-4">
              <div>
                <h2 className="text-xl font-black">Contact {contact.bakeryName}</h2>
                <p className="mt-1 text-sm text-ink/70">Send a message here, or use your own email app.</p>
              </div>
              <button className="btn-secondary px-3" type="button" aria-label="Close contact popup" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 p-4">
              <form action={submit} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label>Name</label>
                    <input name="name" required />
                  </div>
                  <div>
                    <label>Email</label>
                    <input name="email" type="email" required />
                  </div>
                </div>
                <div>
                  <label>Phone</label>
                  <input name="phone" type="tel" />
                </div>
                <div>
                  <label>Message</label>
                  <textarea name="message" rows={4} required />
                </div>
                <button className="btn-primary w-full" disabled={status === "sending"}>
                  <Send size={18} />
                  {status === "sending" ? "Sending..." : "Send from this site"}
                </button>
              </form>

              {message ? (
                <p className={`rounded-md p-3 text-sm font-semibold ${status === "sent" ? "bg-sage text-white" : "bg-crumb text-jam"}`}>
                  {message}
                </p>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2">
                <a className="btn-secondary" href={fallbackMailto || defaultMailto}>
                  <Mail size={18} />
                  Use my email app
                </a>
                {contact.phoneHref ? (
                  <a className="btn-secondary" href={contact.phoneHref}>
                    <Phone size={18} />
                    Call
                  </a>
                ) : (
                  <span className="btn-secondary text-ink/60" aria-disabled="true">
                    <Phone size={18} />
                    Phone not set
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
