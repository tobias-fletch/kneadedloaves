import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAudit } from "../scripts/audit-policy";

const now = Date.parse("2026-10-11T00:00:00Z");
const advisory = { name: "braces", url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm", severity: "high", range: "<=3.0.3" };
const counts = (high = 1) => ({ vulnerabilities: { info: 0, low: 0, moderate: 0, high, critical: 0, total: high } });
const fixture = () => ({ auditReportVersion: 2, metadata: counts(), vulnerabilities: {
  braces: { name: "braces", severity: "high", nodes: ["node_modules/braces"], via: [advisory] }
} });
const lock = () => ({ packages: { "node_modules/braces": { version: "3.0.3", dev: true } } });

test("only the reviewed build advisory qualifies before expiry", () => {
  assert.deepEqual(checkAudit(fixture(), lock(), false, now), []);
  assert.notDeepEqual(checkAudit(fixture(), lock(), true, now), []);
  assert.notDeepEqual(checkAudit(fixture(), lock(), false, Date.parse("2026-11-11T00:00:00Z")), []);
});
test("runtime, changed version, and additional advisory fail closed", () => {
  const runtime = lock(); runtime.packages["node_modules/braces"].dev = false;
  assert.notDeepEqual(checkAudit(fixture(), runtime, false, now), []);
  const updated = lock(); updated.packages["node_modules/braces"].version = "3.0.4";
  assert.notDeepEqual(checkAudit(fixture(), updated, false, now), []);
  const other = fixture(); other.vulnerabilities.braces.via.push({ ...advisory, url: "https://github.com/advisories/NEW" });
  assert.notDeepEqual(checkAudit(other, lock(), false, now), []);
});
test("malformed, registry error, new path, and unknown severity fail closed", () => {
  for (const report of [null, {}, { error: "registry unavailable" }, { ...fixture(), auditReportVersion: 1 }]) {
    assert.notDeepEqual(checkAudit(report, lock(), false, now), []);
  }
  const newPath = fixture(); newPath.vulnerabilities.braces.nodes.push("node_modules/other/node_modules/braces");
  assert.notDeepEqual(checkAudit(newPath, lock(), false, now), []);
  const severity = fixture(); severity.vulnerabilities.braces.severity = "unknown";
  assert.notDeepEqual(checkAudit(severity, lock(), false, now), []);
});
test("a fully clean audit needs no exception, including after expiry", () => {
  assert.deepEqual(checkAudit({ auditReportVersion: 2, metadata: counts(0), vulnerabilities: {} }, lock(), false, Date.parse("2027-01-01")), []);
});
test("incomplete finding totals cannot turn a failed audit into a pass", () => {
  assert.notDeepEqual(checkAudit({ auditReportVersion: 2, vulnerabilities: {} }, lock(), false, now), []);
  assert.notDeepEqual(checkAudit({ auditReportVersion: 2, metadata: counts(), vulnerabilities: {} }, lock(), false, now), []);
});

test("new moderate or critical advisories are never included in the exception", () => {
  for (const severity of ["moderate", "critical"]) {
    const report = fixture();
    const findings = report.vulnerabilities as Record<string, unknown>;
    findings["other-package"] = {
      name: "other-package", severity, nodes: ["node_modules/other-package"],
      via: [{ name: "other-package", severity, url: "https://github.com/advisories/OTHER" }]
    };
    const totals = report.metadata.vulnerabilities as Record<string, number>;
    totals[severity] = 1;
    totals.total = 2;
    assert.notDeepEqual(checkAudit(report, lock(), false, now), []);
  }
});

test("reviewed propagation is allowed but unknown and circular causes fail closed", () => {
  const report = fixture();
  const findings = report.vulnerabilities as Record<string, unknown>;
  const locked = lock();
  const packages = locked.packages as Record<string, unknown>;
  findings.tailwindcss = {
    name: "tailwindcss", severity: "high", nodes: ["node_modules/tailwindcss"], via: ["braces"]
  };
  packages["node_modules/tailwindcss"] = { version: "3.4.19", dev: true };
  report.metadata = counts(2);
  assert.deepEqual(checkAudit(report, locked, false, now), []);
  const tailwind = findings.tailwindcss as { via: string[] };
  tailwind.via = ["unknown-package"];
  assert.notDeepEqual(checkAudit(report, locked, false, now), []);
  tailwind.via = ["tailwindcss"];
  assert.notDeepEqual(checkAudit(report, locked, false, now), []);
});

test("expiry is enforced at the exact UTC boundary", () => {
  const deadline = Date.parse("2026-11-11T00:00:00Z");
  assert.deepEqual(checkAudit(fixture(), lock(), false, deadline - 1), []);
  assert.notDeepEqual(checkAudit(fixture(), lock(), false, deadline), []);
  assert.notDeepEqual(checkAudit(fixture(), lock(), false, NaN), []);
});
