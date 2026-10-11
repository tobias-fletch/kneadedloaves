"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Templates = {
  pickupSubject: string;
  pickupBody: string;
  deliverySubject: string;
  deliveryBody: string;
};

export function EmailTemplateForm({ templates }: { templates: Templates }) {
  const router = useRouter();
  const [message, setMessage] = useState("");

  async function submit(formData: FormData) {
    setMessage("");
    const response = await fetch("/api/admin/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pickupSubject: formData.get("pickupSubject"),
        pickupBody: formData.get("pickupBody"),
        deliverySubject: formData.get("deliverySubject"),
        deliveryBody: formData.get("deliveryBody")
      })
    });
    const body = await response.json();
    setMessage(response.ok ? "Email templates saved." : body.error ?? "Could not save email templates.");
    if (response.ok) router.refresh();
  }

  return (
    <form action={submit} className="space-y-5">
      <TemplateSection
        body={templates.pickupBody}
        bodyName="pickupBody"
        subject={templates.pickupSubject}
        subjectName="pickupSubject"
        title="Pickup confirmation"
      />
      <TemplateSection
        body={templates.deliveryBody}
        bodyName="deliveryBody"
        subject={templates.deliverySubject}
        subjectName="deliverySubject"
        title="Delivery confirmation"
      />
      <section className="panel p-4">
        <h2 className="text-lg font-black">Template variables</h2>
        <p className="mt-2 text-sm leading-6 text-ink/70">
          Use {"{{customerName}}"}, {"{{orderId}}"}, {"{{items}}"}, {"{{total}}"}, {"{{fulfillmentType}}"}, and {"{{fulfillmentInstructions}}"}.
        </p>
      </section>
      <button className="btn-primary">Save email templates</button>
      {message ? <p className="text-sm font-semibold text-sage">{message}</p> : null}
    </form>
  );
}

function TemplateSection({
  title,
  subjectName,
  subject,
  bodyName,
  body
}: {
  title: string;
  subjectName: string;
  subject: string;
  bodyName: string;
  body: string;
}) {
  return (
    <section className="panel space-y-3 p-4">
      <h2 className="text-lg font-black">{title}</h2>
      <div>
        <label>Subject</label>
        <input name={subjectName} defaultValue={subject} required />
      </div>
      <div>
        <label>Body</label>
        <textarea className="min-h-56 font-mono" name={bodyName} defaultValue={body} required rows={10} />
      </div>
    </section>
  );
}
