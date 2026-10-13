import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
function embeddedOrigin(vercelEnv?: string, appUrl?: string) {
  const env = { ...process.env }; delete env.VERCEL_ENV; delete env.APP_URL;
  if (vercelEnv) env.VERCEL_ENV = vercelEnv;
  if (appUrl) env.APP_URL = appUrl;
  const result = spawnSync(process.execPath, ["--import", "tsx", "-e", "const config = require('./next.config.ts').default; console.log(JSON.stringify(config.env || {}));"], { cwd: process.cwd(), env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as Record<string,string>;
}
test("Vercel production embeds only the approved public HTTPS origin, even with missing or invalid legacy environment",()=>{
  for (const value of [undefined, "http://localhost:3000", "malformed", "https://untrusted.example.invalid"]) assert.deepEqual(embeddedOrigin("production",value), { APP_URL: "https://kneadedloaves.com" });
});
test("preview and local builds do not inherit the production origin override",()=>{
  for (const value of [undefined,"preview","development"]) assert.deepEqual(embeddedOrigin(value,"https://preview.example.invalid"),{});
});
