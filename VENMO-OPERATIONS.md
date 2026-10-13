# Manual Venmo operations

## Disabled until deliberately configured

This release also has an unconditional production checkout hard-stop. Even a fully configured environment cannot enable checkout; removal requires a separately approved code release after operational readiness. No live payment flag or destination is set by this patch. Zelle and automated provider payments are deferred. The owner independently checks the Venmo business account before recording payment or externally performed refunds.

Configure the exact copied official receiving URL and business handle, then save a separate destination attestation. Changes invalidate the fingerprint and disable checkout. Set an owner-approved payment hold duration; there is no live default. Configure actual products, pickup/delivery ZIPs and fees, scheduled windows and capacity. A zero maximum means no slots; null means unlimited.

Authenticated TLS SMTP, deployed email/expiry runners, a strong session secret, canonical public origin and actual checkout smoke test are separate required gates. Enable only after owner approval. The supplied https://www.venmo.com/u/kneadedloaves public profile is confirmed, but receiving capability and provider verification are not.

## Customer and owner workflow

Checkout reserves stock/capacity transactionally and snapshots canonical item prices, delivery fee, destination, full reference and fulfillment details. Pending means awaiting payment. The exact total and full reference must match the independently checked Venmo receipt. Customer “I sent payment” requests review only and never extends the deadline.

An opaque attempt key is stored only in the original tab before submitting; no customer details, token or private URL is stored there. Recovery requires that key plus the original HTTP-only guest cookie or owning session. Recovery remains available with checkout disabled and after a committed response was lost. If tab/cookie access is lost, contact the bakery; order ID or email alone does not grant access. Receipt links are private bearer credentials, stored hash-only server-side; log and analytics systems must redact their query tokens. Links to Venmo use no-referrer protection.

Only exact timely attested payment permits fulfillment. Expiry, cancellation and verification serialize; reservations restore stock/capacity once and never override owner sold-out flags. Ambiguous, partial, excess, late or foreign-currency receipts enter review. Closed-order extra receipts may be recorded without reopening fulfillment or inventory. No exception automatically revives an order.

Record refunds only after they have been independently performed outside the site. Enter a distinct provider reference, amount/currency/time, reason, attestation and explicit restock decision. Refund ceilings are recorded receipts minus prior refunds by currency. Completed orders retain completed history/capacity; unfinished refunded orders close. The site never executes a refund.

## Hosting and release

Only VERCEL_ENV=production allows the build helper to inspect migration history and apply pending migrations using DATABASE_URL exclusively. Preview/local builds never issue database migration commands. The read-only preflight accepts only a nonempty, checksum-matching contiguous prefix in execution order, including an independently approved initial-only baseline. Unknown, empty, failed, gapped, out-of-order or checksum-drifted history fails before writes. Recognizable effects of an unrecorded later migration also fail, including AppConfig, hardening tables/columns, and manual-payment tables/columns.

Schema presence requirements follow the recorded prefix. After preflight, normal Prisma deployment executes all remaining migrations, then a read-only check requires every repository migration to be complete before client generation/build. Initial-only history therefore executes the remaining four migrations; the helper never fabricates pending history, baselines, resolves, resets, or pushes a schema. Table/column presence checks do not replace a complete metadata comparison of types, indexes and constraints.

The actual database requires a separately approved baseline/reconciliation. Do not substitute integration/nonpooling URL variables; another configured integration targets an unrelated empty database. Verify a recovery point and exact project/branch, reconcile only reviewed schema differences, baseline only proven historical effects, execute remaining migrations, then promote code. Additive changes preserve old-runtime compatibility. Keep payments disabled throughout release.

Run email and expiry workers independently of requests. Runtime commands: npm run email:worker:production and npm run payments:expire:production. Compose supplies a continuous email worker and 60-second expiry loop, not automatic Vercel scheduling. Opportunistic checkout expiry is a recovery aid, not a substitute. SMTP is at least once: crash after provider acceptance can duplicate email; inspect provider logs before retrying uncertain delivery. Tokens are never stored in EmailJob.

TRUST_PROXY=false intentionally uses a shared checkout bucket (20 attempts per ten minutes). Before launch verify the actual proxy replaces client forwarding headers before enabling trust, and choose rate limits deliberately. Never blindly trust supplied X-Forwarded-For.

Legacy orders are preserved without fabricated verification. Their fulfillment cannot advance until independently reconciled. Saved old confirmation templates must not describe unpaid reservations as paid.

## Reproducible checks

npm test, npm run lint, npx tsc --noEmit, npm run build, npm run build:runtime.

PostgreSQL integrations are separate from npm test: PG_BIN=/trusted/postgres/bin bash scripts/test-manual-payments.sh and, after production build, bash scripts/test-production-security.sh with the same PG_BIN. Use isolated synthetic databases only. Do not claim local test success proves real SMTP/provider processing or hosted worker schedules.
