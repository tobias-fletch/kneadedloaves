import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { publicRedirectUrl } from "../lib/public-origin";
function environment(t: TestContext, values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}
test("production redirects use the public origin rather than internal or forged hosts", t => {
  environment(t, { NODE_ENV: "production", APP_URL: "https://bakery.example", NEXT_PUBLIC_APP_URL: undefined });
  for (const url of ["http://localhost:3000/api/auth/login", "https://attacker.example/api/auth/login"]) {
    for (const path of ["/", "/account", "/admin", "/admin/windows", "/admin/events", "/admin/email", "/login?error=invalid"]) assert.equal(publicRedirectUrl({ url }, path).href, `https://bakery.example${path}`);
  }
});
test("redirect configuration fails closed on missing or malformed production origin", t => {
  environment(t, { NODE_ENV: "production", APP_URL: undefined, NEXT_PUBLIC_APP_URL: undefined });
  const request = { url: "http://localhost:3000/api/auth/logout" };
  assert.throws(() => publicRedirectUrl(request, "/"));
  for (const invalid of ["http://bakery.example", "https://user:pass@bakery.example", "https://bakery.example/path", "https://bakery.example/?query=1", "https://bakery.example/#fragment", "not-a-url"]) {
    process.env.APP_URL = invalid; assert.throws(() => publicRedirectUrl(request, "/"), invalid);
  }
});
test("redirect targets cannot escape the canonical origin", t => {
  environment(t, { NODE_ENV: "production", APP_URL: "https://bakery.example", NEXT_PUBLIC_APP_URL: undefined });
  for (const path of ["https://attacker.example", "//attacker.example", "/\\attacker.example", "javascript:alert(1)"]) assert.throws(() => publicRedirectUrl({ url: "http://localhost" }, path), path);
});
test("public fallback and local development request origins are supported", t => {
  environment(t, { NODE_ENV: "production", APP_URL: undefined, NEXT_PUBLIC_APP_URL: "https://public.example" });
  assert.equal(publicRedirectUrl({ url: "http://localhost" }, "/account").origin, "https://public.example");
  Object.assign(process.env, { NODE_ENV: "development" }); delete process.env.NEXT_PUBLIC_APP_URL;
  assert.equal(publicRedirectUrl({ url: "http://127.0.0.1:3317/api/auth/login" }, "/account").href, "http://127.0.0.1:3317/account");
});
