"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { CheckCircle2, Mail, MessageCircle, Send, X } from "lucide-react";
import type { ContactDetails } from "@/lib/contact";
import { buildMailtoUrl } from "@/lib/mailto";

type Field = "name" | "email" | "phone" | "message";
type FieldErrors = Partial<Record<Field, string>>;

const LIMITS = { nameMax: 120, emailMax: 254, phoneMax: 40, messageMin: 10, messageMax: 5000 };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContactForm(values: Record<Field, string>): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.name.trim()) errors.name = "Please tell us your name.";
  else if (values.name.trim().length > LIMITS.nameMax) errors.name = "That name is a little long.";
  if (!EMAIL_PATTERN.test(values.email.trim())) errors.email = "Please enter a valid email address.";
  if (values.phone.trim().length > LIMITS.phoneMax) errors.phone = "That phone number is too long.";
  const message = values.message.trim();
  if (message.length < LIMITS.messageMin) errors.message = `Please write at least ${LIMITS.messageMin} characters.`;
  else if (message.length > LIMITS.messageMax) errors.message = `Please keep it under ${LIMITS.messageMax} characters.`;
  return errors;
}

export function ContactButton({ contact }: { contact: ContactDetails }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [sentName, setSentName] = useState("");
  const [copySent, setCopySent] = useState(false);
  const [fallbackMailto, setFallbackMailto] = useState("");
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const defaultMailto = useMemo(
    () => buildMailtoUrl({ to: contact.email, subject: `Question for ${contact.bakeryName}`, body: "Hi, I have a question about an order." }),
    [contact.bakeryName, contact.email]
  );

  useEffect(() => {
    if (!open) return;
    firstFieldRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
    if (status === "sent") { setStatus("idle"); setSentName(""); }
    triggerRef.current?.focus();
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const value = (key: string) => String(formData.get(key) ?? "");
    const values = { name: value("name"), email: value("email"), phone: value("phone"), message: value("message") };
    const errors = validateContactForm(values);
    setFieldErrors(errors);
    setErrorMessage("");
    setFallbackMailto("");
    if (Object.keys(errors).length) {
      setStatus("error");
      setErrorMessage("Please check the highlighted fields.");
      return;
    }

    setStatus("sending");
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, website: value("website") })
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        setSentName(values.name.trim().split(" ")[0] ?? "");
        setCopySent(Boolean(body.confirmationSent));
        setStatus("sent");
        return;
      }
      setStatus("error");
      setFieldErrors(body.fieldErrors ?? {});
      setErrorMessage(body.error ?? "Your message couldn't be sent just now. Please try again, or email us directly.");
      setFallbackMailto(body.mailtoUrl ?? defaultMailto);
    } catch {
      setStatus("error");
      setErrorMessage("We couldn't reach the server. Check your connection and try again, or email us directly.");
      setFallbackMailto(defaultMailto);
    }
  }

  const fieldProps = (field: Field) => ({
    id: `${id}-${field}`,
    name: field,
    "aria-invalid": fieldErrors[field] ? true : undefined,
    "aria-describedby": fieldErrors[field] ? `${id}-${field}-error` : undefined
  });
  const fieldError = (field: Field) => fieldErrors[field]
    ? <p id={`${id}-${field}-error`} className="mt-1 text-sm font-bold text-crust">{fieldErrors[field]}</p>
    : null;

  return (
    <>
      <button ref={triggerRef} className="btn-primary w-full sm:w-auto" type="button" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <MessageCircle size={18} aria-hidden="true" />
        Contact
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end bg-ink/55 p-3 sm:items-center sm:justify-center" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
          <div role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className="max-h-[92vh] w-full overflow-y-auto border-4 border-ink bg-page shadow-hard sm:max-w-lg">
            <div className="flex items-center justify-between gap-3 border-b-2 border-ink bg-crumb p-4">
              <div>
                <h2 id={`${id}-title`} className="font-display text-2xl uppercase tracking-wide">Contact {contact.bakeryName}</h2>
                <p className="mt-1 text-sm text-ink/70">Send a message here, or use your own email app.</p>
              </div>
              <button className="btn-secondary px-3" type="button" aria-label="Close contact form" onClick={close}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-4 p-4">
              {status === "sent" ? (
                <div role="status" aria-live="polite" className="space-y-3 border-2 border-ink bg-sage p-4 text-white">
                  <p className="flex items-center gap-2 font-display text-xl uppercase tracking-wide">
                    <CheckCircle2 size={22} aria-hidden="true" />
                    Thank you{sentName ? `, ${sentName}` : ""}!
                  </p>
                  <p className="text-sm font-semibold">Your message is on its way. I&rsquo;ll get back to you soon{copySent ? ", and a copy of your note is headed to your inbox" : ""}.</p>
                  <button type="button" className="btn-secondary w-full" onClick={close}>Close</button>
                </div>
              ) : (
                <form onSubmit={onSubmit} noValidate className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor={`${id}-name`}>Name</label>
                      <input ref={firstFieldRef} {...fieldProps("name")} autoComplete="name" required maxLength={LIMITS.nameMax} />
                      {fieldError("name")}
                    </div>
                    <div>
                      <label htmlFor={`${id}-email`}>Email</label>
                      <input {...fieldProps("email")} type="email" inputMode="email" autoComplete="email" required maxLength={LIMITS.emailMax} />
                      {fieldError("email")}
                    </div>
                  </div>
                  <div>
                    <label htmlFor={`${id}-phone`}>Phone <span className="font-semibold normal-case tracking-normal text-ink/60">(optional)</span></label>
                    <input {...fieldProps("phone")} type="tel" autoComplete="tel" maxLength={LIMITS.phoneMax} />
                    {fieldError("phone")}
                  </div>
                  <div>
                    <label htmlFor={`${id}-message`}>Message</label>
                    <textarea {...fieldProps("message")} rows={4} required minLength={LIMITS.messageMin} maxLength={LIMITS.messageMax} />
                    {fieldError("message")}
                  </div>
                  {/* Honeypot: hidden from people and assistive tech; bots that fill it are ignored. */}
                  <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
                    <label htmlFor={`${id}-website`}>Website</label>
                    <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
                  </div>
                  <button type="submit" className="btn-primary w-full" disabled={status === "sending"}>
                    <Send size={18} aria-hidden="true" />
                    {status === "sending" ? "Sending..." : "Send message"}
                  </button>
                  <div aria-live="assertive">
                    {status === "error" && errorMessage ? (
                      <p role="alert" className="border-2 border-ink bg-crumb p-3 text-sm font-bold text-ink">{errorMessage}</p>
                    ) : null}
                  </div>
                </form>
              )}

              {status === "sent" ? null : (
                <a className="btn-secondary w-full sm:w-auto" href={fallbackMailto || defaultMailto}>
                  <Mail size={18} aria-hidden="true" />
                  Email {contact.email}
                </a>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
