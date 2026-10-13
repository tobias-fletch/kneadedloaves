# Manual Venmo release candidate: reconstruction in progress

The prior unpushed candidate workspace was lost. This checkout is being reconstructed against verified GitHub main 28fb35fe86bf4f14592b7e6a5d20cd98eb57e4b0. Previous test counts do not certify this code. Fresh checks on 2026-10-13: 84 unit/render/security tests passed; 27 real PostgreSQL lifecycle groups plus legacy preservation/migration replay passed; 27 real PostgreSQL build-guard checks passed; TypeScript, lint (one existing image warning), production build and runtime bundles passed. Thirteen actual production-mode HTTP groups, including fully configured production checkout remaining blocked, and the full baseline-to-candidate rehearsal passed with nonempty synthetic-data preservation, orphan rollback and an empty final Prisma schema diff. The production guard accepts a checksum-matching, nonempty contiguous known migration prefix, including an initial-only baseline, then applies legitimate pending migrations with Prisma. Empty, gapped, out-of-order, failed, unknown, checksum-drifted and recognizable partial-effect states are rejected before writes. Initial-only upgrade with existing fixture data passed. Production audit has zero findings; full strict audit retains seven development-only high package nodes from one unpatched braces advisory, with no exception.

Production checkout is hard-disabled in code for this release regardless of environment/settings. Removal requires a separately approved code release. Payments also remain disabled by default. This site only reserves orders and records owner-checked external payment/refund evidence; it never sends money or verifies a provider transaction itself.

## Required release checks

- Fresh unit, lint, types, build, real disposable PostgreSQL lifecycle and actual production-mode HTTP tests.
- Complete metadata-reviewed production baseline/reconciliation, verified recovery point and explicit authorization before writes. Existing production has application data with empty Prisma history; ordinary migration deployment must refuse that state.
- GitHub main race check, reviewed source manifest and exact remote commit verification. Never push synthetic local snapshot history.
- Preserve all existing artwork and UI design.

## Operational launch gates

- Owner-selected hold duration and actual pickup/delivery rules, pricing, tax/refund policy.
- Owner verification of copied receiving destination. Public profile at https://www.venmo.com/u/kneadedloaves was confirmed; identity, receipt capability and payment processing were not tested.
- Authenticated TLS SMTP delivery, deployed email and expiry workers, real-host smoke test, explicit payment enablement approval.
- Canonical HTTPS APP_URL and strong session secret. Safe proxy/Host configuration, private receipt URL log redaction and no analytics leakage.
- Actual browser walkthrough and Docker daemon build remain distinct from React-render/local runtime assembly tests.

Full dependency audit remains strict. Report unpatched development-only findings honestly rather than weakening the gate. Production audit must be clean.

Unrelated pre-existing upload-handler and automatic-social-publishing gaps are not resolved by this payment/security scope.
