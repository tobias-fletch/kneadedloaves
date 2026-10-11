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
- `npm run email:worker` delivers queued email; requires authenticated SMTP.
- `npm run admin:setup` creates/updates the admin named by ADMIN_EMAIL and ADMIN_PASSWORD.
- `npm run secrets:encrypt` migrates old saved secrets using CONFIG_ENCRYPTION_KEY.
- `npm run backup` creates a PostgreSQL dump using pg_dump or PG_DUMP_PATH.
- `/api/health` reports database health; `/admin/email` shows email delivery status and retries.
- Integration test instructions are in [DEPLOYMENT.md](./DEPLOYMENT.md).

Development uses `.next-dev` and production builds use `.next`, avoiding cache collisions. Run only one development server per checkout. On Windows, stop the dev server before Prisma generation or a build that regenerates Prisma, because its native database driver remains locked while running.

## Launch status

Stripe integration is explicitly deferred. Production checkout is paused until payment completion, abandonment, refunds and webhook verification are implemented. Local development retains the existing Stripe behavior if a key is configured; do not use real payment credentials for testing.

SMTP code, queueing and password recovery are implemented; real delivery needs provider credentials and verification. Automatic social publishing is not connected; approved drafts can be published manually. Hosting, DNS/TLS and provider accounts have not been provisioned.

See [PRODUCTION-READINESS.md](./PRODUCTION-READINESS.md) for verified changes and [DEPLOYMENT.md](./DEPLOYMENT.md) for release, backup, restore and owner setup.
