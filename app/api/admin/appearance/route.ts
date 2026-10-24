import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { defaultAppearance, keyByField } from "@/lib/appearance";
import { prisma } from "@/lib/prisma";
import { DELIVERY_FEE_COPY } from "@/lib/delivery-pricing";

const fontValues = [
  "system-ui, sans-serif",
  "Georgia, serif",
  "'Trebuchet MS', sans-serif",
  "'Arial Black', system-ui, sans-serif"
] as const;

const color = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex color.");

const schema = z.object({
  settings: z.object({
    bakeryName: z.string().trim().min(1).max(80),
    businessDescription: z.string().trim().min(1).max(500),
    orderingOpenMessage: z.string().trim().min(1).max(240),
    orderingClosedMessage: z.string().trim().min(1).max(240)
  }),
  appearance: z.object({
    colorCrust: color,
    colorCrumb: color,
    colorButter: color,
    colorJam: color,
    colorSage: color,
    colorInk: color,
    colorPage: color,
    fontBody: z.enum(fontValues),
    fontHeading: z.enum(fontValues)
  })
});

export async function POST(request: Request) {
  await requireAdmin();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid site editor settings." }, { status: 400 });
  }

  const existing = await prisma.adminSettings.findFirst();
  const settingsData = parsed.data.settings;

  if (existing) {
    await prisma.adminSettings.update({
      where: { id: existing.id },
      data: settingsData
    });
  } else {
    await prisma.adminSettings.create({
      data: {
        ...settingsData,
        deliveryRules: DELIVERY_FEE_COPY,
        pickupRules: "Pickup details will be shared after ordering.",
        defaultHashtags: []
      }
    });
  }

  await Promise.all(
    Object.entries(parsed.data.appearance).map(([field, value]) =>
      prisma.appConfig.upsert({
        where: { key: keyByField[field as keyof typeof defaultAppearance] },
        update: { value, secret: false },
        create: { key: keyByField[field as keyof typeof defaultAppearance], value, secret: false }
      })
    )
  );

  return NextResponse.json({ ok: true });
}
