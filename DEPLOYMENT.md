# Kneaded Loaves deployment

The shop runs on Vercel with Node 24. Checkout is not hard-disabled in code. It accepts orders only when the order window is open and every gate in VENMO-OPERATIONS.md passes. Vercel environment variables override Admin > Setup. Email and payment expiry run in the Vercel deployment: checkout sends that order's email immediately, and `vercel.json` schedules daily Hobby-safe cron as the backstop. `CRON_SECRET` must be set or the cron routes reject every caller.

Production build migration handling is guarded and uses DATABASE_URL only. The existing live schema needs separately approved baseline reconciliation; do not deploy blindly, reset data, or substitute another integration URL. Preview builds never migrate.

The production guard accepts a nonempty, checksum-matching contiguous prefix of the repository migrations, including a separately approved initial-only baseline. Completed records must be in migration order. It rejects empty/unbaselined history, gaps, out-of-order records, unknown or unresolved failed migrations, checksum drift, and recognizable schema effects whose migration is not recorded. Required table/column checks follow the recorded prefix: AppConfig is required after its migration, hardening fields/tables after hardening, and manual-payment fields/PaymentEvent after the final migration. These presence checks are not a complete type/index/constraint comparison.

After the read-only preflight succeeds, normal Prisma migration deployment executes every remaining migration, followed by a read-only completion check before client generation and the Next.js build. The helper never inserts or resolves baseline/history records itself. An initial-only baseline therefore runs migrations 2–4 and the new manual-payment migration; do not mark those pending migrations applied without executing them.

## Required services and settings

The production domain is `kneadedloaves.com`. Copy `.env.production.example` to the ignored `.env.production` on the host and supply the missing secrets and provider settings. The Docker build passes the public URL at build time, because Next.js embeds public environment variables in the browser bundle. Rebuild the image if the domain changes.

The following infrastructure checklist is generic operator guidance, not a request to change the existing host or DNS. Leave `VENMO_CHECKOUT_ENABLED` false until Resend email (`RESEND_API_KEY`), cron, and a non-production smoke test are done. Provider payment readiness is a separate launch decision.

1. Provision PostgreSQL with authenticated TLS access and automated backups. Set `DATABASE_URL` in the host secret manager. Do not expose the local development cluster publicly.
2. Set `APP_URL` and `NEXT_PUBLIC_APP_URL` to the same HTTPS domain. Configure DNS, TLS termination, upstream timeouts, a 6 MB request limit and error-log retention at your reverse proxy/host.
3. Set a random `JWT_SECRET` of at least 32 characters and a separate `CONFIG_ENCRYPTION_KEY` of exactly 64 random hexadecimal characters. Store and back up the encryption key separately from database backups. Environment values take precedence over admin-saved values.
4. Site email (all order, payment, password-reset and contact-form mail) goes **only through Resend**. Set `RESEND_API_KEY` (a sending-only Resend key scoped to kneadedloaves.com) as a Vercel env var; it is never entered in Admin > Setup, which only shows whether it is configured. Mail uses the Resend SMTP relay (`smtp.resend.com`, port 465, user `resend`) and every message is sent From `Kneaded Loaves <noreply@kneadedloaves.com>` with Reply-To `kneadedloaves@gmail.com` (`lib/mail-provider.ts`); a From outside kneadedloaves.com is refused. Without the key nothing is sent (queued jobs retry, then fail) and checkout readiness stays off. `SMTP_*` and `EMAIL_FROM` are no longer read; old values saved in the database are ignored and left in place. The domain needs the Resend DKIM and `send.` SPF/MX records in DNS; the existing DMARC policy (`p=reject`, strict alignment) passes because DKIM signs as `d=kneadedloaves.com`. **Preview allowlist:** every non-production Vercel deployment (`VERCEL_ENV` preview or development) only emails `tobias.fletch@gmail.com` and `kneadedloaves@gmail.com`; any other recipient is refused before sending (queued jobs are marked FAILED with "Not sent: preview deployments only email the test allowlist."). Run a real delivery/recovery test after the key is set. The footer and `/contact` show the contact address (`CONTACT_EMAIL` or kneadedloaves@gmail.com) as plain text (never a `mailto:` link) and the footer Contact button goes to the `/contact` form. The form (`/api/contact`: name, email, message, hidden honeypot, 3-second minimum fill time) always emails the notification TO kneadedloaves@gmail.com with Reply-To set to the visitor, and sends the visitor one warm confirmation FROM noreply@kneadedloaves.com with Reply-To kneadedloaves@gmail.com and a copy of their message (at most one per visitor address per Eastern day, tracked as a hashed key in the existing `RateLimit` table, no migration). `CONTACT_EMAIL` does not route contact-form mail. Per-IP limits: 5 per hour and 20 per day (client IP from `X-Forwarded-For` on Vercel); plus 3 per sender address per 10 minutes. These use a contact-only limiter (`lib/contact-rate-limit.ts`); the shared `rateLimit` in `lib/request.ts` is unchanged. Contact mail is sent only when `CONTACT_LIVE_SEND=true` on a production or preview deployment (previews then email only the allowlist above, so a confirmation to any other visitor is skipped); everywhere else (development, local, or without the flag) the route logs a dry-run line and sends nothing. Removing the variable is the kill switch. In live mode the sender must be a kneadedloaves.com address, otherwise the route returns 503 and sends nothing. There is no public phone number. Pickup is S Portland Ave & Atlantic Ave, Brooklyn, NY 11217. The bakery confirms the exact handoff after payment.
5. Mount persistent storage at `UPLOAD_DIR` (Docker defaults to `/app/uploads`). Back up that volume and preserve existing `public/uploads` files when deploying current photos. New images are decoded and re-encoded as WebP. A shared volume is required if multiple web instances serve uploads.
6. Set `TRUST_PROXY=true` only if the trusted proxy replaces incoming `X-Forwarded-For` with the real client IP. Otherwise limits intentionally share one bucket. Enforce rate limits and body/connection timeouts at the edge too.
7. Set `CRON_SECRET` to a long random value. Vercel Cron sends it as `Authorization: Bearer <CRON_SECRET>` to `/api/cron/email-worker` (17:00 UTC) and `/api/cron/payments-expire` (16:00 UTC). Hobby plans allow a cron expression to run only once per day; a per-minute schedule fails deployment, and invocation can land any time during that hour. Confirmation email does not wait for that schedule.

## Release

Run `npm ci`, `npm run prisma:generate`, `npm run lint`, `npm test`, `npm audit --audit-level=moderate`, and `npm run build` in CI. Do not run development mode publicly.

Back up the database before migration. On Vercel, cron and checkout-time email replace a separate always-on worker. For a non-Vercel release, run `npm run prisma:deploy` from an approved full-install build/release environment after baseline review, then supervise the web process and, if cron is not provided by the host, `npm run email:worker` and `npm run payments:expire`. The worker supports `--once` for a one-pass diagnostic. It records delivery attempts in `/admin/email`; failed messages can be retried there. Email delivery is at-least-once: a crash after provider acceptance can cause a duplicate. Stable message IDs help diagnosis but do not guarantee provider deduplication. Gmail allows about 500 messages per day.

For Docker, prepare an ignored `.env.production` with the values above, then:

```sh
docker compose build web

# Apply approved migrations from the full-install build/release environment, not the slim web image.
docker compose up -d web worker payment-expiry
```

The supplied compose file binds the web port to loopback for a local reverse proxy and expects a separately provisioned database. It does not provision DNS, TLS or a hosted database. Use a release-specific `RELEASE_TAG` and retain previous images for rollback. Docker files are supplied but were not executed on this machine.

Create the real admin using `ADMIN_EMAIL` and `ADMIN_PASSWORD` from a secure shell/secret manager, then run `npm run admin:setup` in the approved full-install release environment. Remove `ADMIN_PASSWORD` after use. Existing default accounts must be removed or have passwords changed. Sample passwords are rejected at production login; sample seeding is blocked in production. Do not run the sample seed on production data.

If importing an older database with plaintext admin-saved secrets, set the encryption key and run `npm run secrets:encrypt` before serving production traffic. The local database has already been migrated to encrypted stored secrets; preserve its existing key if moving that database.

## Health, backup and rollback

- Monitor `/api/health` for HTTP 200; failure returns 503 without database details. Configure external uptime alerts, application error alerts, and alerts for failed/stale email jobs with your hosting provider.
- Run `npm run backup` with PostgreSQL `pg_dump` installed (or set `PG_DUMP_PATH`). The command saves a custom-format dump under ignored `backups/`. Copy backups to access-controlled off-host storage with retention and encryption.
- Prove restore into a **new, empty database** using `pg_restore --no-owner --no-acl --dbname <restore-database> <backup.dump>`; verify record counts, admin sign-in, photos and receipts. Do not restore over the live database as a test.
- Roll back the app to the retained image only while its schema remains compatible. This release adds tables/columns without dropping existing data. A database restore is a separate maintenance operation and can lose writes made after the backup.
- Retain upload backups and the encryption key alongside the restore plan. Never commit credentials or database dumps.

## Final owner checks

- Confirm menu, photos, prices, stock, allergens/ingredients, contact details and pickup/delivery instructions. Create the next ordering window when launch is ready; the existing local schedule has no open window.
- Supply and approve customer policies and any required business notices based on your operation/location; these cannot be accurately invented from source code.
- Connect hosting/domain and Resend email, replace seed credentials, verify mobile ordering once Stripe is completed, and perform a hosted backup/restore rehearsal.
- The Social tab and social drafting were removed (Oct 2026). Legacy social tables and settings rows stay in the database untouched.

## Integration tests

Use a dedicated database named `kneaded_loaves_test`, apply migrations, then start a dev server on port 3001 with that database, `APP_URL=http://127.0.0.1:3001`, `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3001` and an empty `STRIPE_SECRET_KEY`. In another shell with the same database URL, run `npx tsx tests/integration.ts`. The script refuses other database names and clears test data. Never use production credentials for tests.
