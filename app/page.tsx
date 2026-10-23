import { MenuProductImage } from "@/components/MenuProductImage";
import { format } from "date-fns";
import { AddToCartButton } from "@/components/AddToCartButton";
import { DatabaseSetup, databaseErrorMessage } from "@/components/DatabaseSetup";
import { GlutenFreeNote } from "@/components/GlutenFreeNote";
import { AdminOrderingBanner, AlternateFulfillmentNote, OrderingBadge, OrderingUnavailableNotice, PickupAreaNote } from "@/components/OrderingStatus";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorefrontOrderingState } from "@/lib/storefront-ordering";
import { formatMoney } from "@/lib/money";
import { bakeryJsonLd } from "@/lib/site";
import type { Metadata } from "next";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function HomePage() {
  try {
    const session = await getSession();
    const [ordering, settings, products, events] = await Promise.all([
      getStorefrontOrderingState(session?.role === "ADMIN"),
      prisma.adminSettings.findFirst(),
      prisma.product.findMany({ where: { active: true }, include: { images: true, category: true }, orderBy: { name: "asc" } }),
      prisma.popupEvent.findMany({ where: { startsAt: { gte: new Date() } }, take: 3, orderBy: { startsAt: "asc" } })
    ]);
    const { openWindow, nextWindow, orderingOpen, unavailable, contact, adminTestMode, adminSetupReasons } = ordering;

    return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(bakeryJsonLd()).replace(/</g, "\\u003c") }} />
      <section className="border-b-4 border-ink">
        <div className="section py-10">
          <div className="border-4 border-ink bg-crumb p-6 shadow-hard sm:p-10">
            <div className="flex flex-wrap items-center gap-3">
              <OrderingBadge orderingOpen={orderingOpen} unavailable={unavailable} />
              <span className="h-1.5 flex-1 bg-jam" aria-hidden="true" />
            </div>
            <h1 className="font-display mt-6 text-6xl uppercase leading-[0.95] text-ink sm:text-8xl">
              {settings?.bakeryName ?? "Kneaded Loaves"}
            </h1>
            <p className="mt-4 max-w-xl text-base font-medium leading-7 text-ink/80">
              {settings?.businessDescription ?? "Small-batch breads and pastries baked for limited weekly order windows."}
            </p>
            <div className="mt-6 border-2 border-ink bg-page p-4">
              {adminTestMode || adminSetupReasons.length > 0 ? <AdminOrderingBanner testMode={adminTestMode} reasons={adminSetupReasons} /> : null}
              {adminSetupReasons.length > 0 ? null : unavailable ? <OrderingUnavailableNotice email={contact.email} /> : (
                <p className="text-sm font-bold uppercase tracking-widest text-ink/70">
                  {openWindow ? settings?.orderingOpenMessage : settings?.orderingClosedMessage}
                </p>
              )}
              <p className="font-display mt-1 text-2xl uppercase tracking-wide">
                {openWindow
                  ? `Fulfillment: ${format(openWindow.fulfillmentDate, "EEEE, MMM d")}`
                  : nextWindow
                    ? `Next opens: ${format(nextWindow.opensAt, "MMM d, h:mm a")}`
                    : "Next window coming soon"}
              </p>
              {openWindow ? <AlternateFulfillmentNote day={format(openWindow.fulfillmentDate, "EEEE")} email={contact.email} /> : null}
              <PickupAreaNote />
            </div>
          </div>
        </div>
      </section>

      <section className="section space-y-6" id="shop">
        <div className="border-4 border-ink bg-page p-5 shadow-hard">
          <div className="flex items-stretch gap-4">
            <span className="w-3 shrink-0 bg-jam" aria-hidden="true" />
            <div className="flex-1">
              <OrderingBadge orderingOpen={orderingOpen} unavailable={unavailable} />
              <h2 className="font-display mt-3 text-4xl uppercase tracking-wide text-ink sm:text-5xl">Weekly menu</h2>
              {adminTestMode || adminSetupReasons.length > 0 ? <div className="mt-2"><AdminOrderingBanner testMode={adminTestMode} reasons={adminSetupReasons} /></div> : null}
              {adminSetupReasons.length > 0 ? null : unavailable ? <div className="mt-2"><OrderingUnavailableNotice email={contact.email} /></div> : (
                <p className="mt-2 text-sm font-medium text-ink/70">
                  {orderingOpen
                    ? `Checkout is open until ${format(openWindow!.closesAt, "MMM d, h:mm a")}. Fulfillment is ${format(openWindow!.fulfillmentDate, "EEEE, MMM d")}.`
                    : nextWindow
                      ? `Browse now. Checkout opens ${format(nextWindow.opensAt, "MMM d, h:mm a")}.`
                      : "Browse now. The next ordering window will be announced soon."}
                </p>
              )}
              <PickupAreaNote />
              <GlutenFreeNote email={contact.email} />
            </div>
          </div>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => {
            const soldOut = product.soldOut || product.inventoryLimit <= 0;
            return (
              <article className="flex flex-col border-2 border-ink bg-page shadow-hard" key={product.id}>
                {product.images[0] ? (
                  <MenuProductImage alt={product.images[0].alt ?? product.name} src={product.images[0].url} />
                ) : null}
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-sage">{product.category?.name ?? "Bakery"}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="inline-block bg-jam px-2 py-1 text-xl font-black uppercase tracking-wide text-ink">
                      {product.name}
                    </h3>
                    <p className="text-2xl font-black text-ink">{formatMoney(product.priceCents)}</p>
                  </div>
                  <p className="text-sm font-medium text-ink/75">{product.description}</p>
                  <div className="mt-auto space-y-1 border-t-2 border-ink/15 pt-3">
                    <p className="text-xs font-medium text-ink/60">Ingredients: {product.ingredients.join(", ") || "Ask for details"}</p>
                  </div>
                  <AddToCartButton productId={product.id} disabled={!orderingOpen || soldOut} />
                  {soldOut ? <span className="badge self-start bg-jam text-ink">Sold out</span> : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="section" id="events">
        <div className="flex items-center gap-4">
          <h2 className="font-display text-3xl uppercase tracking-wide text-ink sm:text-4xl">Upcoming events</h2>
          <span className="h-1.5 flex-1 bg-jam" aria-hidden="true" />
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {events.length ? events.map((event) => (
            <div className="border-2 border-ink bg-page p-4 shadow-hard" key={event.id}>
              <p className="text-sm font-black uppercase tracking-widest text-sage">{format(event.startsAt, "EEEE, MMM d, h:mm a")}</p>
              <h3 className="mt-1 text-lg font-black uppercase tracking-wide">{event.title}</h3>
              <p className="text-sm font-medium text-ink/70">{event.location}</p>
            </div>
          )) : <div className="border-2 border-ink bg-page p-4 text-sm font-medium text-ink/70 shadow-hard">No events scheduled yet.</div>}
        </div>
      </section>
    </main>
    );
  } catch (error) {
    return <DatabaseSetup detail={databaseErrorMessage(error)} />;
  }
}
