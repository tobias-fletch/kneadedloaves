import { getAppConfigValues } from "@/lib/app-config";

let tokenCache: { key: string; token: string; expiresAt: number } | null = null;

export type PayPalOrder = {
  id: string; status: string;
  links?: { rel: string; href: string }[];
  purchase_units?: { custom_id?: string; amount?: { currency_code: string; value: string }; payments?: { captures?: { id: string; status: string; amount: { currency_code: string; value: string }; supplementary_data?: { related_ids?: { order_id?: string } } }[] } }[];
};
export async function paypalRequest<T>(path: string, method = "GET", body?: unknown, idempotencyKey?: string): Promise<T> {
  // The API host is selected by server configuration, never a request or provider link.
  const config = await getAppConfigValues(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_SANDBOX"]);
  if (!config.PAYPAL_CLIENT_ID || !config.PAYPAL_CLIENT_SECRET) throw new Error("PayPal is not configured.");
  const base = config.PAYPAL_SANDBOX === "true" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
  const cacheKey = `${base}:${config.PAYPAL_CLIENT_ID}:${config.PAYPAL_CLIENT_SECRET}`;
  if (!tokenCache || tokenCache.key !== cacheKey || tokenCache.expiresAt <= Date.now()) {
  const auth = await fetch(`${base}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${config.PAYPAL_CLIENT_ID}:${config.PAYPAL_CLIENT_SECRET}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials", cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!auth.ok) throw new Error("PayPal authorization is unavailable.");
  const token = await auth.json() as { access_token?: string; expires_in?: number };
  if (!token.access_token) throw new Error("PayPal authorization is unavailable.");
    tokenCache = { key: cacheKey, token: token.access_token, expiresAt: Date.now() + Math.min(300, Math.max(0, (token.expires_in || 60) - 30)) * 1000 };
  }
  const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${tokenCache.token}`, "Content-Type": "application/json", Prefer: "return=representation", ...(idempotencyKey ? { "PayPal-Request-Id": idempotencyKey } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("PayPal could not complete this request. Please retry the same checkout.");
  return response.json() as Promise<T>;
}
export async function verifyPayPalWebhook(headers: Headers, event: unknown) {
  const config = await getAppConfigValues(["PAYPAL_WEBHOOK_ID"]);
  const names = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];
  if (!config.PAYPAL_WEBHOOK_ID || names.some(name => !headers.get(name))) return false;
  const result = await paypalRequest<{ verification_status: string }>("/v1/notifications/verify-webhook-signature", "POST", {
    auth_algo: headers.get(names[0]), cert_url: headers.get(names[1]), transmission_id: headers.get(names[2]),
    transmission_sig: headers.get(names[3]), transmission_time: headers.get(names[4]), webhook_id: config.PAYPAL_WEBHOOK_ID, webhook_event: event
  });
  return result.verification_status === "SUCCESS";
}
