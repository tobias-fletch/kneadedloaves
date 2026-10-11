import { encryptSecret } from "@/lib/secrets";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isSetupConfigKey, setupConfigFields } from "@/lib/app-config";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const updateSchema = z.object({
  values: z.array(
    z.object({
      key: z.string(),
      value: z.string().default(""),
      clear: z.boolean().default(false)
    })
  )
});

const fieldByKey = new Map(setupConfigFields.map((field) => [field.key, field]));

export async function POST(request: Request) {
  await requireAdmin();
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid setup settings." }, { status: 400 });

  for (const item of parsed.data.values) {
    if (!isSetupConfigKey(item.key)) continue;
    const field = fieldByKey.get(item.key);
    if (!field) continue;

    if (item.clear) {
      await prisma.appConfig.delete({ where: { key: item.key } }).catch(() => null);
      continue;
    }

    let value = item.value.trim();
    if (item.key === "JWT_SECRET" && value && (value.length < 32 || /replace-with|development|change-me/i.test(value))) return NextResponse.json({ error: "Use a random session secret of at least 32 characters." }, { status: 400 });
    if (item.key === "APP_URL" && value && !/^https?:\/\//.test(value)) return NextResponse.json({ error: "Enter a valid public URL." }, { status: 400 });
    if (!value) continue;
    if (field.secret) value = encryptSecret(value);
    await prisma.appConfig.upsert({
      where: { key: item.key },
      update: { value, secret: field.secret },
      create: { key: item.key, value, secret: field.secret }
    });
  }

  return NextResponse.json({ ok: true });
}
