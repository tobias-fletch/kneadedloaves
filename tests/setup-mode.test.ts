import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GET as getCart, POST as addCart, PATCH as editCart, DELETE as removeCart } from "../app/api/cart/route";
import { GET as getCheckoutOptions } from "../app/api/checkout/options/route";
import { POST as checkout } from "../app/api/checkout/route";

const original = { DATABASE_URL: process.env.DATABASE_URL, JWT_SECRET: process.env.JWT_SECRET, CONFIG_ENCRYPTION_KEY: process.env.CONFIG_ENCRYPTION_KEY };
afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
function unconfigured() {
  delete process.env.DATABASE_URL;
  delete process.env.JWT_SECRET;
  delete process.env.CONFIG_ENCRYPTION_KEY;
}
test("setup mode returns a safe empty cart without database or fallback credentials", async () => {
  unconfigured();
  const result = await getCart();
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { items: [], available: false });
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal(result.headers.get("set-cookie"), null);
  assert.equal(process.env.JWT_SECRET, undefined);
  assert.equal(process.env.CONFIG_ENCRYPTION_KEY, undefined);
});
test("setup mode exposes no checkout providers or windows", async () => {
  unconfigured();
  const result = await getCheckoutOptions();
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { providers: [], windows: [], available: false });
  assert.equal(result.headers.get("cache-control"), "no-store");
});
test("cart writes and checkout fail closed before DB, cookie or provider access", async () => {
  unconfigured();
  for (const [handler, method] of [[addCart, "POST"], [editCart, "PATCH"], [removeCart, "DELETE"], [checkout, "POST"]] as const) {
    const result = await handler(new Request("https://shop.example/api/cart", { method, headers: { "Content-Type": "application/json" }, body: "{}" }));
    assert.equal(result.status, 503);
    assert.match((await result.json()).error, /not available yet/);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal(result.headers.get("set-cookie"), null);
  }
});
test("blank database configuration is treated as setup mode", async () => {
  unconfigured(); process.env.DATABASE_URL = "   ";
  assert.deepEqual(await (await getCart()).json(), { items: [], available: false });
});
