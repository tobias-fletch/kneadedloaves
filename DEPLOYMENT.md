# Kneaded Loaves: free-hosting launch guide

Target: the existing Netlify Free site, an isolated Neon Free PostgreSQL project, and Netlify Blobs product photos. This is a deployment plan and implementation; live infrastructure, payment credentials and a successful deployed checkout are not established by a local build. No paid service, upgrade, top-up or persistent disk is required or authorized by this plan.

## Budget and isolation

- Keep Netlify on Free with paid top-ups disabled. Its shared credit limit can pause the site; it is not an unlimited availability guarantee. Check the existing account balance before deploying and consolidate production deploys.
- Use an isolated Neon Free project for this bakery. Never use unrelated application databases. Check storage/compute limits and configure available usage notifications without enabling paid upgrades.
- Netlify Blobs uses the existing site identity. Do not create an arbitrary upload endpoint or add a service-role credential to browser code. See [PHOTO-STORAGE.md](PHOTO-STORAGE.md).
- Use separate test/preview database credentials and no live payment secrets in preview contexts. Never point preview builds or tests at the shop database. Preview image namespaces are separate from production, and mutation routes are read-only outside the production deployment context. This does not make inherited production database read access safe: verify secret scoping.

## Preserve existing data first

1. Obtain a PostgreSQL custom-format backup of the existing bakery database and a copy of both legacy public/uploads and uploads photos. Do not reset or seed the live database.
2. Preserve the existing CONFIG_ENCRYPTION_KEY securely if moving encrypted AppConfig rows. Do not post it in chat. The key must remain exactly 64 hexadecimal characters and be backed up separately from the database.
3. Restore a copy into a new isolated database and verify counts, admin login, menu, image URLs and saved settings. Do not restore over a live database to test recovery.
4. The new migration is additive. It adds payment state, encrypted original provider requests, event deduplication and tax/fee snapshots. Legacy fulfillment statuses remain unchanged; their unverified payment state becomes REVIEW. Check for duplicate non-null Stripe session IDs before applying the new unique index.
5. Migrate existing photos using the reviewed storage procedure. Neither a git checkout nor a database dump contains the missing local photo bytes.

## Runtime and configuration

Use a current Node 22 release, at least 22.12.0. Netlify auto-detects its maintained Next.js/OpenNext adapter. The repository supplies netlify.toml: npm run build, publish .next. Do not run prisma migrate deploy in the ordinary build command: preview builds must never mutate production data.

Set real values in the Netlify environment manager, with Functions and Builds scopes where needed. Never commit a filled environment file. Use .env.production.example as the checklist.

- DATABASE_URL: copy the Neon dashboard pooled connection URL with TLS. Bound per-instance Prisma connections (for example connection_limit=3); do not invent a hostname or password.
- DIRECT_DATABASE_URL: the dashboard direct URL, used only in a secure one-off migration/backup session. Override DATABASE_URL with this value for npm run prisma:deploy. The app itself uses the pooled URL.
- APP_URL and NEXT_PUBLIC_APP_URL: the same canonical HTTPS origin. Do not change the origin while checkouts are active without planning return-link continuity.
- JWT_SECRET: a secure random session secret of at least 32 characters. Changing it revokes sessions. Original provider return requests are encrypted and preserved, so retries do not regenerate guest links with a new key.
- CONFIG_ENCRYPTION_KEY: preserve the existing key for existing encrypted values and provider request snapshots.
- IMAGE_STORAGE_PROVIDER=netlify-blobs, NETLIFY_BLOBS_STORE=product-images. The server rejects production filesystem storage. New photos are bounded to 3 MiB, decoded and sanitized to WebP, then served through /api/media.
- TRUST_PROXY remains false unless the hosting proxy's replacement behavior is verified. Shared rate limits are conservative (for example, 20 total checkout attempts per 10 minutes without a trusted IP); configure trusted per-client limits deliberately and test multiple clients. Never trust arbitrary forwarded headers.
- Configure CONTACT_EMAIL, CONTACT_PHONE and the verified SMTP sender/provider. Preserve existing IONOS mail DNS records when adding website DNS. Read DNS targets from the Netlify dashboard rather than guessing them.

Create or update the real admin through npm run admin:setup in an authenticated secure environment with user-chosen ADMIN_EMAIL and ADMIN_PASSWORD. Remove the one-time password environment value afterward. No default production password is supplied. Existing old sample passwords remain rejected in production.

## Ordering configuration

Known menu: Artisan Loaf $12; Herb Focaccia Small $10 / Large $18; Plain and Everything Bagels $3 each. Candies are not for sale. Development seed creates only missing inactive drafts with these names/prices; it creates no fake users, paid orders, locations or opening windows, and is blocked in production. It never overwrites existing products.

Before enabling checkout, confirm ingredients/allergens, photos, stock and customer policies. Configure separate Saturday and Sunday windows in America/New_York. Saturday uses its Thursday cutoff; Sunday uses its Friday cutoff. Tuesday October 13, 2026 is the intended ordering-open date, but no exact time is invented. Each window needs an explicit positive order capacity. Invalid schedules, missing capacity, past fulfillment and elapsed cutoffs fail closed, including manual-open windows.

Confirm delivery ZIPs, nonnegative fees, instructions and actual street addresses; customers must choose a matching five-digit ZIP. Pickup requires an actual address and instructions. Existing sample zones/locations must not be treated as approved business settings.

The app supports an explicitly confirmed, uniform flat tax rate only. Set TAX_RATE_BPS (100 basis points = 1 percent; an intentional 0 is valid) and TAX_DELIVERY_FEE=true/false only after confirming applicability for every offered product and delivery/pickup jurisdiction. This is not an automatic tax-compliance engine. Mixed rates/exemptions need additional implementation before accepting affected orders. Blank values keep checkout disabled.

## Payment setup and launch gate

Checkout stays disabled until CHECKOUT_ENABLED=true, OPERATIONS_CONFIRMED=true, valid tax settings, encryption/session settings and a valid public URL exist. Production additionally requires CHECKOUT_SMOKE_TESTED=true and live-mode provider credentials. Deploy previews cannot accept payments. Enable only providers that have been independently verified.

Stripe:
- STRIPE_ENABLED, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and STRIPE_TEST_MODE must agree. Production rejects test mode.
- Configure the provider endpoint at /api/payments/stripe/webhook for checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, checkout.session.expired, charge.refunded and charge.dispute.created.
- The integration uses hosted Checkout and card payments. Raw card data never reaches this app. Raw-body signatures, mode, canonical session, order identity, currency and exact amounts are checked.

PayPal:
- Configure PAYPAL_ENABLED, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID and PAYPAL_SANDBOX. Production rejects sandbox mode. Secrets are server-only.
- Configure /api/payments/paypal/webhook for CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.DENIED, PAYMENT.CAPTURE.REVERSED and PAYMENT.CAPTURE.REFUNDED.
- Orders and captures are created server-side. Webhooks are verified through PayPal's signature API. Browser returns trigger only a server-side canonical check/capture; approval or query parameters alone never mark an order paid.

Do not change merchant account credentials while reservations are active. Use the provider dashboards for refunds; automatic refund issuance is not implemented. Verified refund/reversal events stop operational progression. Refunds never automatically restock already prepared food.

## Failure recovery and email

Stock and window capacity are reserved transactionally for 35 minutes; carts remain intact until verified payment. One active reservation is allowed per cart. Original provider request parameters and return links are encrypted before any external call. Repeated submissions and provider operations reuse stable idempotency keys.

Stripe expiry is provider-verified before stock is released. Within a conservative 23-hour retained-key window, the exact original create request can be replayed to recover a lost response. A bounded canonical-session search also recovers a lost provider identifier. Even an expires_at validation error does not prove that an earlier request failed; ambiguous failures retain stock and are visible as CREATION_UNKNOWN review. Older unknown results need canonical provider/operator investigation. Use the full local order ID and stored provider references to locate the session in the provider dashboard; retry its signed terminal webhook or run reconciliation once the canonical session is bound. If no session can be found, retain the hold until the merchant/provider confirms the outcome and an explicitly approved maintenance correction is reviewed. There is deliberately no browser button that declares an uncertain payment paid or blindly restores its stock. Do not reset orders or stock to hide an uncertain charge.

PayPal expiry checks the canonical remote order before releasing stock, so a successful capture followed by a local timeout is recovered. A Netlify payment-expiry scheduled function checks one expired PayPal reservation every 15 minutes, even when a full window disables the checkout UI; checkout and admin reconciliation also make bounded checks. A late payment for already released stock is marked REVIEW and does not promise fulfillment. In Admin → Orders, use Check pending payments, inspect unresolved references, and investigate provider dashboards. This action does not issue refunds.

Paid emails are queued only after verified payment. Next after() dispatches a bounded immediate batch; a Netlify scheduled email-retry function retries one job every 15 minutes and cleans expired rate/reset records. Verify the deployed scheduled badge and a real SMTP delivery. The schedule is intentionally modest so an idle free database can sleep. SMTP delivery is at-least-once; provider acceptance followed by a crash can produce a duplicate email. Missing SMTP remains an operational launch blocker.

## Verification and release

Before any publication: npm ci; npm run prisma:generate; npm run lint; npm test; npx tsc --noEmit; npm run audit:dependencies; npm run build. The dependency update has zero production advisories. The raw full audit still identifies one unpatched build-only braces advisory propagated through tooling. The owner approved only the exact dev-only advisory/version/path exception documented in SECURITY-DEPENDENCIES.md, expiring at 2026-11-11T00:00:00Z. The audit:dependencies gate prints raw reports, allows no production exception, and fails on changed scope, new relevant findings, invalid data or expiry. A passing scoped gate does not mean raw full npm audit is clean.

Run tests/integration.ts against a disposable PostgreSQL database whose name is exactly kneaded_loaves_test. The script deletes data in that database. Supply the same DATABASE_URL and JWT_SECRET to a dev server at http://127.0.0.1:3001 and the test process, then run node --import tsx tests/integration.ts. No live provider credential is needed. It covers transactional reservation concurrency, duplicate payment events, mismatch rejection, privacy, stock restoration and existing authentication flows.

On a nonproduction provider test environment, verify both providers end to end: success, decline, double click, lost response/retry, customer cancel/back/refresh, abandoned expiry, duplicate/out-of-order webhook, partial/full refund, tampered signature and mismatched amount. Verify guest receipts and admin delivery printouts. Check photo upload/retrieval after a second deployment without recreating the store. Use a separate test database and photo namespace.

Apply the migration once to the approved isolated production database after backup/restore rehearsal, deploy with checkout still disabled, then validate health, login, mobile cart, photos, provider callbacks, email and free-plan limits. Enable live checkout only after the owner confirms every missing business setting and successful provider test. Keep a previous deploy for rollback; do not roll back the additive schema by deleting payment records.

Sources: [Netlify Next.js](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/), [Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/), [Neon pooled connections](https://neon.com/docs/connect/connection-pooling), [Stripe fulfillment](https://docs.stripe.com/checkout/fulfillment), [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests), [PayPal Orders](https://developer.paypal.com/api/orders/v2), [PayPal webhooks](https://developer.paypal.com/api/webhooks/v1).
