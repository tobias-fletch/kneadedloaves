"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, Send } from "lucide-react";

type Field = "name" | "email" | "message";
type FieldErrors = Partial<Record<Field, string>>;

const LIMITS = { nameMax: 120, emailMax: 254, messageMin: 10, messageMax: 5000 };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContactForm(values: Record<Field, string>): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.name.trim()) errors.name = "Please tell us your name.";
  else if (values.name.trim().length > LIMITS.nameMax) errors.name = "That name is a little long.";
  if (!EMAIL_PATTERN.test(values.email.trim())) errors.email = "Please enter a valid email address.";
  const message = values.message.trim();
  if (message.length < LIMITS.messageMin) errors.message = `Please write at least ${LIMITS.messageMin} characters.`;
  else if (message.length > LIMITS.messageMax) errors.message = `Please keep it under ${LIMITS.messageMax} characters.`;
  return errors;
}

/** The /contact form. Errors fall back to the bakery address as plain text, never a mailto link. */
export function ContactForm({ email }: { email: string }) {
  const id = useId();
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [sentName, setSentName] = useState("");
  const [copySent, setCopySent] = useState(false);
  // Set after mount, so the server can ignore submissions made faster than a person could type.
  const startedAt = useRef<number | null>(null);
  useEffect(() => { startedAt.current = Date.now(); }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const value = (key: string) => String(formData.get(key) ?? "");
    const values = { name: value("name"), email: value("email"), message: value("message") };
    const errors = validateContactForm(values);
    setFieldErrors(errors);
    setErrorMessage("");
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
        body: JSON.stringify({ ...values, website: value("website"), startedAt: startedAt.current })
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
      setErrorMessage(body.error ?? `Your message couldn't be sent just now. Please try again, or email us at ${email}.`);
    } catch {
      setStatus("error");
      setErrorMessage(`We couldn't reach the server. Check your connection and try again, or email us at ${email}.`);
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

  if (status === "sent") {
    return (
      <div role="status" aria-live="polite" className="space-y-3 border-2 border-ink bg-sage p-5 text-white">
        <p className="flex items-center gap-2 font-display text-2xl uppercase tracking-wide">
          <CheckCircle2 size={24} aria-hidden="true" />
          Thank you{sentName ? `, ${sentName}` : ""}!
        </p>
        <p className="text-sm font-semibold">
          Your message is on its way. I&rsquo;ll get back to you soon{copySent ? ", and a copy of your note is headed to your inbox" : ""}.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Contact Kneaded Loaves">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-name`}>Name</label>
          <input {...fieldProps("name")} autoComplete="name" required maxLength={LIMITS.nameMax} />
          {fieldError("name")}
        </div>
        <div>
          <label htmlFor={`${id}-email`}>Email</label>
          <input {...fieldProps("email")} type="email" inputMode="email" autoComplete="email" required maxLength={LIMITS.emailMax} />
          {fieldError("email")}
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-message`}>Message</label>
        <textarea {...fieldProps("message")} rows={6} required minLength={LIMITS.messageMin} maxLength={LIMITS.messageMax} placeholder="Order questions, special requests, pickup timing, delivery notes…" />
        {fieldError("message")}
      </div>
      {/* Honeypot: hidden from people and assistive tech; bots that fill it are ignored. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label htmlFor={`${id}-website`}>Website</label>
        <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <button type="submit" className="btn-primary w-full sm:w-auto" disabled={status === "sending"}>
        <Send size={18} aria-hidden="true" />
        {status === "sending" ? "Sending..." : "Send message"}
      </button>
      <div aria-live="assertive">
        {status === "error" && errorMessage ? (
          <p role="alert" className="border-2 border-ink bg-crumb p-3 text-sm font-bold text-ink">{errorMessage}</p>
        ) : null}
      </div>
    </form>
  );
}
