# Kneaded Loaves: developer guide

A plain-language map of this repo for a developer who is new to it. It is built from the files in the repo (package.json, vercel.json, `.github/workflows`, `prisma/`, `scripts/`, README and the other docs at the root). Anything that is not in the repo, or that could not be checked, is marked **to confirm**.

Secret values never belong in this file or anywhere in git. Only variable *names* appear below.

## 1. What this is

kneadedloaves.com is the online shop for a small bakery: a weekly menu, a cart, order windows and capacity, pickup or delivery zones, a manual Venmo payment flow with a payment hold, an email queue, and an owner admin at `/admin`.

## 2. Stack

| Part | What it uses |
| --- | --- |
| App | Next.js (App Router) + React, TypeScript (package name `micro-bakery`) |
| Data | PostgreSQL through Prisma (schema and migrations in `prisma/`) |
| Hosting | Vercel (team `tobias-da6e`, project `kneadedloaves`) |
| Database host | Neon, connected through the Vercel Neon integration |
| Email | Resend only (its SMTP relay, through nodemailer), queued in the database and sent by the email worker |
| Node | `>=22.12` (see `engines`); CI uses Node 24 |

Legacy files that are **not** used by the live site: `Dockerfile`, `compose.yaml`, `netlify.toml` (the site used to run on Netlify).

## 3. Repo layout

```
app/            Next.js routes: shop pages, cart, checkout, account, /admin, /api/*
  app/api/cron/ payments-expire and email-worker (called by Vercel Cron and kl-cron)
  app/api/health  health check used by monitoring
components/     React components
lib/            shared logic: cart rules, order windows, delivery zones, payments, mail, auth,
                preview-database guard (lib/preview-database.ts)
prisma/         schema.prisma, migrations/, seed.ts, preview-menu.json
public/menu-art/  menu illustrations (*.jpg) and real menu photos (photos/*.webp)
scripts/        build.mjs (build + DB guards), email worker, payment expiry, admin setup,
                encrypt-config, backup
tests/          node:test unit tests and integration tests
middleware.ts   request middleware
DEPLOYMENT.md, VENMO-OPERATIONS.md, CHECKOUT-TRIAL.md, PRODUCTION-READINESS.md   operations docs
```

## 4. Local setup

You need Node 22.12+ and a local PostgreSQL. Never point a local checkout at the production database.

```bash
npm ci
cp .env.example .env          # fill DATABASE_URL with a LOCAL Postgres, plus JWT_SECRET and CONFIG_ENCRYPTION_KEY
npm run prisma:generate
npm run prisma:deploy         # apply migrations to the local DB
npm run prisma:seed           # sample data (refuses non-local DBs)
npm run admin:setup           # create the local admin account
npm run dev
```

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next dev server / production build (`node scripts/build.mjs`) / production server |
| `npm run lint` | ESLint |
| `npm test` | Unit tests: `node --import tsx --test tests/*.test.ts tests/*.test.mjs` |
| `npm run test:integration` | Integration tests against a running app |
| `npm run prisma:generate` / `prisma:migrate` / `prisma:deploy` / `prisma:seed` | Prisma client, new dev migration, apply migrations, seed |
| `npm run email:worker` | Send queued email (`-- --once` for one pass) |
| `npm run payments:expire` | Expire unpaid orders past the payment hold |
| `npm run admin:setup` | Create or reset the admin account |
| `npm run secrets:encrypt` | Encrypt stored config with `CONFIG_ENCRYPTION_KEY` |
| `npm run backup` | `pg_dump` backup (uses `PG_DUMP_PATH`, `BACKUP_DIR`) |
| `npm run build:workers` / `build:runtime` | Bundle the worker scripts and runtime config with esbuild |

## 5. Environment variables (names only)

Set them in Vercel (Project → Settings → Environment Variables) or a local `.env`. Never commit values.

- **Core:** `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `JWT_SECRET`, `CONFIG_ENCRYPTION_KEY`, `CRON_SECRET`, `APP_URL`, `NEXT_PUBLIC_APP_URL`, `TRUST_PROXY`, `UPLOAD_DIR`
- **Admin and contact:** `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NOTIFY_EMAIL`, `CONTACT_EMAIL`, `CONTACT_PHONE`, `CONTACT_LIVE_SEND`, `KL_ORIGIN_LATLNG`
- **Payments (manual Venmo):** `PAYMENT_HOLD_MINUTES`, `PAYMENT_WORKERS_READY`, `CHECKOUT_SMOKE_TESTED`, `VENMO_CHECKOUT_ENABLED`, `VENMO_HANDLE`, `VENMO_DESTINATION`, `VENMO_DESTINATION_VERIFIED`, `VENMO_VERIFIED_FINGERPRINT`
- **Stripe (legacy, not the live payment path):** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_MCP_KEY`
- **Mail:** `RESEND_API_KEY` (the only send path), `EMAIL_OSWALD_FONT`. Contact-form sending is switched by `CONTACT_LIVE_SEND` (above); links in mail use `APP_URL`.
- **Neon integration (Production only):** `URL_DATABASE_URL`, `URL_DATABASE_URL_UNPOOLED`, `URL_POSTGRES_PRISMA_URL`, `URL_POSTGRES_URL`, `URL_POSTGRES_URL_NON_POOLING`, `URL_POSTGRES_URL_NO_SSL`, `URL_PGHOST`, `URL_PGHOST_UNPOOLED`, `URL_PGUSER`, `URL_PGPASSWORD`, `URL_PGDATABASE`, `URL_POSTGRES_HOST`, `URL_POSTGRES_USER`, `URL_POSTGRES_PASSWORD`, `URL_POSTGRES_DATABASE`, `URL_NEON_PROJECT_ID`, `URL_NEON_AUTH_BASE_URL`, `URL_VITE_NEON_AUTH_URL`
- **Preview guard:** `PRODUCTION_DB_HOST` (optional extra host to refuse)
- **Public / analytics:** `NEXT_PUBLIC_CF_ANALYTICS_TOKEN`, `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`
- **Backups:** `PG_DUMP_PATH`, `BACKUP_DIR`
- **Tests:** `TEST_APP_URL`, `TEST_CANONICAL_ORIGIN`, `TEST_SECURITY_MODE`, `BUILD_GUARD_TEST_DATABASE_URL`, `CHROME_PATH`
- **Set by the platform:** `VERCEL`, `VERCEL_ENV`, `NODE_ENV` (and legacy `NETLIFY`, `CONTEXT`)
- **Legacy social (unused):** `FACEBOOK_PAGE_TOKEN`, `INSTAGRAM_GRAPH_TOKEN`, `TIKTOK_*`, `YOUTUBE_*`

The `URL_*` variables exist only in the Production environment. Preview deployments get their own Neon branch from the integration (see section 7).

## 6. Branches and deploy flow

- **Live branch: `main`.** Vercel auto-deploys every push to `main` to production.
- Work on a feature branch, open a PR into `main`. Vercel builds a preview for each PR.
- `scripts/build.mjs` decides what a build may do:
  - **Production build** (`VERCEL_ENV=production`): runs a read-only migration-history checksum guard, then `prisma migrate deploy` (retrying the transient Prisma errors P1001/P1002/P1017), then `next build`.
  - **Preview build:** never migrates production. It uses only the preview Neon branch, scrubs customer data from that branch, and refuses to run if the database looks like production (section 7).
- **Vercel Cron** (`vercel.json`, daily because of the Hobby plan): `/api/cron/payments-expire` at 16:00 UTC and `/api/cron/email-worker` at 17:00 UTC. They send `Authorization: Bearer $CRON_SECRET`.
- **kl-cron (to confirm, not in this repo):** a separate Cloudflare Worker calls the health check every 5 minutes and the payments-expire and email-worker routes every 15 minutes with the same `CRON_SECRET`. The Vercel crons stay as a backup.

### Rollback

1. Vercel dashboard → project `kneadedloaves` → Deployments → pick the last good production deployment → **Instant Rollback** (or "Promote to Production").
2. Then fix forward in git: `git revert -m 1 <merge-commit>` on a branch, PR into `main`. Never force-push `main`.
3. Database: migrations are forward-only. If a migration went wrong, restore from backup into a **new** database (see DEPLOYMENT.md) rather than editing production in place.

## 7. Data and database

- PostgreSQL on Neon via the Vercel integration. Schema: `prisma/schema.prisma`; 11 migrations in `prisma/migrations/`.
- **Preview database guard (PR #40, merged):** `lib/preview-database.ts` and `scripts/build.mjs`.
  - Previews read only `URL_POSTGRES_PRISMA_URL` / `URL_DATABASE_URL`, which point at the preview's own Neon branch.
  - The guard refuses any host whose fingerprint (first 10 hex characters of the sha256 of the hostname) is in the committed `PRODUCTION_DB_HOST_FINGERPRINTS` list, and also refuses the hosts in `PRODUCTION_DB_HOST` and `DATABASE_URL`. Only fingerprints are committed, never hostnames.
  - Preview builds scrub customer data from the preview branch and never migrate.
- **Neon preview cleanup:** `.github/workflows/neon-preview-branch-cleanup.yml` deletes the `preview/<branch>` Neon branch when a PR closes or a branch is deleted, and prunes weekly. It uses the `NEON_API_KEY` GitHub secret.
- **Menu photos (2026-10-29):** see "Menu photos" below.
- **Backups and restore:** `npm run backup`; restore into a new database, never over production (DEPLOYMENT.md).
- `prisma/seed.ts` refuses a non-local database unless `ALLOW_SEED=1`. Do not seed production.

### Menu photos

- **Where they live:** real product photos are in `public/menu-art/photos/<slug>.webp`, with EXIF/GPS and all other metadata stripped. Today: `plain-focaccia` and `artisan-bread` are normal 1800x1200 (3:2) photos. `bagels-6-pack` and `cookies-6-pack` are cut-outs: a single item with the background removed, saved as transparent WebP. Herbal Focaccia has no photo yet and keeps its illustration.
- The old illustrations stay at `public/menu-art/*.jpg`. `lib/menu-artwork.ts` zooms those **exact paths** (0.72x to 1.9x on a cream background), so never overwrite them with a photo. Add a new photo at a new path instead.
- `components/MenuProductImage.tsx` reads each photo's `fit` from `lib/menu-images.ts`:
  - `cover` photos, and any custom upload, are cropped to fill the card.
  - `contain` cut-outs are shown whole and centred on the card's cream colour (`bg-page`), never cropped.
  - `next/image` sends phones a resized WebP/AVIF copy (its `sizes` matches the 1/2/3-column grid), and transparency is kept. So only the one WebP per item is committed, with no -900 or JPG copies.
  - If a JPG of a cut-out is ever needed, flatten it onto the cream `#e9e4d3`, never black.
- The list admins pick from (Admin > Products, both the add form and the edit form) is `lib/menu-images.ts`, together with each photo's alt text. Picking a photo stores that alt text; anything else stores the product name.
- **The live menu reads images from the database** (`ProductImage.url`, shown as `product.images[0]`), not from these files or `prisma/preview-menu.json`. Adding a photo file changes nothing on the live site until the database points at it.
- **Previews:** each preview has its own Neon branch. If that branch has no products, the build seeds `prisma/preview-menu.json`. If it already has the menu (copied from the live data), the build applies `scripts/menu-photos-2026-10-29.sql` to that preview branch only, after the preview guard has refused production. Either way the preview shows the photos.
- **Go-live step (production database, by Tobias or with his okay, after the code is live in production):**
  `npx prisma db execute --schema prisma/schema.prisma --file scripts/menu-photos-2026-10-29.sql`
  It is idempotent: it changes a `ProductImage` row only if its product matches by slug or exact name **and** the row still uses the old illustration. It sets `url` to the photo and `alt` to the photo's description. Alternative without SQL: in `/admin` > Products, edit each of the four items and pick its "(photo)" image.
- **Rollback:** `npx prisma db execute --schema prisma/schema.prisma --file scripts/menu-photos-2026-10-29.rollback.sql` puts the four items back on `/menu-art/<name>.jpg` with the product name as alt text (the values on the live site on 2026-10-29).

## 8. Hosting and DNS

- Hosting: Vercel, team `tobias-da6e`, project `kneadedloaves`. Health check: `/api/health`.
- DNS for kneadedloaves.com is at **IONOS** (records point at Vercel).
- Email DNS (to confirm current state): the domain was locked down with strict SPF/DMARC and a null MX because it does not receive mail. Resend needs its sending records (DKIM, plus SPF/MX on the `send.` subdomain) at IONOS for mail to deliver.

## 9. Email

- **Resend is the only way the site sends email.** Order, reservation, payment, password-reset and contact-form mail is queued in the database and sent by the email worker (and, on Vercel, right after checkout) through Resend's SMTP relay (`smtp.resend.com`, port 465, user `resend`, password = `RESEND_API_KEY`). Code: `lib/mail-provider.ts`, `lib/email-queue.ts`.
- Every message is From **Kneaded Loaves <noreply@kneadedloaves.com>** with Reply-To **kneadedloaves@gmail.com**. Contact-form notifications go TO kneadedloaves@gmail.com. A From outside kneadedloaves.com is refused.
- If `RESEND_API_KEY` is not set, nothing is sent: queued jobs retry and then show as failed, checkout stays closed (readiness needs email), and Admin > Setup shows "Not configured". There is no Gmail fallback any more.
- The key is set only in Vercel, never in Admin > Setup. Setup shows a "Configured / Not configured" Resend status and never shows the key.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `EMAIL_FROM` are no longer read anywhere. Old values saved in the database (`AppConfig` rows) are left in place but ignored; no migration removes them.
- Non-production deployments (Vercel preview/development) only email `tobias.fletch@gmail.com` and `kneadedloaves@gmail.com`.
- Contact form live sending is controlled by `CONTACT_LIVE_SEND`; the public contact address is `CONTACT_EMAIL` or the bakery default, never a sender setting.

## 10. Tests and CI

- `npm test` runs the node:test suite. `npm run test:integration` runs against a live local app.
- **CI:** `.github/workflows/verify.yml` on every push and PR. It starts a `postgres:18` service, then: `npm ci` → `prisma:generate` → `lint` → `test` → build-guard integration test → `npm audit --omit=dev` → `build` → `build:runtime` → `prisma:deploy` → integration tests against the app on port 3001.
- `.github/workflows/neon-preview-branch-cleanup.yml` (section 7).

## 11. Security notes and safeguards

- Never connect a preview, a local checkout or a test to the production database. The preview guard will stop a build that tries.
- Only commit host *fingerprints*, never database hostnames or connection strings.
- `/admin` and `/api/admin/*` need the admin session (`JWT_SECRET`). Cron routes need `CRON_SECRET`.
- Stored config is encrypted with `CONFIG_ENCRYPTION_KEY`.
- Checkout is gated by `VENMO_CHECKOUT_ENABLED`, `VENMO_DESTINATION_VERIFIED`, `PAYMENT_WORKERS_READY` and `CHECKOUT_SMOKE_TESTED`. Don't flip them without the owner.
- Never merge, deploy or publish without Tobias's okay. Never force-push.

## 12. Known gotchas

- **Freeze (to confirm, not in repo):** until at least Sun Nov 1, 2026 only menu and photo updates and real bug fixes go live. Test locally, not on `*.vercel.app` previews. The live menu is edited in `/admin`, not in code.
- The `URL_*` database variables are Production-only. A preview without its Neon branch will fail the guard rather than fall back to production. That is intended.
- Vercel Hobby allows only daily crons, which is why kl-cron exists.
- `netlify.toml`, `Dockerfile` and `compose.yaml` are leftovers; changing them does nothing to the live site.
- Fractal Productions (`fractal-store`) copies this repo's store logic. A fix to shared store code should be mirrored there (see that repo's `SYNC.md`).

## 13. To confirm

- kl-cron Worker schedule and where its code lives (not in this repo).
- The menu/photo freeze end date.
- Resend DNS records at IONOS.
- When to delete the retired `SMTP_*` / `EMAIL_FROM` Vercel env vars (after the Resend-only PR is live).

## Changelog

- 2026-10-29: guide created
- 2026-10-29: email is Resend only. Removed the Gmail SMTP fallback, the `SMTP_*` and `EMAIL_FROM` settings, the Setup "Check SMTP connection" button and its route; Setup now shows a Resend status. Old SMTP values in the database are ignored, not deleted.
- 2026-10-29: real menu photos for Plain Focaccia, Artisan Bread, Bagels (6 pack) and Cookies (6 pack) in `public/menu-art/photos/` (Herbal Focaccia keeps its illustration). Focaccia and bread are cropped photos; bagels and cookies are single-item cut-outs shown whole on cream. All use responsive sizes; admins can pick them in Admin > Products. Previews show them; the live site needs the go-live database step in section 7 ("Menu photos").
