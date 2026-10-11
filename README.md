# Kneaded Loaves

Next.js bakery storefront and operations app with PostgreSQL/Prisma, customer accounts, cart, order windows, encrypted settings, durable email delivery and social drafting.

## Local use

The existing workspace database runs on port 55433. Start it when needed:

```powershell
Start-Process -FilePath 'C:\Program Files\PostgreSQL\18\bin\postgres.exe' -ArgumentList '-D','.postgres-data','-p','55433' -WorkingDirectory 'C:\Users\Tobias\Documents\Bakery Project' -WindowStyle Hidden
```

Then run `npm ci`, `npm run prisma:generate`, `npm run prisma:deploy` and `npm run dev -- --hostname 127.0.0.1`. Open http://127.0.0.1:3000. Keep the existing `.env`; it holds the encryption key for saved settings. Do not replace it with the example file.

For a fresh installation, copy `.env.example`, configure PostgreSQL and generate a random encryption key before saving credentials. Development menu seeding (`npm run prisma:seed`) creates only missing inactive drafts of the owner-confirmed menu; it is blocked in production and never overwrites existing products.

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

Hosted Stripe and server-side PayPal checkout, verified webhooks, transactional reservations, selectable Eastern-time weekend windows and Netlify Blobs photo storage are implemented. Checkout stays off until explicit business settings, tax handling, provider configuration and live-readiness tests are verified.

The free-hosting target is the existing Netlify site plus an isolated Neon Free database. No paid plan or automatic upgrade is configured. Real deployment, data/photo migration, SMTP and provider end-to-end verification are still required. Read [PRODUCTION-READINESS.md](./PRODUCTION-READINESS.md), [DEPLOYMENT.md](./DEPLOYMENT.md) and [PHOTO-STORAGE.md](./PHOTO-STORAGE.md) before enabling checkout.
