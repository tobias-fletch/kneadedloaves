# Kneaded Loaves deployment

The app is prepared for a Node 22 host or Docker with a separate email worker. It has not been deployed. Stripe integration is deferred and production checkout intentionally returns a maintenance response until that work is complete.

## Required services and settings

The production domain is `kneadedloaves.com`. Copy `.env.production.example` to the ignored `.env.production` on the host and supply the missing secrets and provider settings. The Docker build passes the public URL at build time, because Next.js embeds public environment variables in the browser bundle. Rebuild the image if the domain changes.

The next handoff requires the hosting provider and access to domain DNS. After the host is provisioned, point the apex domain at the host's supplied target, configure HTTPS, and redirect `www.kneadedloaves.com` to `https://kneadedloaves.com`. Obtain the exact DNS records from the selected host. Deploy initially with checkout paused; payment completion remains a separate launch requirement.

1. Provision PostgreSQL with authenticated TLS access and automated backups. Set `DATABASE_URL` in the host secret manager. Do not expose the local development cluster publicly.
2. Set `APP_URL` and `NEXT_PUBLIC_APP_URL` to the same HTTPS domain. Configure DNS, TLS termination, upstream timeouts, a 6 MB request limit and error-log retention at your reverse proxy/host.
3. Set a random `JWT_SECRET` of at least 32 characters and a separate `CONFIG_ENCRYPTION_KEY` of exactly 64 random hexadecimal characters. Store and back up the encryption key separately from database backups. Environment values take precedence over admin-saved values.
4. Set SMTP host, TLS port (465, 587 or 2525), username, password and sender. Verify the sender with your provider and configure its SPF/DKIM/DMARC records. Run a real delivery/recovery test after credentials are supplied. No outgoing mail was sent during development verification.
5. Mount persistent storage at `UPLOAD_DIR` (Docker defaults to `/app/uploads`). Back up that volume and preserve existing `public/uploads` files when deploying current photos. New images are decoded and re-encoded as WebP. A shared volume is required if multiple web instances serve uploads.
6. Set `TRUST_PROXY=true` only if the trusted proxy replaces incoming `X-Forwarded-For` with the real client IP. Otherwise limits intentionally share one bucket. Enforce rate limits and body/connection timeouts at the edge too.

## Release

Run `npm ci`, `npm run prisma:generate`, `npm run lint`, `npm test`, `npm audit --audit-level=moderate`, and `npm run build` in CI. Do not run development mode publicly.

Back up the database before migration. Run `npm run prisma:deploy` once per release, then `npm start` and `npm run email:worker` as separately supervised services. The worker supports `--once` for a one-pass diagnostic. It records delivery attempts in `/admin/email`; failed messages can be retried there. SMTP is at-least-once: a crash after provider acceptance can cause a duplicate. Stable message IDs help diagnosis but do not guarantee provider deduplication.

For Docker, prepare an ignored `.env.production` with the values above, then:

```sh
docker compose build web
docker compose run --rm web npm run prisma:deploy
docker compose up -d web worker
```

The supplied compose file binds the web port to loopback for a local reverse proxy and expects a separately provisioned database. It does not provision DNS, TLS or a hosted database. Use a release-specific `RELEASE_TAG` and retain previous images for rollback. Docker files are supplied but were not executed on this machine.

Create the real admin using `ADMIN_EMAIL` and `ADMIN_PASSWORD` from a secure shell/secret manager, then `npm run admin:setup`. Remove `ADMIN_PASSWORD` after use. Existing default accounts must be removed or have passwords changed. Sample passwords are rejected at production login; sample seeding is blocked in production. Do not run the sample seed on production data.

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
