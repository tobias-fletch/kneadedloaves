# Kneaded Loaves deployment

The shop runs on Vercel with Node 24. Checkout is not hard-disabled in code. It accepts orders only when the order window is open and every gate in VENMO-OPERATIONS.md passes. Vercel environment variables override Admin > Setup. Email and payment expiry run in the Vercel deployment: checkout sends that order's email immediately, and `vercel.json` schedules daily Hobby-safe cron as the backstop. `CRON_SECRET` must be set or the cron routes reject every caller.

Production build migration handling is guarded and uses DATABASE_URL only. The existing live schema needs separately approved baseline reconciliation; do not deploy blindly, reset data, or substitute another integration URL. Preview builds never migrate.

The production guard accepts a nonempty, checksum-matching contiguous prefix of the repository migrations, including a separately approved initial-only baseline. Completed records must be in migration order. It rejects empty/unbaselined history, gaps, out-of-order records, unknown or unresolved failed migrations, checksum drift, and recognizable schema effects whose migration is not recorded. Required table/column checks follow the recorded prefix: AppConfig is required after its migration, hardening fields/tables after hardening, and manual-payment fields/PaymentEvent after the final migration. These presence checks are not a complete type/index/constraint comparison.

After the read-only preflight succeeds, normal Prisma migration deployment executes every remaining migration, followed by a read-only completion check before client generation and the Next.js build. The helper never inserts or resolves baseline/history records itself. An initial-only baseline therefore runs migrations 2–4 and the new manual-payment migration; do not mark those pending migrations applied without executing them.

## Required services and settings

The production domain is `kneadedloaves.com`. Copy `.env.production.example` to the ignored `.env.production` on the host and supply the missing secrets and provider settings. The Docker build passes the public URL at build time, because Next.js embeds public environment variables in the browser bundle. Rebuild the image if the domain changes.

The following infrastructure checklist is generic operator guidance, not a request to change the existing host or DNS. Leave `VENMO_CHECKOUT_ENABLED` false until SMTP, cron, and a non-production smoke test are done. Provider payment readiness is a separate launch decision.

1. Provision PostgreSQL with authenticated TLS access and automated backups. Set `DATABASE_URL` in the host secret manager. Do not expose the local development cluster publicly.
2. Set `APP_URL` and `NEXT_PUBLIC_APP_URL` to the same HTTPS domain. Configure DNS, TLS termination, upstream timeouts, a 6 MB request limit and error-log retention at your reverse proxy/host.
3. Set a random `JWT_SECRET` of at least 32 characters and a separate `CONFIG_ENCRYPTION_KEY` of exactly 64 random hexadecimal characters. Store and back up the encryption key separately from database backups. Environment values take precedence over admin-saved values.
4. Set SMTP host, TLS port (465, 587 or 2525), username, password and sender. Gmail is `smtp.gmail.com` with a Google app password: port 465 uses implicit SSL and port 587 uses STARTTLS. `EMAIL_FROM` may be `Kneaded Loaves <kneadedloaves@gmail.com>`, and Gmail requires that address to match `SMTP_USER`. Gmail allows about 500 messages per day. Verify the sender and configure SPF/DKIM/DMARC. Run a real delivery/recovery test after credentials are supplied. No outgoing mail was sent during development verification. Public contact email defaults to kneadedloaves@gmail.com. There is no public phone number. Pickup is S Portland Ave & Atlantic Ave, Brooklyn, NY 11217. The bakery confirms the exact handoff after payment.
5. Mount persistent storage at `UPLOAD_DIR` (Docker defaults to `/app/uploads`). Back up that volume and preserve existing `public/uploads` files when deploying current photos. New images are decoded and re-encoded as WebP. A shared volume is required if multiple web instances serve uploads.
6. Set `TRUST_PROXY=true` only if the trusted proxy replaces incoming `X-Forwarded-For` with the real client IP. Otherwise limits intentionally share one bucket. Enforce rate limits and body/connection timeouts at the edge too.
7. Set `CRON_SECRET` to a long random value. Vercel Cron sends it as `Authorization: Bearer <CRON_SECRET>` to `/api/cron/email-worker` (17:00 UTC) and `/api/cron/payments-expire` (16:00 UTC). Hobby plans allow a cron expression to run only once per day; a per-minute schedule fails deployment, and invocation can land any time during that hour. Confirmation email does not wait for that schedule.

## Release

Run `npm ci`, `npm run prisma:generate`, `npm run lint`, `npm test`, `npm audit --audit-level=moderate`, and `npm run build` in CI. Do not run development mode publicly.

Back up the database before migration. On Vercel, cron and checkout-time email replace a separate always-on worker. For a non-Vercel release, run `npm run prisma:deploy` from an approved full-install build/release environment after baseline review, then supervise the web process and, if cron is not provided by the host, `npm run email:worker` and `npm run payments:expire`. The worker supports `--once` for a one-pass diagnostic. It records delivery attempts in `/admin/email`; failed messages can be retried there. SMTP is at-least-once: a crash after provider acceptance can cause a duplicate. Stable message IDs help diagnosis but do not guarantee provider deduplication. Gmail allows about 500 messages per day.

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
- Connect hosting/domain and SMTP, replace seed credentials, verify mobile ordering once Stripe is completed, and perform a hosted backup/restore rehearsal.
- Social drafting remains available. Automatic publication needs each platform's accounts, app permissions and API integration; credentials alone do not enable it. Until then, publish approved copy manually. No social messages were published.

## Integration tests

Use a dedicated database named `kneaded_loaves_test`, apply migrations, then start a dev server on port 3001 with that database, `APP_URL=http://127.0.0.1:3001`, `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3001` and an empty `STRIPE_SECRET_KEY`. In another shell with the same database URL, run `npx tsx tests/integration.ts`. The script refuses other database names and clears test data. Never use production credentials for tests.
