# Hosting the shop on Netlify

The repo is Netlify-ready: `netlify.toml` sets the build command (`npm run build`)
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

- Apex (`kneadedloaves.com`): `A` record → `75.2.60.5` (Netlify load balancer)
- `www`: `CNAME` → `<your-site>.netlify.app`

TLS certificates are issued automatically. After DNS propagates, remove the
domains from the Vercel project (or delete it) so traffic stops going there.

## 3. Things that do NOT move to Netlify

- **Email + payment expiry** now run on Vercel through daily cron routes and
  checkout-time sending. This Netlify guide does not schedule those routes.
  The supported host is Vercel.
- **Admin uploads** (`/api/admin/uploads`): Netlify functions have ephemeral
  disk, so files uploaded via the admin panel won't survive deploys. Keep using
  committed `/menu-art/...` images (the current products already do).
- **Checkout** is not hard-stopped in code. It stays unavailable until the
  Venmo, email, secret, and smoke-test gates in `VENMO-OPERATIONS.md` pass.
  Moving hosts does not turn those gates on.
