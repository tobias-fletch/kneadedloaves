import { ContactButton } from "@/components/ContactButton";
import type { ContactDetails } from "@/lib/contact";

export function ContactFooter({ contact }: { contact: ContactDetails }) {
  return (
    <footer className="mt-10 border-t-4 border-ink bg-jam">
      <div className="section py-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display text-xl uppercase tracking-wide text-ink">Questions about an order?</p>
            <p className="mt-1 text-sm font-semibold text-ink/80">Reach out before the bake day and I’ll get back to you.</p>
          </div>
          <ContactButton contact={contact} />
        </div>
      </div>
    </footer>
  );
}
