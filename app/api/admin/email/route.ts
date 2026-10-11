import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const emailTemplateSchema = z.object({
  pickupSubject: z.string().min(3),
  pickupBody: z.string().min(10),
  deliverySubject: z.string().min(3),
  deliveryBody: z.string().min(10)
});

const fieldMap = {
  pickupSubject: "EMAIL_PICKUP_SUBJECT",
  pickupBody: "EMAIL_PICKUP_BODY",
  deliverySubject: "EMAIL_DELIVERY_SUBJECT",
  deliveryBody: "EMAIL_DELIVERY_BODY"
} as const;

export async function POST(request: Request) {
  await requireAdmin();
  const parsed = emailTemplateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid email template." }, { status: 400 });

  await Promise.all(
    Object.entries(fieldMap).map(([inputKey, configKey]) =>
      prisma.appConfig.upsert({
        where: { key: configKey },
        update: { value: parsed.data[inputKey as keyof typeof fieldMap], secret: false },
        create: { key: configKey, value: parsed.data[inputKey as keyof typeof fieldMap], secret: false }
      })
    )
  );

  return NextResponse.json({ ok: true });
}
