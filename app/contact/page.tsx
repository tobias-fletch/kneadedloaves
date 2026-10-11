import { Instagram, Mail, Phone } from "lucide-react";
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
        <a className="panel flex items-center gap-3 p-5 transition hover:border-jam" href={`mailto:${contact.email}`}>
          <Mail className="text-jam" size={24} />
          <div>
            <p className="font-black">Email</p>
            <p className="text-sm text-ink/70">{contact.email}</p>
          </div>
        </a>
        {contact.phoneHref ? (
          <a className="panel flex items-center gap-3 p-5 transition hover:border-jam" href={contact.phoneHref}>
            <Phone className="text-jam" size={24} />
            <div>
              <p className="font-black">Phone</p>
              <p className="text-sm text-ink/70">{contact.phone}</p>
            </div>
          </a>
        ) : (
          <div className="panel flex items-center gap-3 p-5">
            <Phone className="text-ink/40" size={24} />
            <div>
              <p className="font-black">Phone</p>
              <p className="text-sm text-ink/70">Add `CONTACT_PHONE` in `.env` to show a call button.</p>
            </div>
          </div>
        )}
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
