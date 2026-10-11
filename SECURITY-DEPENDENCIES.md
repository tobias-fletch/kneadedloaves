# Temporary dependency exception

The owner approved this narrowly scoped exception on 2026-10-11. Raw npm audit currently reports seven propagated high findings, all from GHSA-vfj7-8cjw-p6xm in braces 3.0.3. No upstream patched release exists as of 2026-10-11.

Advisory: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
Upstream issue: https://github.com/micromatch/braces/issues/70

## Scope and expiry

The audit scripts accept only this exact advisory on the exact dev-only paths and package versions listed in scripts/audit-policy.ts. Production audit has no exceptions. Full raw reports remain visible. New advisories, runtime dependencies, changed versions/paths, invalid audit data, and command or registry errors fail the gate. The exception expires at 2026-11-11T00:00:00Z.

Review earlier when an upstream compatible fix is released, dependency versions change, application code begins to consume glob patterns, or deployment bundling changes. Remove this exception when a compatible fixed dependency becomes available. Do not expand it automatically.

## Reviewed dependency paths

- tailwindcss@3.4.19 → chokidar@3.6.0 → braces@3.0.3
- tailwindcss@3.4.19 → micromatch@4.0.8 → braces@3.0.3
- tailwindcss@3.4.19 → fast-glob@3.3.3 → micromatch@4.0.8 → braces@3.0.3
- eslint-config-next@15.5.27 → @next/eslint-plugin-next@15.5.27 → fast-glob@3.3.1 → micromatch@4.0.8 → braces@3.0.3

## Risk analysis

The advisory concerns stack exhaustion caused by deeply nested attacker-controlled glob patterns. It remains active despite the maintainer disputing its applicability to trusted tooling. The code has not been patched.

All listed lockfile entries are dev-only. Application and API source has no direct imports of these glob packages. Tailwind content patterns are fixed repository-owned globs. A successful production build's runtime .nft.json traces contain no braces, micromatch, or Tailwind files, and production npm audit reports zero vulnerabilities. Hostile repository inputs can still affect developer/CI tooling.

Netlify is the intended production target. The existing Dockerfile copies dev dependencies into its image; absence from runtime traces is not proof they are absent from that image. Reassess before changing deployment mode.
