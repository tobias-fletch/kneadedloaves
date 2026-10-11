import { pricingConfiguration } from "@/lib/pricing";
import { getAppConfigValues } from "@/lib/app-config";

export function paymentReadiness(config: Record<string, string>, production = process.env.NODE_ENV === "production") {
  let appUrl = "";
  try {
    const url = new URL(config.APP_URL);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
    if (production ? url.protocol !== "https:" : !["http:", "https:"].includes(url.protocol)) throw new Error();
    appUrl = url.origin;
  } catch { /* Invalid public URLs fail closed. */ }
  const encryptionReady = /^[a-fA-F0-9]{64}$/.test(process.env.CONFIG_ENCRYPTION_KEY || "");
  const deploymentSafe = !production || !process.env.BAKERY_DEPLOY_CONTEXT || process.env.BAKERY_DEPLOY_CONTEXT === "production";
  const operational = encryptionReady && deploymentSafe && Boolean(pricingConfiguration(config)) && Boolean(appUrl) && config.CHECKOUT_ENABLED === "true" && config.OPERATIONS_CONFIRMED === "true"
    && config.JWT_SECRET?.length >= 32 && !/replace-with|development|change-me/i.test(config.JWT_SECRET)
    && (!production || config.CHECKOUT_SMOKE_TESTED === "true");
  const stripeTest = config.STRIPE_TEST_MODE === "true";
  const stripe = operational && config.STRIPE_ENABLED === "true" && (!production || !stripeTest)
    && (stripeTest ? /^sk_test_\S+$/ : /^sk_live_\S+$/).test(config.STRIPE_SECRET_KEY || "")
    && /^whsec_\S+$/.test(config.STRIPE_WEBHOOK_SECRET || "");
  const paypal = operational && config.PAYPAL_ENABLED === "true" && (!production || config.PAYPAL_SANDBOX !== "true")
    && Boolean(config.PAYPAL_CLIENT_ID && config.PAYPAL_CLIENT_SECRET && config.PAYPAL_WEBHOOK_ID);
  return { appUrl, providers: [...(stripe ? ["STRIPE" as const] : []), ...(paypal ? ["PAYPAL" as const] : [])] };
}
export async function getCheckoutReadiness() {
  return paymentReadiness(await getAppConfigValues([
    "APP_URL", "JWT_SECRET", "TAX_RATE_BPS", "TAX_DELIVERY_FEE", "CHECKOUT_ENABLED", "OPERATIONS_CONFIRMED", "CHECKOUT_SMOKE_TESTED",
    "STRIPE_ENABLED", "STRIPE_TEST_MODE", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
    "PAYPAL_ENABLED", "PAYPAL_SANDBOX", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID"
  ]));
}
