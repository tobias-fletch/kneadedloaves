# Kneaded Loaves

Next.js bakery storefront with PostgreSQL/Prisma, customer accounts, guest carts, ordering windows, manual Venmo payments, inventory and durable email jobs.

## Launch behavior

The October 15 release removed the unconditional production checkout stop. Checkout still defaults off and requires every operational gate in [VENMO-OPERATIONS.md](VENMO-OPERATIONS.md). Orders remain unpaid reservations until the owner independently checks Venmo and records payment. Stripe and automatic social publishing are deferred, not requirements for Venmo checkout.

GitHub reported a successful Vercel deployment of `f5d4ff6` on October 15, 2026. That does not prove live database health, worker operation or email delivery. The owner now intends to move to ChatGPT Sites and retain only shop items. See [HOSTING-MIGRATION.md](HOSTING-MIGRATION.md).

## Local development

Use Node 22.12+ and PostgreSQL. Run `npm ci` and `npm run prisma:generate`. For a fresh local installation, copy `.env.example` to `.env`, supply a local database URL and independent session/encryption secrets, then run `npm run prisma:deploy` and `npm run dev -- --hostname 127.0.0.1`.

Preserve existing environment files and encryption keys when opening an existing database. Never use production credentials for tests. Sample seeding is optional for disposable development data and blocked in production. Sample passwords must not be used for launch.

## Checks and operations

- `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run build:runtime`
- `npm audit --omit=dev --audit-level=moderate` gates shipped dependencies; review full `npm audit` separately.
- Disposable database and production HTTP tests: [DEPLOYMENT.md](DEPLOYMENT.md).
- `npm run email:worker` delivers queued messages; `npm run payments:expire` expires unpaid reservations. Deploy both independently of visitor requests.
- `npm run admin:setup` uses `ADMIN_EMAIL` and `ADMIN_PASSWORD` to create/update the real admin.
- `npm run backup` uses `pg_dump`; `/api/health` checks database connectivity.
- Admin > Products > Export shop items downloads catalog data and image references for migration.

Development uses `.next-dev`; production uses `.next`. On Windows, stop the dev server before regenerating Prisma to avoid locking its native driver.

See [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md) for outstanding launch work.
