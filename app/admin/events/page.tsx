import { format } from "date-fns";
import { prisma } from "@/lib/prisma";

export default async function AdminEventsPage() {
  const [events, products] = await Promise.all([
    prisma.popupEvent.findMany({ include: { products: true }, orderBy: { startsAt: "desc" } }),
    prisma.product.findMany({ orderBy: { name: "asc" } })
  ]);
  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <form className="panel space-y-3 p-4" action="/api/admin/events" method="post">
        <h2 className="text-lg font-black">Create event</h2>
        <input name="title" placeholder="Event title" required />
        <input name="startsAt" type="datetime-local" required />
        <input name="location" placeholder="Location" required />
        <textarea name="description" placeholder="Description" required rows={3} />
        <select name="productIds" multiple>
          {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
        </select>
        <input name="rsvpUrl" placeholder="RSVP URL" type="url" />
        <button className="btn-primary w-full">Create</button>
      </form>
      <section className="space-y-3">
        {events.map((event) => (
          <div className="panel p-4" key={event.id}>
            <p className="text-sm font-bold text-sage">{format(event.startsAt, "MMM d, h:mm a")}</p>
            <h2 className="font-black">{event.title}</h2>
            <p className="text-sm text-ink/70">{event.location}</p>
            <p className="mt-2 text-sm">{event.description}</p>
            <p className="mt-2 text-xs font-semibold text-jam">{event.products.map((p) => p.name).join(", ") || "No products linked"}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
