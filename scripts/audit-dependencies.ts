// Keep full raw findings visible; apply only the scoped policy documented below.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { checkAudit } from "./audit-policy";

const lockfile: unknown = JSON.parse(readFileSync("package-lock.json", "utf8"));
let failed = false;
for (const production of [true, false]) {
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", [
    "audit", "--json", "--audit-level=moderate", ...(production ? ["--omit=dev"] : [])
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, shell: process.platform === "win32" });
  console.log(production ? "Production audit (no exceptions):" : "Full audit (raw report):");
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.error || result.signal || (result.status !== 0 && result.status !== 1)) {
    console.error("Audit execution failed; failing closed.", result.error || result.signal || result.status);
    failed = true;
    continue;
  }
  try {
    const errors = checkAudit(JSON.parse(result.stdout), lockfile, production);
    if (errors.length) {
      failed = true;
      for (const error of errors) console.error(error);
    } else if (!production) {
      console.log("Policy check passed. Any exception is limited to reviewed dev-only GHSA-vfj7-8cjw-p6xm nodes and expires 2026-11-11 UTC.");
    }
  } catch {
    console.error("Audit JSON parsing failed; failing closed.");
    failed = true;
  }
}
process.exitCode = failed ? 1 : 0;
