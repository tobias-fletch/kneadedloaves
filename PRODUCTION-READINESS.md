# Production readiness

The existing design, cart, admin and data model are retained. Local implementation does not mean the live bakery can take orders yet.

## Implemented

- Hosted Stripe checkout and server-side PayPal order/capture; no raw card handling.
- Signature-verified webhooks, canonical amount/currency/identity checks, durable event deduplication, protected payment state and refund tracking.
- Transactional inventory/capacity reservations, saved carts, immutable encrypted provider request snapshots, idempotent retries and explicit unknown-payment review.
- Guest receipts that never trust browser success flags; admin delivery address, date and provider references.
- Separate selectable weekend windows, America/New_York parsing, DST validation, Thursday/Friday cutoffs and mandatory capacity.
- Explicit tax/fee configuration with no invented rate; unknown operational settings keep checkout off.
- Authenticated bounded image uploads, sanitized WebP, site-wide Netlify Blobs storage and isolated preview namespaces.
- Confirmed-menu draft seed only; no invented launch schedule, ZIPs, capacity, paid orders or accounts.
- Free-only Netlify/Neon configuration and deployment instructions. No paid auto-upgrade logic.

## Must still be verified before live checkout

- Preserve/import the existing database and actual local photos; prove backup restoration and encrypted-settings continuity.
- Confirm ZIPs, fees, capacity, exact Tuesday opening and Thursday/Friday cutoff times, delivery/pickup times, ingredients/allergens and tax applicability.
- Complete approved provider setup and test both full payment lifecycles with real sandbox credentials, then verify live-mode readiness without fake orders.
- Verify the deployed Netlify runtime, Blobs persistence across redeploy, private guest receipts, mobile/cancel/back flows and webhook delivery.
- Verify SMTP sender, immediate email dispatch and scheduled retry in the deployed environment.
- Track the owner-approved exact build-only audit exception until its 2026-11-11T00:00:00Z expiry; verify free usage limits, operational monitoring and unresolved-payment procedures.

See [DEPLOYMENT.md](DEPLOYMENT.md) and [PHOTO-STORAGE.md](PHOTO-STORAGE.md). Keep CHECKOUT_ENABLED=false until every required setting and test is complete.
