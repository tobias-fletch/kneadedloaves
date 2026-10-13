import { destinationFingerprint, validVenmoDestination } from "@/lib/manual-payment-config";
import { getAppConfigValues } from "@/lib/app-config";
import { readJson } from "@/lib/request";
import { encryptSecret } from "@/lib/secrets";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isSetupConfigKey, setupConfigFields } from "@/lib/app-config";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const updateSchema = z.object({
  values: z.array(z.object({ key: z.string(), value: z.string().max(10000).default(""), clear: z.boolean().default(false) })).max(60)
});
const fieldByKey = new Map(setupConfigFields.map((field) => [field.key, field]));
export async function POST(request: Request) {
  await requireAdmin();
  const parsed = updateSchema.safeParse(await readJson(request));
  if (!parsed.success || new Set(parsed.data?.values.map(item => item.key)).size !== parsed.data?.values.length) return NextResponse.json({ error: "Invalid setup settings." }, { status: 400 });
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'manual-payment-config'}))`;
    const current = await getAppConfigValues(["VENMO_HANDLE", "VENMO_DESTINATION", "VENMO_DESTINATION_VERIFIED", "VENMO_VERIFIED_FINGERPRINT"], tx);
    const incoming = new Map(parsed.data.values.map(item => [item.key, item.clear ? "" : item.value.trim()]));
    for (const item of parsed.data.values) {
      const env = process.env[item.key]?.trim();
      if (env && /^(VENMO_|PAYMENT_|CHECKOUT_SMOKE_TESTED)/.test(item.key) && (item.clear || item.value.trim() !== env)) return NextResponse.json({ error: `${item.key} is managed by the deployment environment. Change it there before updating these payment settings.` }, { status: 409 });
    }
    const handle = incoming.get("VENMO_HANDLE") ?? current.VENMO_HANDLE;
    const destination = incoming.get("VENMO_DESTINATION") ?? current.VENMO_DESTINATION;
    const destinationChanged = handle !== current.VENMO_HANDLE || destination !== current.VENMO_DESTINATION;
    if (destinationChanged && process.env.VENMO_CHECKOUT_ENABLED?.trim() === "true") return NextResponse.json({ error: "Disable VENMO_CHECKOUT_ENABLED in the deployment environment before changing the receiving destination." }, { status: 409 });
    if (handle && !/^@[A-Za-z0-9_-]{3,30}$/.test(handle)) return NextResponse.json({ error: "Enter the exact public Venmo handle, including @." }, { status: 400 });
    if (destination && !validVenmoDestination(destination)) return NextResponse.json({ error: "Paste the HTTPS business receiving link copied directly from Venmo." }, { status: 400 });
    const hold = incoming.get("PAYMENT_HOLD_MINUTES");
    if (hold && (!/^\d+$/.test(hold) || Number(hold) < 1 || Number(hold) > 10080)) return NextResponse.json({ error: "Choose a payment hold duration between 1 and 10080 minutes." }, { status: 400 });
    const jwtSecret = incoming.get("JWT_SECRET");
    if (jwtSecret && (jwtSecret.length < 32 || /replace-with|development|change-me/i.test(jwtSecret))) return NextResponse.json({ error: "Use a random session secret of at least 32 characters." }, { status: 400 });
    const appUrl = incoming.get("APP_URL");
    if (appUrl) { try { const url = new URL(appUrl); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash || (process.env.NODE_ENV === "production" && url.protocol !== "https:")) throw new Error(); } catch { return NextResponse.json({ error: "Enter the canonical shop origin, using HTTPS in production." }, { status: 400 }); } }
    if (!destinationChanged && incoming.get("VENMO_DESTINATION_VERIFIED") === "true" && (!handle || !validVenmoDestination(destination))) return NextResponse.json({ error: "Complete the receiving destination before verification." }, { status: 400 });
    // Changing the destination always revokes its prior attestation and checkout enablement.
    // A separate save after inspecting the new destination is required to attest again.
    for (const item of parsed.data.values) {
      if (item.key === "VENMO_VERIFIED_FINGERPRINT") continue;
      if (destinationChanged && ["VENMO_DESTINATION_VERIFIED", "VENMO_CHECKOUT_ENABLED"].includes(item.key)) continue;
      if (!isSetupConfigKey(item.key)) continue;
      const field = fieldByKey.get(item.key);
      if (!field) continue;
      if (item.clear) { await tx.appConfig.deleteMany({ where: { key: item.key } }); continue; }
      let value = item.value.trim();
      if (!value) continue;
      if (field.secret) value = encryptSecret(value);
      await tx.appConfig.upsert({ where: { key: item.key }, update: { value, secret: field.secret }, create: { key: item.key, value, secret: field.secret } });
    }
    if (destinationChanged) {
      for (const key of ["VENMO_DESTINATION_VERIFIED", "VENMO_CHECKOUT_ENABLED", "VENMO_VERIFIED_FINGERPRINT"]) await tx.appConfig.upsert({ where: { key }, create: { key, value: key === "VENMO_VERIFIED_FINGERPRINT" ? "" : "false", secret: false }, update: { value: key === "VENMO_VERIFIED_FINGERPRINT" ? "" : "false", secret: false } });
    } else if (incoming.get("VENMO_DESTINATION_VERIFIED") === "true") {
      if (!handle || !validVenmoDestination(destination)) throw new Error("Complete the receiving destination before verification.");
      await tx.appConfig.upsert({ where: { key: "VENMO_VERIFIED_FINGERPRINT" }, create: { key: "VENMO_VERIFIED_FINGERPRINT", value: destinationFingerprint(handle, destination), secret: false }, update: { value: destinationFingerprint(handle, destination), secret: false } });
    }
    return NextResponse.json({ ok: true, message: destinationChanged ? "Receiving destination saved. Checkout and verification are disabled. Independently inspect the new destination, then verify it in a separate save." : "Setup settings saved." });
  });
}
