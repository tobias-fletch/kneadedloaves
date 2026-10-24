import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasWeeklyTables } from "@/lib/order-window";
import { parseWeeklySettings } from "@/lib/weekly-window";

/** Saves the recurring weekly order window. Days/times are Eastern Time. */
export async function PUT(request: Request) {
  await requireAdmin();
  if (!await hasWeeklyTables(prisma)) return NextResponse.json({ error: "The weekly window database update hasn't been applied yet. It runs with the next production deploy." }, { status: 409 });
  let settings;
  try {
    settings = parseWeeklySettings(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Check the weekly window settings." }, { status: 400 });
  }
  const saved = await prisma.weeklyOrderSchedule.upsert({ where: { id: "default" }, create: { id: "default", ...settings }, update: settings });
  return NextResponse.json(saved);
}
