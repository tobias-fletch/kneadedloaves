import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getWeeklySettings, hasWeeklyTables } from "@/lib/order-window";
import { assertWindowOrder, parseWindowTimes } from "@/lib/order-window-input";
import { isWeekKey, scheduledWeek } from "@/lib/weekly-window";

async function weekFor(weekKeyParam: string) {
  if (!await hasWeeklyTables(prisma)) throw new Error("The weekly window database update hasn't been applied yet.");
  const weekKey = decodeURIComponent(weekKeyParam);
  if (!isWeekKey(weekKey)) throw new Error("Unknown week.");
  const { settings } = await getWeeklySettings();
  return { weekKey, base: scheduledWeek(settings, weekKey) };
}

/** Overrides one week: custom open/close/fulfillment (Eastern Time), or skip the week, with an optional message. */
export async function PUT(request: Request, { params }: { params: Promise<{ weekKey: string }> }) {
  await requireAdmin();
  try {
    const { weekKey, base } = await weekFor((await params).weekKey);
    const body = await request.json();
    const times = parseWindowTimes(body, false);
    assertWindowOrder(times.opensAt ?? base.opensAt, times.closesAt ?? base.closesAt);
    const skip = body.skip === true || body.skip === "true" || body.skip === "on";
    const message = String(body.message ?? "").trim().slice(0, 300) || null;
    const data = { overrideOpensAt: times.opensAt ?? null, overrideClosesAt: times.closesAt ?? null, overrideFulfillmentDate: times.fulfillmentDate ?? null, skip, message };
    const saved = await prisma.weeklyOrderWeek.upsert({ where: { weekKey }, create: { weekKey, ...data }, update: data });
    return NextResponse.json(saved);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Check the override." }, { status: 400 });
  }
}

/** Clears a week's override so it follows the weekly schedule again. Orders stay attached. */
export async function DELETE(_: Request, { params }: { params: Promise<{ weekKey: string }> }) {
  await requireAdmin();
  try {
    const { weekKey } = await weekFor((await params).weekKey);
    await prisma.weeklyOrderWeek.updateMany({ where: { weekKey }, data: { overrideOpensAt: null, overrideClosesAt: null, overrideFulfillmentDate: null, skip: false, message: null } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not clear the override." }, { status: 400 });
  }
}
