import { DeleteWindowButton } from "@/components/DeleteWindowButton";
import { EditWindowForm } from "@/components/EditWindowForm";
import { formatEasternDateTime, formatEasternDay, toEasternDateTimeLocal } from "@/lib/format-datetime";
import { prisma } from "@/lib/prisma";
import { WeeklyScheduleForm } from "@/components/WeeklyScheduleForm";
import { WeekOverrideForm } from "@/components/WeekOverrideForm";
import { getWeekOverrides, getWeeklySettings, resolveWeekly } from "@/lib/order-window";
import { applyOverride, describeWeeklyWindow, weekKeysAround } from "@/lib/weekly-window";

async function loadWeekly(now: Date) {
  const { settings, available } = await getWeeklySettings();
  if (!available) return { settings, available, weeks: [], preview: null, managedIds: new Set<string>() };
  const overrides = await getWeekOverrides(prisma, weekKeysAround(settings, now, 1, 6));
  const weeks = weekKeysAround(settings, now, 1, 6)
    .map((key) => ({ ...applyOverride(settings, key, overrides.get(key)), hasOverride: Boolean(overrides.get(key)?.opensAt || overrides.get(key)?.closesAt || overrides.get(key)?.fulfillmentDate || overrides.get(key)?.skip || overrides.get(key)?.message) }))
    .filter((week) => week.closesAt.getTime() >= now.getTime())
    .slice(0, 6);
  const resolved = await resolveWeekly(prisma, now);
  const managed = await prisma.weeklyOrderWeek.findMany({ where: { orderWindowId: { not: null } }, select: { orderWindowId: true } });
  return { settings, available, weeks, preview: resolved ? describeWeeklyWindow(resolved.resolution) : null, managedIds: new Set(managed.map((row) => row.orderWindowId!)) };
}

export default async function AdminWindowsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const windows = await prisma.orderWindow.findMany({ include: { orders: true }, orderBy: { opensAt: "desc" } }).catch(() => []);
  const weekly = await loadWeekly(new Date());
  const weeklyOn = weekly.settings.enabled;
  return (
    <div className="space-y-5">
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <WeeklyScheduleForm settings={weekly.settings} available={weekly.available} />
      <section className="space-y-3">
        <div className="panel p-4" data-testid="weekly-preview">
          <h2 className="font-black">What customers see</h2>
          {weekly.preview ? (
            <>
              <p className="mt-2 font-black">{weekly.preview.headline}</p>
              {weekly.preview.detail ? <p className="text-sm text-ink/70">{weekly.preview.detail}</p> : null}
            </>
          ) : <p className="mt-2 text-sm text-ink/70">Weekly schedule is off. Customers see the one-off windows below.</p>}
        </div>
        {weekly.weeks.map((week) => (
          <div className="panel p-4" key={week.weekKey}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-black">Week closing {formatEasternDay(week.closesAt)}</h2>
              {week.skip ? <span className="badge bg-jam text-page">No orders</span> : week.overridden ? <span className="badge bg-crumb text-ink">Changed this week</span> : <span className="badge bg-page text-ink">Weekly schedule</span>}
            </div>
            <p className="mt-2 text-sm text-ink/70">Open {formatEasternDateTime(week.opensAt)} to {formatEasternDateTime(week.closesAt)}</p>
            <p className="text-sm font-semibold text-jam">Fulfillment {formatEasternDay(week.fulfillmentDate)}</p>
            {week.message ? <p className="text-sm">Message: {week.message}</p> : null}
            <WeekOverrideForm
              weekKey={week.weekKey}
              opensAt={toEasternDateTimeLocal(week.opensAt)}
              closesAt={toEasternDateTimeLocal(week.closesAt)}
              fulfillmentDate={toEasternDateTimeLocal(week.fulfillmentDate)}
              skip={week.skip}
              message={week.message ?? ""}
              hasOverride={week.hasOverride}
            />
          </div>
        ))}
      </section>
    </div>
    <h2 className="text-2xl font-black">{weeklyOn ? "Past and one-off windows" : "One-off windows"}</h2>
    {weeklyOn ? <p className="text-sm text-ink/70">While the weekly schedule is on, customers can only order in the weekly window. Windows here keep their orders.</p> : null}
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <form className="panel space-y-3 p-4" action="/api/admin/windows" method="post">
        <h2 className="text-lg font-black">Create window</h2>
        <p className="text-sm text-ink/70">All times are Eastern Time (ET).</p>
        {error ? <p className="text-sm font-semibold text-jam" role="alert">{error}</p> : null}
        <input name="name" placeholder="Weekly Bake" required />
        <label>Opens (Eastern Time)</label>
        <input name="opensAt" type="datetime-local" required />
        <label>Closes (Eastern Time)</label>
        <input name="closesAt" type="datetime-local" required />
        <label>Delivery/pickup date (Eastern Time)</label>
        <input name="fulfillmentDate" type="datetime-local" required />
        <input name="maxOrders" placeholder="Max orders" type="number" />
        <button className="btn-primary w-full">Create</button>
      </form>
      <section className="space-y-3">
        {windows.map((window) => (
          <div className="panel p-4" key={window.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-black">{window.name}</h2>
              <span className="badge bg-crumb text-ink">{window.orders.length}/{window.maxOrders ?? "∞"} orders</span>
            </div>
            <p className="mt-2 text-sm text-ink/70">Open {formatEasternDateTime(window.opensAt)} to {formatEasternDateTime(window.closesAt)}</p>
            <p className="text-sm font-semibold text-jam">Fulfillment {formatEasternDay(window.fulfillmentDate)}</p>
            {weeklyOn && weekly.managedIds.has(window.id) ? <p className="mt-2 text-xs font-bold uppercase tracking-wide text-ink/70">Set by the weekly schedule. Use &ldquo;Change this week only&rdquo; above.</p> : <EditWindowForm
              windowId={window.id}
              opensAt={toEasternDateTimeLocal(window.opensAt)}
              closesAt={toEasternDateTimeLocal(window.closesAt)}
              fulfillmentDate={toEasternDateTimeLocal(window.fulfillmentDate)}
              maxOrders={window.maxOrders}
            />}
            <div className="mt-3">
              <DeleteWindowButton windowId={window.id} windowName={window.name} />
            </div>
          </div>
        ))}
      </section>
    </div>
    </div>
  );
}
