# Hosting the shop on Netlify

This is an optional Node hosting path; the requested Sites migration is documented in HOSTING-MIGRATION.md. Configuration exists but hosted behavior must still be verified: `netlify.toml` sets the build command (`npm run build`)
and publish directory (`.next`), and the build script runs the guarded Prisma
migrations on Netlify production deploys exactly as it did on Vercel
(`NETLIFY=true` + `CONTEXT=production`). Preview/branch deploys never migrate.

## 1. Create the site (Netlify dashboard)

1. Netlify → **Add new site → Import an existing project → GitHub** →
   `tobias-fletch/kneadedloaves`.
2. Build settings are picked up from `netlify.toml` automatically; leave them.
3. **Site settings → Environment variables** — copy every value from your current
   Vercel project (or `.env.production.example`):
   - `DATABASE_URL` — the existing Neon pooled connection string (same database,
     no data moves)
   - `APP_URL` and `NEXT_PUBLIC_APP_URL` — `https://kneadedloaves.com`
   - `JWT_SECRET`, `CONFIG_ENCRYPTION_KEY`
   - `CONTACT_EMAIL`, `CONTACT_PHONE`, `EMAIL_FROM`
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`
   - `VENMO_CHECKOUT_ENABLED=false`, `VENMO_HANDLE`, `VENMO_DESTINATION`,
     `VENMO_DESTINATION_VERIFIED`, `VENMO_VERIFIED_FINGERPRINT`,
     `PAYMENT_HOLD_MINUTES`, `PAYMENT_WORKERS_READY`, `CHECKOUT_SMOKE_TESTED`
   - `TRUST_PROXY=false` (keep false unless Netlify is configured to replace
     `X-Forwarded-For`)
4. Deploy. The first production deploy runs the migration guard + `migrate deploy`
   against Neon, then builds.

## 2. Point DNS at Netlify

In **Domain settings → Add custom domain**, add `kneadedloaves.com` and
`www.kneadedloaves.com`, then at your registrar:

- Apex (`kneadedloaves.com`): use the exact current apex records provided by the Netlify domain setup
- `www`: `CNAME` → `<your-site>.netlify.app`

TLS certificates are issued automatically. After DNS propagates and the replacement passes checkout verification, retire the
domains from the Vercel project only after retaining a rollback path.

## 3. Things that do NOT move to Netlify

- **Email + payment-expiry workers** (`npm run email:worker:production`,
  `npm run payments:expire:production`) need a supervised runner;
  this repository does not configure them on Vercel or Netlify. Verify where they run before enabling checkout.
- **Image storage**: the current repository has no admin upload handler. Serverless functions have ephemeral
  disk, so disk-based uploads need durable external storage. Keep using
  committed `/menu-art/...` images (verify live product references before moving).
- **Checkout** stays disabled until the Venmo gates in `VENMO-OPERATIONS.md`
  are configured and verified — hosting change does not lift that.
