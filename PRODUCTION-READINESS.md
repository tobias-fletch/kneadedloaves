# Production readiness

Updated October 19, 2026. Source readiness and live operational readiness are separate.

## Release checks

The October 15 GitHub run for `f5d4ff6` passed lint and unit tests but failed the migration integration step. The fixture expected five migrations after a sixth was added. The test now derives the complete count from the release plan while retaining checksum, ordering, schema, preservation and replay checks.

The production HTTP suite now checks that configured production checkout reserves inventory exactly once and stays unpaid, while missing operational settings block a populated cart. Its old expectation of an unconditional production stop was obsolete. CI now includes this suite, manual-payment lifecycle tests, type checking, builds and a production dependency audit.

Use the release report and CI run for the exact commit as verification evidence. Historical reconstruction test counts do not certify subsequent changes. Synthetic settings cannot prove live service readiness.

## Before accepting customers

- Verify the intended database, migration history, health, backups and restore rehearsal.
- Rotate historical/default admin passwords, use a strong session secret, and preserve the correct encryption key for retained settings.
- Independently verify the business receiving destination. The migration seeds a destination and 60-minute hold, but does not enable checkout or prove receipt capability.
- Deploy and exercise email delivery and payment expiry. The current Node implementation requires authenticated TLS SMTP. Readiness flags are owner attestations, not worker monitoring.
- Confirm products, photos, ingredients/allergens, prices, available stock, pickup details, delivery ZIPs/fees, ordering windows and capacity. Review the seeded catch-all $7 delivery zone: an empty ZIP list accepts any delivery ZIP.
- Set the canonical HTTPS origin and test login, guest checkout, reload recovery, owner verification, expiry/restocking, cancellation/refund recording and real email delivery on the intended host. The admin rehearsal is only a simulation.
- Supply customer contact details and approved customer policies. Configure monitoring and redact private receipt tokens from logs.
- Enable `VENMO_CHECKOUT_ENABLED` only after these checks. The site records independently verified payments/refunds; it never transfers money.

## Hosting migration

The requested destination is ChatGPT Sites, retaining only shop items. Customers, orders, credentials and payment records are excluded from the catalog export. Keep the source database intact.

This PostgreSQL/Node app is not a drop-in Sites deployment. See [HOSTING-MIGRATION.md](HOSTING-MIGRATION.md). Keep the current domain on its existing host until the replacement passes verification. Live settings, workers and provider delivery remain unverified in this checkout.

## Verification on October 19

The launch-readiness changes passed 95 unit tests, 27 disposable PostgreSQL migration-guard checks, 27 manual-payment lifecycle groups plus legacy migration/replay checks, and 14 production HTTP security/checkout/catalog-export groups. Type checking, the Next.js production build and worker/runtime bundles passed. The production npm audit returned zero vulnerabilities. Lint has no errors and one existing image-optimization warning. These checks used synthetic local data; no real provider payment or customer email was sent.
