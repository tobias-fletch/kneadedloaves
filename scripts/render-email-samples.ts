import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { PICKUP_AREA } from "../lib/pickup-location";
import { renderOrderEmail, type OrderEmailDetails } from "../lib/order-email";

const due = new Date("2026-10-25T01:00:00.000Z");
const fulfillment = new Date("2026-10-25T16:00:00.000Z");
const handle = "@kneadedloaves";
const destination = "https://www.venmo.com/u/kneadedloaves";

const pickup: OrderEmailDetails = {
  customerName: "Maya Chen",
  customerEmail: "maya.chen@example.com",
  paymentReference: "KL-3F8A1C04-9B2E-4D77-A1C0-6E5D4C3B2A19",
  items: [
    { productName: "Sesame Sourdough", quantity: 1, unitPriceCents: 1400 },
    { productName: "Olive & Rosemary Loaf", quantity: 2, unitPriceCents: 1200 }
  ],
  deliveryFeeCents: 0,
  totalCents: 3800,
  fulfillmentType: "PICKUP",
  fulfillmentDate: fulfillment,
  pickupAddress: PICKUP_AREA,
  fulfillmentInstructions: "The bakery confirms the exact handoff after payment.",
  paymentHandle: handle,
  paymentDestination: destination,
  paymentDueAt: due
};

const delivery: OrderEmailDetails = {
  customerName: "Jordan Hale",
  customerEmail: "jordan.hale@example.com",
  paymentReference: "KL-7C21D0AA-15E4-4B90-9F62-0A8E3C55D174",
  items: [
    { productName: "Country Miche", quantity: 1, unitPriceCents: 1600 },
    { productName: "Honey Butter Roll", quantity: 1, unitPriceCents: 450 }
  ],
  deliveryFeeCents: 0,
  totalCents: 2050,
  fulfillmentType: "DELIVERY",
  fulfillmentDate: fulfillment,
  deliveryAddress: "184 Dean Street, Apt 3",
  deliveryZip: "11217",
  fulfillmentInstructions: "Free delivery in 11217.",
  paymentHandle: handle,
  paymentDestination: destination,
  paymentDueAt: due
};

const samples = [
  ["email_customer_pickup", renderOrderEmail("customer-reservation", pickup)],
  ["email_customer_delivery", renderOrderEmail("customer-reservation", delivery)],
  ["email_payment_verified", renderOrderEmail("payment-verified", pickup)],
  ["email_admin_new_order", renderOrderEmail("admin-new-order", {
    ...pickup,
    customerName: "Priya Shah",
    customerEmail: "priya.shah@example.com",
    paymentReference: "KL-91C0E2B4-7A55-4C18-8D30-44F1A0B9C6E2",
    items: [
      { productName: "Sesame Sourdough", quantity: 1, unitPriceCents: 1400 },
      { productName: "Morning Bun", quantity: 1, unitPriceCents: 550 }
    ],
    totalCents: 1950
  })]
] as const;

async function main() {
  const out = path.resolve(process.argv[2] || "tmp/email-samples");
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  try {
    const page = await browser.newPage({ viewport: { width: 680, height: 900 }, deviceScaleFactor: 1 });
    await page.route("https://kneadedloaves.com/email/**", async (route) => {
      const file = path.resolve("public/email", path.basename(new URL(route.request().url()).pathname));
      if (!existsSync(file)) {
        await route.abort();
        return;
      }
      await route.fulfill({ path: file, contentType: "image/png" });
    });
    for (const [name, email] of samples) {
      const htmlPath = path.join(out, `${name}.html`);
      writeFileSync(htmlPath, email.html);
      writeFileSync(path.join(out, `${name}.txt`), email.text);
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
      const oswald = process.env.EMAIL_OSWALD_FONT;
      if (oswald && existsSync(oswald)) {
        const font = readFileSync(oswald).toString("base64");
        await page.addStyleTag({ content: `@font-face{font-family:Oswald;src:url(data:font/ttf;base64,${font}) format("truetype");font-weight:200 700;font-style:normal;}` });
      }
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
      console.log(`${name}: ${email.subject}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Could not render email samples.");
  process.exitCode = 1;
});
