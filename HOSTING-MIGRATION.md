# Move Kneaded Loaves to ChatGPT Sites

Owner intent, October 19, 2026: preserve shop items only; start with fresh customer/order records. Keep the source database intact during migration.

## Hosting and domain

Sites supports hosted web apps and custom apex/subdomains where available. Keep the domain registered at IONOS: add it to the verified destination Site and copy the returned DNS and validation records into IONOS. Do not guess A/CNAME targets. Preserve mail MX, SPF, DKIM and DMARC records.

Official guidance: https://learn.chatgpt.com/docs/sites/managing-a-site

## Compatibility work

The installed Sites runtime uses Cloudflare Workers with HTTP external connections and no raw TCP. This app uses Next.js on Node, native Prisma/PostgreSQL, transaction-scoped advisory locks, PostgreSQL arrays and SKIP LOCKED, SMTP sockets and separate Node worker processes. Its Vercel build is not a Sites artifact.

1. Port the existing design/routes to the supported Sites framework (Vinext/Worker), preserving artwork and customer flows.
2. Use a fresh Sites D1 database and R2 for image files, or a supported HTTP backend. Rewrite PostgreSQL-specific reservation, inventory, idempotency and payment transitions with equivalent atomic guarantees; independent reads/writes can oversell.
3. Replace SMTP with an authenticated HTTP email provider and durable delivery/retries. Replace perpetual Node workers with a supported unattended execution arrangement, verifying cadence and failure handling. A chat automation is not proof of a reliable payment worker.
4. Create a fresh admin and secrets. Verify admin authorization and intended public visitor access separately.
5. Import the verified product-only catalog and transfer referenced image files. Preserve cents, categories, ingredients/allergens, stock, visibility, availability dates, image order and alt text.
6. Repeat concurrency, duplicate checkout, authorization, payment-state, expiry, recovery and email tests against the new runtime, then perform a hosted walkthrough.

## Product transfer

Admin > Products > Export shop items returns versioned JSON with products, categories and image references. It excludes accounts, customers, orders, payment evidence, settings and credentials. It does not embed image bytes. Copy repository artwork directly; transfer any uploaded image files separately.

Export from the current shop database to capture owner edits. Repository seed data is not a substitute for the live catalog. Review available inventory before opening new order windows.

## Cutover

Keep checkout disabled until provider delivery, expiry and checkout tests work. Add the exact domain to the destination Site, set its returned DNS records at IONOS, wait for domain/TLS verification, and test the canonical origin. Keep the old deployment available for rollback. No source database deletion or registrar transfer is required.
