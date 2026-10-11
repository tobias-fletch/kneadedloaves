import { getCheckoutReadiness } from "@/lib/checkout-readiness";
import Image from "next/image";
import { format } from "date-fns";
import { AddToCartButton } from "@/components/AddToCartButton";
import { DatabaseSetup, databaseErrorMessage } from "@/components/DatabaseSetup";
import { prisma } from "@/lib/prisma";
import { getCurrentOrderWindow } from "@/lib/order-window";
import { formatMoney } from "@/lib/money";
import { formatBakeryDate } from "@/lib/bakery-time";

export default async function HomePage() {
  let data;
  try {
    data = await Promise.all([
      getCurrentOrderWindow(),
      prisma.adminSettings.findFirst(),
      prisma.product.findMany({ where: { active: true }, include: { images: true, category: true }, orderBy: { name: "asc" } }),
      prisma.popupEvent.findMany({ where: { startsAt: { gte: new Date() } }, take: 3, orderBy: { startsAt: "asc" } }),
      getCheckoutReadiness()
    ]);
  } catch (error) {
    return <DatabaseSetup detail={databaseErrorMessage(error)} />;
  }
  const [{ openWindow, nextWindow }, settings, products, events, checkout] = data;
  const orderingOpen = Boolean(openWindow) && checkout.providers.length > 0;

  return (
    <main>
      <section className="bg-crumb">
        <div className="section py-10">
          <div className="space-y-5">
            <span className={`badge ${orderingOpen ? "bg-sage text-white" : "bg-jam text-white"}`}>
              {orderingOpen ? "Orders Open" : "Orders Closed"}
            </span>
            <div>
              <h1 className="text-4xl font-black tracking-normal text-ink sm:text-5xl">
                {settings?.bakeryName ?? "Kneaded Loaves"}
              </h1>
              <p className="mt-3 max-w-xl text-base leading-7 text-ink/75">
                {settings?.businessDescription ?? "Small-batch breads and pastries baked for limited weekly order windows."}
              </p>
            </div>
            <div className="rounded-lg bg-white p-4 shadow-soft">
              <p className="text-sm font-semibold text-ink/70">
                {orderingOpen ? settings?.orderingOpenMessage : settings?.orderingClosedMessage}
              </p>
              <p className="mt-1 text-lg font-black">
                {openWindow
                  ? `Fulfillment: ${formatBakeryDate(openWindow.fulfillmentDate, { weekday: "long", month: "short", day: "numeric" })}`
                  : nextWindow
                    ? `Next opens: ${formatBakeryDate(nextWindow.opensAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}`
                    : "Next window coming soon"}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section space-y-5" id="shop">
        <div className="panel p-4">
          <span className={`badge ${orderingOpen ? "bg-sage text-white" : "bg-jam text-white"}`}>
            {orderingOpen ? "Orders Open" : "Orders Closed"}
          </span>
          <h2 className="mt-3 text-3xl font-black">Weekly menu</h2>
          <p className="mt-2 text-sm text-ink/70">
            {orderingOpen
              ? `Checkout is open until ${formatBakeryDate(openWindow!.closesAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}. Fulfillment is ${formatBakeryDate(openWindow!.fulfillmentDate, { weekday: "long", month: "short", day: "numeric" })}.`
              : nextWindow
                ? `Browse now. Checkout opens ${formatBakeryDate(nextWindow.opensAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}.`
                : "Browse now. The next ordering window will be announced soon."}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => {
            const soldOut = product.soldOut || product.inventoryLimit <= 0;
            return (
              <article className="panel overflow-hidden" key={product.id}>
                {product.images[0] ? (
                  <Image alt={product.images[0].alt ?? product.name} className="h-52 w-full object-cover" src={product.images[0].url} width={800} height={600} />
                ) : null}
                <div className="space-y-3 p-4">
                  <div>
                    <p className="text-xs font-bold uppercase text-sage">{product.category?.name ?? "Bakery"}</p>
                    <h3 className="text-xl font-black">{product.name}</h3>
                    <p className="text-sm text-ink/70">{product.description}</p>
                  </div>
                  <p className="font-black text-jam">{formatMoney(product.priceCents)}</p>
                  <p className="text-xs text-ink/60">Ingredients: {product.ingredients.join(", ") || "Ask for details"}</p>
                  <p className="text-xs text-ink/60">Allergens: {product.allergens.join(", ") || "Not yet confirmed; contact the bakery"}</p>
                  <AddToCartButton productId={product.id} disabled={!orderingOpen || soldOut} />
                  {soldOut ? <span className="badge bg-jam text-white">Sold out</span> : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="section" id="events">
        <h2 className="mb-4 text-2xl font-black">Upcoming events</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {events.length ? events.map((event) => (
            <div className="panel p-4" key={event.id}>
              <p className="text-sm font-bold text-sage">{format(event.startsAt, "EEEE, MMM d, h:mm a")}</p>
              <h3 className="font-black">{event.title}</h3>
              <p className="text-sm text-ink/70">{event.location}</p>
            </div>
          )) : <div className="panel p-4 text-sm text-ink/70">No events scheduled yet.</div>}
        </div>
      </section>
    </main>
  );
}
