# Production readiness — September 14, 2026

## Completed in this pass

- Updated dependencies to patched releases, including Next.js 15.5.25. NPM audit reports zero vulnerabilities. Targeted dependency overrides cover PostCSS and deepmerge-ts; recheck on future upgrades.
- Fixed guest cart isolation, integer quantity validation, concurrent cart changes, delivery ZIP checks and product date eligibility.
- Serialized order-window capacity checks inside the order transaction. Cancellation restores inventory once and status changes follow an explicit transition table. Payment-related transitions are reserved for the deferred payment integration.
- Added customer registration, password change/recovery, single-use expiring reset tokens and database-validated sessions that are revoked on password change or logout. Removed displayed demo credentials and reject seed passwords in production.
- Added cross-origin mutation protection, bounded request bodies, database-backed rate limiting, security headers and sanitized image uploads. New uploaded images require persistent storage.
- Encrypted saved credentials with authenticated AES-GCM. Migrated existing local stored secrets and saved the encryption key in the ignored local .env.
- Added private guest receipts and a durable email queue with retries and admin failure visibility. Pending acknowledgements explicitly state payment is unconfirmed. The SMTP worker supports multiple processes with locked claims; SMTP delivery is at-least-once.
- Added health checks, error pages, noninteractive lint, unit and integration checks, CI, a Docker deployment template, admin provisioning, backups and deployment/rollback instructions.
- Preserved the existing shop's product, order and stock data. Tests use the separate kneaded_loaves_test database.

## Verification

- Production build and TypeScript checks passed.
- ESLint passed without warnings; seven unit/security tests passed.
- HTTP/database integration tests cover guest isolation, malformed quantities, cross-site requests, concurrent capacity, transactional email creation, receipt privacy, repeated cancellation, registration/login, admin access, session revocation, reset replay, body size, rate limits and email failure retries.
- The new registration screen was visually inspected in the browser.
- Created an ignored local database backup and restored it into kneaded_loaves_restore_test: two products, two orders and four migrations restored. This verifies a local restore, not hosted disaster recovery.

## Still requires owner/provider setup

1. **Stripe — deliberately deferred:** verified payment lifecycle, webhooks, failures/expiry, refunds and recovery. Production checkout remains paused.
2. **Hosting/domain:** supply or select a host, provision production PostgreSQL, DNS/TLS, persistent uploads, the email worker, monitoring and off-host backups. Docker deployment files have not been executed here.
3. **Email:** supply SMTP credentials and a verified sender/domain, configure provider DNS records, then test real inbox delivery and password recovery. No email was sent during tests.
4. **Real admin and business details:** set a unique admin password and strong production secrets; review menu/photos, allergens, stock, fulfillment details and customer policies. Schedule a real order window when ready.
5. **Automatic social posting:** still needs platform accounts, app permissions and API adapters; existing drafting/review remains usable manually. No posts were published. This is not complete merely because credentials are present.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for exact setup and verification steps. No public deployment, real payment or external message was performed.
