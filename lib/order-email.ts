import type { Prisma } from "@prisma/client";
import { BAKERY_CONTACT_EMAIL } from "@/lib/config-messages";
import { customerVisibleInstructions, DISTANCE_NOT_VERIFIED_EMAIL_LINE, hasLegacyDistanceNote } from "@/lib/delivery-pricing";
import { formatDeadline, formatFulfillmentDate } from "@/lib/format-datetime";
import { formatMoney } from "@/lib/money";
import { PICKUP_AREA } from "@/lib/pickup-location";

export const ADMIN_TEST_REFERENCE_PREFIX = "KL-ADMIN-TEST-";

const CRUST = "#A85A2A";
const CRUMB = "#D8CDAE";
const BUTTER = "#E88B4A";
const JAM = "#D9703B";
const SAGE = "#55663A";
const INK = "#3B4527";
const PAGE = "#E9E4D3";
const BODY = "Inter,Segoe UI,Helvetica,Arial,sans-serif";
const DISPLAY = "Oswald,Arial Narrow,Arial,Helvetica,sans-serif";
const EMAIL_HEADER_LOGO = "https://kneadedloaves.com/email/kl-c1-email-header-600.png";
const EMAIL_HEADER_LOGO_2X = "https://kneadedloaves.com/email/kl-c1-email-header-1200@2x.png";

export type OrderEmailItem = { productName: string; quantity: number; unitPriceCents: number };

export type OrderEmailDetails = {
  customerName: string;
  customerEmail?: string | null;
  paymentReference: string | null;
  items: OrderEmailItem[];
  deliveryFeeCents: number;
  totalCents: number;
  fulfillmentType: "PICKUP" | "DELIVERY";
  fulfillmentDate?: Date | null;
  pickupAddress?: string | null;
  deliveryAddress?: string | null;
  deliveryZip?: string | null;
  fulfillmentInstructions?: string | null;
  paymentHandle?: string | null;
  paymentDestination?: string | null;
  paymentDueAt?: Date | null;
  /** Delivery distance could not be verified. Shown only in the admin new-order email. */
  distanceUnverified?: boolean;
};

export type OrderEmailKind = "customer-reservation" | "admin-new-order" | "payment-verified" | "reservation-expired" | "admin-payment-review";

export type RenderedEmail = { subject: string; text: string; html: string };

type Row = { label: string; value: string; highlight?: boolean };

type EmailModel = {
  subject: string;
  preheader: string;
  greeting: string[];
  banner: string | null;
  referenceLine: string;
  customerLines: string[];
  items: { label: string; amount: string }[];
  subtotal: string;
  deliveryFee: string;
  total: string;
  fulfillmentHeading: "PICKUP" | "DELIVERY";
  fulfillmentLines: string[];
  paymentRows: Row[];
  paymentNotes: string[];
  nextSteps: string[];
};

const subjects: Record<OrderEmailKind, string> = {
  "customer-reservation": "Bakery reservation received — awaiting payment",
  "admin-new-order": "New bakery reservation awaiting payment",
  "payment-verified": "Bakery payment verified",
  "reservation-expired": "Your bakery reservation expired",
  "admin-payment-review": "Bakery payment needs review"
};

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function clean(value: string | null | undefined) {
  return (value ?? "").replace(/\u0000/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function dated(value: Date | null | undefined, format: (date: Date) => string, missing: string) {
  if (!value || Number.isNaN(value.getTime())) return missing;
  return format(value);
}

/** Public Venmo receiving link only. Anything else is omitted rather than printed. */
export function publicVenmoLink(value: string | null | undefined) {
  try {
    if (!value) return null;
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !["venmo.com", "www.venmo.com", "account.venmo.com"].includes(url.hostname)) return null;
    if (url.username || url.password || url.port || url.pathname === "/") return null;
    return url.href;
  } catch {
    return null;
  }
}

export async function fulfillmentDateFor(tx: Prisma.TransactionClient, orderWindowId: string | null | undefined) {
  if (!orderWindowId) return null;
  const window = await tx.orderWindow.findUnique({ where: { id: orderWindowId }, select: { fulfillmentDate: true } });
  return window?.fulfillmentDate ?? null;
}

export function detailsFromOrder(order: {
  customerName: string;
  customerEmail?: string | null;
  paymentReference?: string | null;
  items: OrderEmailItem[];
  deliveryFeeCents: number;
  totalCents: number;
  fulfillmentType: "PICKUP" | "DELIVERY";
  fulfillmentLocation?: string | null;
  deliveryAddress?: string | null;
  fulfillmentInstructions?: string | null;
  paymentHandle?: string | null;
  paymentDestination?: string | null;
  paymentDueAt?: Date | null;
}, fulfillmentDate?: Date | null): OrderEmailDetails {
  const stored = clean(order.deliveryAddress || order.fulfillmentLocation).split("\n").map((line) => line.trim()).filter(Boolean);
  if (order.fulfillmentType === "DELIVERY") {
    const zip = stored.find((line) => /^\d{5}$/.test(line)) ?? null;
    return {
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      paymentReference: order.paymentReference ?? null,
      items: order.items,
      deliveryFeeCents: order.deliveryFeeCents,
      totalCents: order.totalCents,
      fulfillmentType: "DELIVERY",
      fulfillmentDate,
      deliveryAddress: stored.filter((line) => line !== zip).join(", ") || null,
      deliveryZip: zip,
      fulfillmentInstructions: order.fulfillmentInstructions,
      paymentHandle: order.paymentHandle,
      paymentDestination: order.paymentDestination,
      paymentDueAt: order.paymentDueAt
    };
  }
  const address = stored.length > 1 ? stored.slice(1).join(", ") : stored[0] || PICKUP_AREA;
  return {
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    paymentReference: order.paymentReference ?? null,
    items: order.items,
    deliveryFeeCents: order.deliveryFeeCents,
    totalCents: order.totalCents,
    fulfillmentType: "PICKUP",
    fulfillmentDate,
    pickupAddress: address.includes("11217") ? address : `${address}, ${PICKUP_AREA}`,
    fulfillmentInstructions: order.fulfillmentInstructions,
    paymentHandle: order.paymentHandle,
    paymentDestination: order.paymentDestination,
    paymentDueAt: order.paymentDueAt
  };
}

function fulfillmentCopy(details: OrderEmailDetails, kind: OrderEmailKind) {
  const date = dated(details.fulfillmentDate, formatFulfillmentDate, "We'll confirm the date with you.");
  // The admin-only distance note never reaches an email body as instructions; the admin email gets its own line below.
  const notes = clean(customerVisibleInstructions(details.fulfillmentInstructions));
  if (details.fulfillmentType === "DELIVERY") {
    const address = clean(details.deliveryAddress) || "The delivery address is on the bakery order.";
    const zip = clean(details.deliveryZip);
    const lines = [address, zip ? `ZIP ${zip}` : "ZIP is on the bakery order.", date];
    const unverified = details.distanceUnverified === true || hasLegacyDistanceNote(details.fulfillmentInstructions);
    if (kind === "admin-new-order" && unverified) lines.push(DISTANCE_NOT_VERIFIED_EMAIL_LINE);
    if (notes) lines.push(notes);
    return { heading: "DELIVERY" as const, lines };
  }
  const address = clean(details.pickupAddress) || PICKUP_AREA;
  const lines = [address, date];
  if (notes) lines.push(notes);
  else lines.push("The bakery confirms the exact handoff after payment.");
  return { heading: "PICKUP" as const, lines };
}

function buildModel(kind: OrderEmailKind, details: OrderEmailDetails): EmailModel {
  const admin = kind === "admin-new-order" || kind === "admin-payment-review";
  const name = clean(details.customerName) || "there";
  const reference = clean(details.paymentReference) || "Not recorded. Email the bakery before paying.";
  const handle = clean(details.paymentHandle) || "@kneadedloaves";
  const total = formatMoney(details.totalCents);
  const deliveryFee = formatMoney(details.deliveryFeeCents);
  const subtotal = formatMoney(details.totalCents - details.deliveryFeeCents);
  const deadline = dated(details.paymentDueAt, formatDeadline, "Email the bakery before paying. No pay-by deadline is recorded.");
  const when = details.fulfillmentType === "DELIVERY" ? "delivery" : "pickup";
  const testOrder = clean(details.paymentReference).startsWith(ADMIN_TEST_REFERENCE_PREFIX);
  const link = publicVenmoLink(details.paymentDestination);
  const fulfillment = fulfillmentCopy(details, kind);
  const unpaid = kind === "customer-reservation" || kind === "admin-new-order";
  const greeting = greetingFor(kind, name, when);
  const paymentRows: Row[] = [
    { label: "Venmo", value: handle },
    ...(link ? [{ label: "Receiving link", value: link }] : []),
    { label: "Exact amount", value: total },
    { label: unpaid ? "Venmo note" : "Payment reference", value: reference, highlight: true },
    { label: unpaid ? "Pay by" : "Pay-by deadline", value: deadline }
  ];
  if (kind === "payment-verified") paymentRows.push({ label: "Status", value: "Verified. No further payment is due." });
  if (kind === "reservation-expired") paymentRows.push({ label: "Status", value: "This deadline has passed. Do not send a new payment." });
  if (kind === "admin-new-order") paymentRows.push({ label: "Status", value: "Unverified. Do not mark this order paid yet." });
  if (kind === "admin-payment-review") paymentRows.push({ label: "Status", value: "Customer asked for a check. This is not payment proof." });
  return {
    subject: subjects[kind],
    preheader: preheaderFor(kind, deadline),
    greeting,
    banner: testOrder ? `Admin test order. The reference starts with ${ADMIN_TEST_REFERENCE_PREFIX}. This is a real order in the database.` : null,
    referenceLine: `Order ${reference}`,
    customerLines: admin ? [`Customer: ${name}`, ...(clean(details.customerEmail) ? [`Email: ${clean(details.customerEmail)}`] : [])] : [],
    items: details.items.map((item) => ({
      label: `${item.quantity} x ${clean(item.productName) || "Item"}`,
      amount: formatMoney(item.unitPriceCents * item.quantity)
    })),
    subtotal,
    deliveryFee,
    total,
    fulfillmentHeading: fulfillment.heading,
    fulfillmentLines: fulfillment.lines,
    paymentRows,
    paymentNotes: paymentNotesFor(kind),
    nextSteps: nextStepsFor(kind, when, testOrder)
  };
}

function greetingFor(kind: OrderEmailKind, name: string, when: string) {
  if (kind === "admin-new-order") return ["Hi,", `A new reservation for ${name} is waiting on Venmo. Do not mark it paid until you see the exact amount and the full payment reference in the Venmo account.`];
  if (kind === "admin-payment-review") return ["Hi,", `${name} says they already sent payment. That request is not proof of payment. Check Venmo yourself for the exact amount and the full reference before the deadline.`];
  if (kind === "payment-verified") return [`Hi ${name},`, `We checked Venmo and verified your payment. This order is paid and scheduled for ${when}.`];
  if (kind === "reservation-expired") return [`Hi ${name},`, "This reservation expired before we verified a payment. It is not scheduled. Do not send a new payment."];
  return [`Hi ${name},`, `Thanks for ordering from Kneaded Loaves. We saved this reservation, and it is not paid yet. It is not scheduled for ${when} until we verify your Venmo payment.`];
}

function preheaderFor(kind: OrderEmailKind, deadline: string) {
  if (kind === "payment-verified") return "Your Kneaded Loaves payment is verified.";
  if (kind === "reservation-expired") return `This reservation expired. The deadline was ${deadline}.`;
  if (kind === "admin-payment-review") return `Check Venmo before ${deadline}. A customer note is not payment proof.`;
  if (kind === "admin-new-order") return `New unpaid reservation. Check Venmo before ${deadline}.`;
  return `Reservation awaiting payment. Pay by ${deadline}.`;
}

function paymentNotesFor(kind: OrderEmailKind) {
  if (kind === "customer-reservation") return ["Payment has not been confirmed.", "Put only the payment reference in the Venmo note. Do not include your address or other private details."];
  if (kind === "admin-new-order") return ["Match a Venmo payment to the exact amount and the full reference before marking the order paid."];
  if (kind === "reservation-expired") return ["If you already paid, keep your Venmo receipt and email the bakery. A late payment does not schedule this order."];
  if (kind === "admin-payment-review") return ["Customer attestation is not payment proof. This order will not auto-expire: confirm the payment in Venmo and mark it paid, or cancel it."];
  return ["You do not need to send another payment."];
}

function nextStepsFor(kind: OrderEmailKind, when: string, testOrder: boolean) {
  if (kind === "admin-new-order") {
    const steps = [
      "Open Admin, then Orders, and find this payment reference.",
      "In Venmo, match the payment to the exact total and the full reference. A customer message is not payment proof.",
      "Record the payment only if it matches, and only before the deadline. After the deadline the reservation expires and its inventory is released."
    ];
    if (testOrder) steps.push(`This reference starts with ${ADMIN_TEST_REFERENCE_PREFIX}. Mark it paid or cancel it in Admin, then Orders.`);
    return steps;
  }
  if (kind === "admin-payment-review") return [
    "Open Admin, then Orders, and find this reference.",
    "Independently inspect Venmo before marking the order paid. Customer attestation is not payment proof.",
    "This order will not auto-expire and keeps its stock and order slot. Confirm the payment in Venmo and mark it paid, or cancel it."
  ];
  if (kind === "payment-verified") return [
    `We'll prepare this order for the ${when} date above.`,
    when === "pickup" ? "The bakery confirms the exact handoff." : "We'll deliver to the address above.",
    "Keep your private receipt. You do not need to send another payment."
  ];
  if (kind === "reservation-expired") return [
    "Do not send a new payment for this reference.",
    "If you already paid, keep your Venmo receipt and email us so we can reconcile it. A late payment does not schedule this order.",
    "This order is cancelled and is not on the fulfillment schedule."
  ];
  const steps = [
    "Send the exact total to the Venmo handle above. Check the recipient before you pay.",
    "Put only the payment reference in the Venmo note. Do not include your address or other private details.",
    "Pay by the deadline. If the deadline passes, the reservation expires and a late payment does not automatically restore it.",
    "If you already paid, request a review from your private receipt. Keep the private receipt link shown after checkout. Signed-in customers can also find orders in their account."
  ];
  if (testOrder) steps.push(`This reference starts with ${ADMIN_TEST_REFERENCE_PREFIX}. It is a real order in the database.`);
  return steps;
}

function section(heading: string, paragraphs: string[]) {
  return [heading, ...paragraphs.filter(Boolean)].join("\n\n");
}

function renderText(model: EmailModel) {
  const summary = [model.referenceLine, ...model.customerLines].join("\n");
  const itemBlock = model.items.map((item) => `${item.label} — ${item.amount}`).join("\n");
  const totals = [`Subtotal: ${model.subtotal}`, `Delivery fee: ${model.deliveryFee}`, `Total: ${model.total}`].join("\n");
  const parts = [
    model.greeting.join("\n\n"),
    model.banner ?? "",
    section("ORDER SUMMARY", [summary, itemBlock, totals]),
    section(model.fulfillmentHeading, model.fulfillmentLines),
    section("PAYMENT", [model.paymentRows.map((row) => `${row.label}: ${row.value}`).join("\n"), ...model.paymentNotes]),
    section("NEXT STEPS", model.nextSteps.map((step, index) => `${index + 1}. ${step}`)),
    section("CONTACT", [BAKERY_CONTACT_EMAIL])
  ].filter(Boolean);
  return `${parts.join("\n\n")}\n`;
}

function paragraph(lines: string[], color = INK) {
  return lines.map((line, index) => `<p style="margin:${index === lines.length - 1 ? "0" : "0 0 12px"};font-family:${BODY};font-size:16px;line-height:24px;color:${color};">${escapeHtml(line)}</p>`).join("");
}

function panel(heading: string, body: string, tone: "default" | "footer" | "alert" = "default") {
  const headingBg = tone === "footer" ? SAGE : tone === "alert" ? BUTTER : CRUMB;
  const headingColor = tone === "footer" ? PAGE : INK;
  const bodyBg = tone === "footer" ? SAGE : tone === "alert" ? BUTTER : PAGE;
  const bodyColor = tone === "footer" ? PAGE : INK;
  return `<tr><td style="padding:0 24px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:2px solid ${INK};background-color:${bodyBg};"><tr><td style="padding:10px 14px;background-color:${headingBg};border-bottom:2px solid ${INK};font-family:${DISPLAY};font-size:15px;line-height:20px;letter-spacing:1.4px;text-transform:uppercase;font-weight:700;color:${headingColor};">${escapeHtml(heading)}</td></tr><tr><td style="padding:14px;background-color:${bodyBg};color:${bodyColor};">${body}</td></tr></table></td></tr>`;
}

function renderHtml(model: EmailModel) {
  const items = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${model.items.map((item) => `<tr><td valign="top" style="padding:6px 12px 6px 0;font-family:${BODY};font-size:16px;line-height:22px;color:${INK};">${escapeHtml(item.label)}</td><td valign="top" align="right" width="96" style="padding:6px 0;font-family:${BODY};font-size:16px;line-height:22px;font-weight:700;color:${INK};white-space:nowrap;">${escapeHtml(item.amount)}</td></tr>`).join("")}</table>`;
  const totalRows: { label: string; amount: string; emphasize: boolean }[] = [
    { label: "Subtotal", amount: model.subtotal, emphasize: false },
    { label: "Delivery fee", amount: model.deliveryFee, emphasize: false },
    { label: "Total", amount: model.total, emphasize: true }
  ];
  const totals = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:10px;">${totalRows.map((row) => `<tr><td style="padding:8px;border-top:2px solid ${INK};background-color:${row.emphasize ? JAM : PAGE};font-family:${DISPLAY};font-size:14px;line-height:18px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:${INK};">${escapeHtml(row.label)}</td><td align="right" style="padding:8px;border-top:2px solid ${INK};background-color:${row.emphasize ? JAM : PAGE};font-family:${BODY};font-size:16px;line-height:22px;font-weight:700;color:${INK};white-space:nowrap;">${escapeHtml(row.amount)}</td></tr>`).join("")}</table>`;
  const summaryBits = [paragraph([model.referenceLine, ...model.customerLines]), `<div style="margin-top:12px;">${items}</div>`, totals].join("");
  const payment = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${model.paymentRows.map((row) => {
    const value = row.label === "Receiving link"
      ? `<a href="${escapeHtml(row.value)}" style="color:${INK};font-weight:700;text-decoration:underline;">${escapeHtml(row.value)}</a>`
      : escapeHtml(row.value);
    const valueStyle = row.highlight
      ? `padding:8px;background-color:${CRUMB};border:2px solid ${INK};font-family:'Courier New',Courier,monospace;font-size:15px;line-height:22px;font-weight:700;color:${INK};word-break:break-all;`
      : `padding:4px 0;font-family:${BODY};font-size:16px;line-height:22px;font-weight:700;color:${INK};word-break:break-word;`;
    return `<tr><td valign="top" width="148" style="width:148px;padding:8px 12px 8px 0;font-family:${DISPLAY};font-size:13px;line-height:18px;letter-spacing:0.6px;text-transform:uppercase;font-weight:700;color:${SAGE};">${escapeHtml(row.label)}</td><td valign="top" style="${valueStyle}">${value}</td></tr>`;
  }).join("")}</table>${model.paymentNotes.length ? `<div style="margin-top:12px;">${paragraph(model.paymentNotes)}</div>` : ""}`;
  const steps = model.nextSteps.map((step, index) => `<p style="margin:${index === model.nextSteps.length - 1 ? "0" : "0 0 12px"};font-family:${BODY};font-size:16px;line-height:24px;color:${INK};">${escapeHtml(`${index + 1}. ${step}`)}</p>`).join("");
  const contact = `<p style="margin:0;font-family:${BODY};font-size:18px;line-height:26px;font-weight:700;color:${PAGE};"><a href="mailto:${BAKERY_CONTACT_EMAIL}" style="color:${PAGE};text-decoration:underline;">${BAKERY_CONTACT_EMAIL}</a></p>`;
  const banner = model.banner ? panel("Admin test order", paragraph([model.banner]), "alert") : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(model.subject)}</title></head><body style="margin:0;padding:0;background-color:${CRUMB};"><div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(model.preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background-color:${CRUMB};"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;max-width:600px;background-color:${PAGE};border:2px solid ${INK};"><tr><td style="padding:0;background-color:${PAGE};line-height:0;font-size:0;"><img src="${EMAIL_HEADER_LOGO}" srcset="${EMAIL_HEADER_LOGO_2X} 2x" alt="Kneaded Loaves" width="600" height="120" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;"></td></tr><tr><td style="padding:14px 24px;background-color:${CRUST};border-bottom:2px solid ${INK};"><p style="margin:0;font-family:${DISPLAY};font-size:14px;line-height:18px;letter-spacing:1.2px;text-transform:uppercase;font-weight:700;color:${CRUMB};">${escapeHtml(model.subject)}</p></td></tr><tr><td style="height:8px;background-color:${BUTTER};font-size:0;line-height:0;">&nbsp;</td></tr><tr><td style="padding:24px 24px 8px;">${paragraph(model.greeting)}</td></tr>${banner}${panel("Order summary", summaryBits)}${panel(model.fulfillmentHeading === "PICKUP" ? "Pickup" : "Delivery", paragraph(model.fulfillmentLines))}${panel("Payment", payment)}${panel("Next steps", steps)}${panel("Contact", contact, "footer")}</table></td></tr></table></body></html>`;
}

export function renderOrderEmail(kind: OrderEmailKind, details: OrderEmailDetails): RenderedEmail {
  const model = buildModel(kind, details);
  return { subject: model.subject, text: renderText(model), html: renderHtml(model) };
}
