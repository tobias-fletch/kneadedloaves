# Isolated PostgreSQL integration QA

These suites use real PostgreSQL transactions, advisory locks, constraints, and concurrency. Stripe/PayPal APIs are deterministic mocks; no live payments or credentials are needed. Never run against shop data.

## Safety and prerequisites

- Node 22+; `npm ci` and `npm run prisma:generate` completed.
- A disposable PostgreSQL database named **kneaded_loaves_test** on localhost/127.0.0.1.
- `BAKERY_INTEGRATION_TESTS=1` explicitly enables the suites. All added scripts reject other hosts/database names.
- Migration preservation requires a **pristine** test database and refuses to reset an existing database.
- Existing `tests/integration.ts` clears its dedicated test records. Extended QA adds synthetic fixtures. Dispose of the test database after the run.

Example fixture configuration (all secrets below are deliberately fake):

```sh
export DATABASE_URL='postgresql://bakery_test:test-only-password@localhost:5432/kneaded_loaves_test?schema=public'
export BAKERY_INTEGRATION_TESTS=1
export APP_URL='http://127.0.0.1:3001'
export JWT_SECRET='ci-only-secret-never-use-in-production-2026'
export CONFIG_ENCRYPTION_KEY='0101010101010101010101010101010101010101010101010101010101010101'
export CHECKOUT_ENABLED=false
export STRIPE_SECRET_KEY='sk_test_synthetic_bakery_qa_only'
export STRIPE_TEST_MODE=true
export STRIPE_WEBHOOK_SECRET='whsec_synthetic_bakery_qa_only'
export PAYPAL_WEBHOOK_ID='qa-fixture'
```

Then run:

```sh
bash tests/integration-qa/migration-preservation.sh
npm run dev -- --hostname 127.0.0.1 --port 3001
# In another shell with the same fixture environment, after /api/health is ready:
node --import tsx tests/integration.ts
node tests/integration-qa/webhook-http.mjs
node --import tsx tests/integration-qa/extended.mjs
```

The GitHub Verify workflow runs this sequence on PostgreSQL 18. `node --import tsx` avoids the CLI's Unix IPC listener, so the tests also work in restricted test environments.

## Coverage

- Migration applies all four historical migrations, writes representative synthetic records across 10 tables and all seven order states, applies the additive checkout migration, compares every original field, and repeats deploy/verification to prove replay is a no-op. No actual store data is copied.
- Existing HTTP suite covers cart/capacity, checkout gating, authenticated receipts, account flows/admin denial/session revocation/password reset, request controls, payment/stock idempotency, and email retry exhaustion.
- Webhook HTTP tests reject absent, tampered, stale and mode-mismatched Stripe signatures, accept a correctly signed synthetic ignored event, and reject unsigned PayPal events.
- 18 extended groups cover final-unit stock across distinct windows, capacity concurrency, duplicate checkout keys/events, transactional rollback, expiry/payment races, late payment review, partial/full refund ordering and replay, PayPal capture/refund deduplication, delivery ZIP/configuration/tax/fees, reconciliation failure isolation, and recovery after the provider retry window.
- A deferred PostgreSQL constraint trigger intentionally fails COMMIT after mocked provider creation. Retry must recover the same session with the original request/key, despite changed URL/session configuration. Its expected Prisma commit error in logs is not a failing test.

Each suite exits nonzero on an assertion failure. HTTP uses the configured loopback APP_URL (or TEST_APP_URL). Extended provider mocks fail on unexpected network calls and restore patched SDK/fetch functions after each scenario.

These checks do **not** verify actual provider accounts/webhook delivery, real SMTP, production hosting, browser interaction/visual behavior, or migration of actual shop data.
