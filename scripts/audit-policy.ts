// Owner-approved, temporary dev-only exception; see SECURITY-DEPENDENCIES.md.
const advisory = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm";
const expires = Date.parse("2026-11-11T00:00:00Z");
const reviewedNodes: Record<string, Record<string, string>> = {
  "@next/eslint-plugin-next": { "node_modules/@next/eslint-plugin-next": "15.5.27" },
  braces: { "node_modules/braces": "3.0.3" },
  chokidar: { "node_modules/tailwindcss/node_modules/chokidar": "3.6.0" },
  "eslint-config-next": { "node_modules/eslint-config-next": "15.5.27" },
  "fast-glob": {
    "node_modules/fast-glob": "3.3.1",
    "node_modules/tailwindcss/node_modules/fast-glob": "3.3.3"
  },
  micromatch: { "node_modules/micromatch": "4.0.8" },
  tailwindcss: { "node_modules/tailwindcss": "3.4.19" }
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function checkAudit(report: unknown, lockfile: unknown, production: boolean, now = Date.now()): string[] {
  if (!record(report) || report.error || report.auditReportVersion !== 2 || !record(report.vulnerabilities)) {
    return ["Invalid or incomplete npm audit report; no exception applied."];
  }
  if (!record(lockfile) || !record(lockfile.packages)) return ["Invalid package lock."];
  const vulnerabilities = report.vulnerabilities;
  if (!record(report.metadata) || !record(report.metadata.vulnerabilities)) return ["Missing audit totals."];
  const totals = report.metadata.vulnerabilities;
  for (const severity of ["info", "low", "moderate", "high", "critical"]) {
    const count = Object.values(vulnerabilities).filter(entry => record(entry) && entry.severity === severity).length;
    if (totals[severity] !== count) return ["Audit totals do not match its findings."];
  }
  if (totals.total !== Object.keys(vulnerabilities).length) return ["Incomplete audit findings."];
  const packages = lockfile.packages;
  const errors: string[] = [];
  const permitted = (name: string, ancestors = new Set<string>()): boolean => {
    if (ancestors.has(name)) return false;
    const entry = vulnerabilities[name];
    const known = reviewedNodes[name];
    if (!record(entry) || entry.name !== name || !known || entry.severity !== "high") return false;
    if (!Array.isArray(entry.nodes) || !entry.nodes.length || !Array.isArray(entry.via) || !entry.via.length) return false;
    if (entry.nodes.some((node: unknown) => {
      if (typeof node !== "string" || !Object.hasOwn(known, node)) return true;
      const locked = packages[node];
      return !record(locked) || locked.version !== known[node] || locked.dev !== true;
    })) return false;
    const next = new Set(ancestors).add(name);
    return entry.via.every((cause: unknown) => {
      if (typeof cause === "string") return permitted(cause, next);
      return name === "braces" && record(cause) && cause.name === "braces" &&
        cause.url === advisory && cause.severity === "high" && cause.range === "<=3.0.3";
    });
  };
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    if (!record(entry) || !["info", "low", "moderate", "high", "critical"].includes(String(entry.severity))) {
      errors.push(`Unrecognized audit entry: ${name}`);
      continue;
    }
    if (["info", "low"].includes(String(entry.severity))) continue;
    if (production || !Number.isFinite(now) || now >= expires || !permitted(name)) {
      errors.push(`Unaccepted ${String(entry.severity)} finding: ${name}`);
    }
  }
  return errors;
}
