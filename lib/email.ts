import { FulfillmentType } from "@prisma/client";
import { getAppConfigValues } from "@/lib/app-config";
import { BAKERY_CONTACT_EMAIL } from "@/lib/config-messages";
import { formatMoney } from "@/lib/money";
import { PICKUP_AREA } from "@/lib/pickup-location";

export type OrderEmailInput = {
  to: string;
  orderId: string;
  customerName: string;
  totalCents: number;
  fulfillmentType: FulfillmentType;
  fulfillmentInstructions?: string | null;
  items: { productName: string; quantity: number; unitPriceCents: number }[];
};

const defaultTemplates = {
  PICKUP: {
    subject: "Your bakery pickup order is confirmed",
    body:
      `Hi {{customerName}},\n\nThanks for your order #{{orderId}}. We have it down for pickup at ${PICKUP_AREA}.\n\nORDER SUMMARY\n\n{{items}}\n\nTotal: {{total}}\n\nPICKUP\n\n${PICKUP_AREA}\nThe bakery confirms the exact handoff after payment.\n\nPickup instructions:\n{{fulfillmentInstructions}}\n\nCONTACT\n\n${BAKERY_CONTACT_EMAIL}\n\nSee you soon!`
  },
  DELIVERY: {
    subject: "Your bakery delivery order is confirmed",
    body:
      "Hi {{customerName}},\n\nThanks for your order #{{orderId}}. We have it down for local delivery.\n\nORDER SUMMARY\n\n{{items}}\n\nTotal: {{total}}\n\nDELIVERY\n\n{{fulfillmentInstructions}}\n\nCONTACT\n\n${BAKERY_CONTACT_EMAIL}\n\nThank you for ordering!"
  }
};

function renderTemplate(template: string, input: OrderEmailInput) {
  const items = input.items
    .map((item) => `${item.quantity} x ${item.productName} - ${formatMoney(item.unitPriceCents * item.quantity)}`)
    .join("\n");
  const values: Record<string, string> = {
    customerName: input.customerName,
    orderId: input.orderId.slice(-6).toUpperCase(),
    total: formatMoney(input.totalCents),
    fulfillmentType: input.fulfillmentType.toLowerCase(),
    fulfillmentInstructions: input.fulfillmentInstructions || "We will follow up with details.",
    items
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
}

export async function getOrderEmailTemplates() {
  const config = await getAppConfigValues([
    "EMAIL_PICKUP_SUBJECT",
    "EMAIL_PICKUP_BODY",
    "EMAIL_DELIVERY_SUBJECT",
    "EMAIL_DELIVERY_BODY"
  ]);
  return {
    pickupSubject: config.EMAIL_PICKUP_SUBJECT || defaultTemplates.PICKUP.subject,
    pickupBody: config.EMAIL_PICKUP_BODY || defaultTemplates.PICKUP.body,
    deliverySubject: config.EMAIL_DELIVERY_SUBJECT || defaultTemplates.DELIVERY.subject,
    deliveryBody: config.EMAIL_DELIVERY_BODY || defaultTemplates.DELIVERY.body
  };
}

export function prepareOrderEmail(input: OrderEmailInput, templates: Awaited<ReturnType<typeof getOrderEmailTemplates>>) {
  const subject = input.fulfillmentType === "DELIVERY" ? templates.deliverySubject : templates.pickupSubject;
  const body = input.fulfillmentType === "DELIVERY" ? templates.deliveryBody : templates.pickupBody;
  return { to: input.to, subject: "Order received — " + renderTemplate(subject, input), body: "Payment has not been confirmed.\n\n" + renderTemplate(body, input) };
}
