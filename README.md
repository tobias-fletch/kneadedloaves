# Kneaded Loaves

Next.js bakery storefront and operations app with PostgreSQL/Prisma, customer accounts, cart, order windows, encrypted settings, durable email delivery and social drafting.

## Local use

The existing workspace database runs on port 55433. Start it when needed:

```powershell
Start-Process -FilePath 'C:\Program Files\PostgreSQL\18\bin\postgres.exe' -ArgumentList '-D','.postgres-data','-p','55433' -WorkingDirectory 'C:\Users\Tobias\Documents\Bakery Project' -WindowStyle Hidden
```

Then run `npm ci`, `npm run prisma:generate`, `npm run prisma:deploy` and `npm run dev -- --hostname 127.0.0.1`. Open http://127.0.0.1:3000. Keep the existing `.env`; it holds the encryption key for saved settings. Do not replace it with the example file.

For a fresh installation, copy `.env.example`, configure PostgreSQL and generate a random encryption key before saving credentials. Sample seeding (`npm run prisma:seed`) is optional for a disposable development database only; it is blocked in production.

Development-only sample logins from the original seed remain `admin@bakery.local` / `admin12345` and `customer@example.com` / `customer12345`. Change them before launch. They are not displayed in the app and those passwords are rejected in production.

## Checks and operations

- `npm run lint`, `npm test`, `npm run build`, `npm audit`
- `npm run email:worker` delivers queued email; requires authenticated SMTP. On Vercel the same function runs from `/api/cron/email-worker` and, after checkout, for that order immediately.
- `npm run payments:expire` expires overdue unpaid reservations. On Vercel, `/api/cron/payments-expire` is the daily backstop; order pages also expire overdue reservations when they are read.
- `npm run admin:setup` creates/updates the admin named by ADMIN_EMAIL and ADMIN_PASSWORD.
- `npm run secrets:encrypt` migrates old saved secrets using CONFIG_ENCRYPTION_KEY.
- `npm run backup` creates a PostgreSQL dump using pg_dump or PG_DUMP_PATH.
- `/api/health` reports database health; `/admin/email` shows email delivery status and retries.
- Integration test instructions are in [DEPLOYMENT.md](./DEPLOYMENT.md).

Development uses `.next-dev` and production builds use `.next`, avoiding cache collisions. Run only one development server per checkout. On Windows, stop the dev server before Prisma generation or a build that regenerates Prisma, because its native database driver remains locked while running.

## Launch status

The shop is hosted on Vercel. Checkout is not hard-disabled in code. `POST /api/checkout` accepts an order only when the order window is open and `getManualPaymentConfig()` is ready: `VENMO_CHECKOUT_ENABLED`, a verified Venmo handle, destination, fingerprint and hold time, `PAYMENT_WORKERS_READY`, `CHECKOUT_SMOKE_TESTED`, authenticated SMTP, `EMAIL_FROM`, a `JWT_SECRET` of at least 32 characters, and an HTTPS `APP_URL`. Vercel environment variables override Admin > Setup values. The storefront says Orders Open only when that same check passes.

Order email is queued in the database. On Vercel, a successful checkout sends that order's messages with `after()` so they do not wait for cron. `vercel.json` schedules the email and payment-expiry routes once per day, which is the Hobby plan limit (a per-minute schedule fails deploy, and Hobby may start a daily job up to 59 minutes late). Both routes require `Authorization: Bearer ${CRON_SECRET}` and reject a missing or wrong secret. `npm run email:worker` and `npm run payments:expire` call the same functions for a local or always-on host. Gmail (`smtp.gmail.com`, port 465 SSL or 587 STARTTLS, app password, From matching the authenticated mailbox) allows about 500 messages per day.

Stripe code is still present and unused. Do not use real payment credentials for testing. Automatic social publishing is not connected.

See [PRODUCTION-READINESS.md](./PRODUCTION-READINESS.md) for verified changes and [DEPLOYMENT.md](./DEPLOYMENT.md) for release, backup, restore and owner setup.
