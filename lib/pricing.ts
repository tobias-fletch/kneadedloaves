export function pricingConfiguration(config: Record<string, string>) {
  if (!/^\d{1,5}$/.test(config.TAX_RATE_BPS || "") || !["true", "false"].includes(config.TAX_DELIVERY_FEE || "")) return null;
  const taxRateBps = Number(config.TAX_RATE_BPS);
  if (taxRateBps > 10000) return null;
  return { taxRateBps, taxDeliveryFee: config.TAX_DELIVERY_FEE === "true" };
}
export function priceOrder(subtotalCents: number, deliveryFeeCents: number, config: { taxRateBps: number; taxDeliveryFee: boolean }) {
  if (![subtotalCents, deliveryFeeCents, config.taxRateBps].every(Number.isSafeInteger) || subtotalCents < 0 || deliveryFeeCents < 0 || config.taxRateBps < 0 || config.taxRateBps > 10000) throw new Error("Invalid pricing configuration.");
  const taxCents = Math.round((subtotalCents + (config.taxDeliveryFee ? deliveryFeeCents : 0)) * config.taxRateBps / 10000);
  const totalCents = subtotalCents + deliveryFeeCents + taxCents;
  if (!Number.isSafeInteger(totalCents) || totalCents > 99999999) throw new Error("Order total is too large.");
  return { subtotalCents, deliveryFeeCents, taxCents, totalCents };
}
