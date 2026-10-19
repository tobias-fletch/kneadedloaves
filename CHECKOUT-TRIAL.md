# Owner checkout rehearsal

Sign in as an existing administrator, then open `/admin/test-checkout` (also linked from the admin navigation).

This is a no-money UI rehearsal using fictional products, pickup location, and delivery fee ($5). It uses the production `orderSchema` field validation and `formatMoney` formatting. Its status model is isolated pure simulation code; it does not call production order or payment APIs. It neither proves actual Venmo payment settlement nor verifies live email, database, reservation concurrency, or recovery behavior.

## Walkthrough

1. Choose a fictional item, quantity 1–5, and pickup or delivery. Keep the fictional contact details. Delivery uses fictional ZIP 00000.
2. Place the TEST order. Review the amount and unpaid status.
3. Try fulfillment before verification: it must fail.
4. Simulate “I paid”: status must remain pending, with review requested.
5. Enter an incorrect received amount and try owner verification: it must fail. Restore the exact total and verify: status becomes paid.
6. Advance through preparing, ready, and complete. Delivery includes out-for-delivery.
7. Start another test to explore cancellation or deadline expiry. Closed orders cannot progress. Refreshing discards the local state.

## Safety boundaries

- Server page and surrounding admin layout both call `requireAdmin`.
- No test API routes, server actions, payment destinations, test-mode bypasses, credentials, new settings, or schema changes.
- Trial code imports only React, production pure validation/money helpers, and its own pure state machine.
- Trial state stays in React memory; it does not use cookies, browser storage, emails, cart/checkout APIs, or database writes.
- Standard application layout/session loading still performs its usual read-only rendering and authentication work. The surrounding application's ordinary navigation remains available.
- Production payments remain controlled by the operational readiness settings. The October 15 release removed the unconditional hard-stop; the trial does not enable checkout.

## Checks

`npm test`, `npx tsc --noEmit --incremental false`, and `npm run lint`.

Focused `tests/checkout-trial.test.ts` covers field/quantity/ZIP validation, totals, claims staying unpaid, exact-amount verification, pickup/delivery paths, cancel/expiry terminal states, the server authentication call, and an explicit dependency allowlist excluding networking and storage from trial code.

When changing the trial, preserve production readiness gates, rerun checks, and verify mobile UI and authenticated access. Do not run the production build wrapper or integration tests against the production database for rehearsal QA.
