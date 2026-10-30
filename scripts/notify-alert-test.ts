/**
 * Sends ONE clearly labeled fake "admin-new-order" alert through the same render + Resend code
 * the checkout/email worker use (renderOrderEmail -> mailTransport -> emailDeliveryMessage).
 * Creates no order, touches no database. Never prints secret values.
 *
 * Usage:
 *   node --import tsx scripts/notify-alert-test.ts [--env-file <path to a mode-600 file>] [--to kneadedloaves@gmail.com] [--dry-run]
 * The only setting is RESEND_API_KEY, read from the env file (KEY=value lines) or the environment.
 * The preview allowlist applies exactly as in the app when VERCEL_ENV is a non-production value.
 */
import { readFileSync, statSync } from "node:fs";
import { renderOrderEmail } from "../lib/order-email";
import { emailDeliveryMessage, mailTransport, mailerSettings } from "../lib/email-queue";
import { RESEND_SMTP_HOST, RESEND_SMTP_PORT } from "../lib/mail-provider";

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function loadEnvFile(path: string) {
  const mode = statSync(path).mode & 0o777;
  if (mode & 0o077) throw new Error(`${path} must be mode 600 (is ${mode.toString(8)}).`);
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    values[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

async function main() {
  const envFile = arg("--env-file");
  const source = envFile ? loadEnvFile(envFile) : process.env;
  const env = { RESEND_API_KEY: (source.RESEND_API_KEY ?? "").trim(), VERCEL_ENV: process.env.VERCEL_ENV };
  if (!env.RESEND_API_KEY) throw new Error("Missing: RESEND_API_KEY");
  const to = arg("--to") || "kneadedloaves@gmail.com";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
  const reference = `KL-ALERT-TEST-${stamp}`;

  const rendered = renderOrderEmail("admin-new-order", {
    customerName: "TEST ALERT — not a real order",
    customerEmail: "no-reply@example.invalid",
    paymentReference: reference,
    items: [
      { productName: "Artisan Bread", quantity: 1, unitPriceCents: 1200 },
      { productName: "Bagels (6 pack)", quantity: 1, unitPriceCents: 800 }
    ],
    deliveryFeeCents: 0,
    totalCents: 2000,
    fulfillmentType: "PICKUP",
    fulfillmentDate: null,
    fulfillmentInstructions: "TEST ALERT — not a real order. Do not fulfill, do not expect payment.",
    paymentHandle: "@kneadedloaves",
    paymentDueAt: null
  });
  const job = {
    id: `alert-test-${stamp}`,
    to,
    subject: `TEST ALERT — not a real order — ${rendered.subject} (${reference})`,
    body: `TEST ALERT — not a real order (${reference}).\n\n${rendered.text}`,
    html: rendered.html.replace("<body", `<body data-test="alert"`).replace(/(<body[^>]*>)/, `$1<p style="font:bold 18px Arial;color:#b00">TEST ALERT — not a real order (${reference})</p>`)
  };

  const settings = mailerSettings(env); // same settings as production
  console.log(`Resend relay=${RESEND_SMTP_HOST}:${RESEND_SMTP_PORT} from=${settings.from} to=${to} reference=${reference}`);
  if (process.argv.includes("--dry-run")) { console.log("Dry run: rendered OK, not sent."); return; }
  const transport = await mailTransport(undefined, env);
  const info = await transport.sendMail(emailDeliveryMessage(job, transport.from)) as { messageId?: string; accepted?: unknown; rejected?: unknown; response?: unknown };
  console.log(`SENT messageId=${info.messageId} accepted=${JSON.stringify(info.accepted)} rejected=${JSON.stringify(info.rejected)} response=${String(info.response).split(" ").slice(0, 3).join(" ")}`);
  console.log(`Now check the ${to} inbox for subject containing ${reference}.`);
}

main().catch((error) => {
  // Error messages from nodemailer/mailerSettings do not contain the API key.
  console.error(`FAILED: ${error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 300) : "unknown error"}`);
  process.exitCode = 1;
});
