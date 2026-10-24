import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasWeeklyTables } from "@/lib/order-window";
import { droppedOverridesMessage, parseWeeklySettings, planWeeklySave } from "@/lib/weekly-window";

const CLEARED = { overrideOpensAt: null, overrideClosesAt: null, overrideFulfillmentDate: null, skip: false, message: null };

/**
 * Saves the recurring weekly order window. Days/times are Eastern Time.
 * If the close day changes, upcoming one-week overrides would be dropped; that needs
 * `confirmDropOverrides: true` in the body, otherwise 409 with the count. Dropping clears the
 * override fields only; the week row (and any orders on its window) stays.
 */
export async function PUT(request: Request) {
  await requireAdmin();
  if (!await hasWeeklyTables(prisma)) return NextResponse.json({ error: "The weekly window database update hasn't been applied yet. It runs with the next production deploy." }, { status: 409 });
  let body: Record<string, unknown>;
  let settings;
  try {
    body = await request.json();
    settings = parseWeeklySettings(body);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Check the weekly window settings." }, { status: 400 });
  }
  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.weeklyOrderWeek.findMany({ select: { weekKey: true, overrideOpensAt: true, overrideClosesAt: true, overrideFulfillmentDate: true, skip: true, message: true } });
    const plan = planWeeklySave(settings, rows, body.confirmDropOverrides);
    if (plan.blocked) return { blocked: true as const, dropKeys: plan.dropKeys };
    if (plan.dropKeys.length) await tx.weeklyOrderWeek.updateMany({ where: { weekKey: { in: plan.dropKeys } }, data: CLEARED });
    const saved = await tx.weeklyOrderSchedule.upsert({ where: { id: "default" }, create: { id: "default", ...settings }, update: settings });
    return { blocked: false as const, saved, dropped: plan.dropKeys };
  });
  if (result.blocked) {
    return NextResponse.json({ error: droppedOverridesMessage(result.dropKeys.length), needsConfirm: true, overridesToDrop: result.dropKeys.length, weeks: result.dropKeys }, { status: 409 });
  }
  return NextResponse.json({ ...result.saved, droppedOverrides: result.dropped.length });
}
