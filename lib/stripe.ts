import Stripe from "stripe";
import { getAppConfigValue } from "@/lib/app-config";

export async function getStripe() {
  const key = await getAppConfigValue("STRIPE_SECRET_KEY");
  if (!key) return null;
  const testMode = (await getAppConfigValue("STRIPE_TEST_MODE")) === "true";
  if (testMode && !key.startsWith("sk_test_")) {
    throw new Error("Stripe test mode is on, but the configured Stripe secret key is not a test key.");
  }
  if (!testMode && key.startsWith("sk_test_")) {
    throw new Error("Stripe test key is configured while test mode is off.");
  }
  return new Stripe(key, { apiVersion: "2024-06-20", timeout: 8000, maxNetworkRetries: 0 });
}
