# Product photo storage

## Production contract

- Production uploads use a site-wide Netlify Blobs store, `product-images` by default. This is deliberately `getStore`, not a deploy-specific store. Objects remain available after deployments and rollbacks. A source rollback does not roll back image data.
- `IMAGE_STORAGE_PROVIDER=netlify-blobs` is the production setting and production default. `local` is allowed only in development/test; production fails closed rather than writing an ephemeral uploads directory.
- The Netlify Functions runtime supplies the Blobs site/token context. Do not put a personal access token in this app's environment or frontend. The SDK is created during a request, not during a build. Node must satisfy the pinned SDK's engine requirement (22.12.0 or later).
- `NETLIFY_BLOBS_STORE` optionally changes the base store name. Keep it stable between production deploys. Changing this value does not migrate existing photos. The app uses Netlify's default Blobs region; do not migrate objects into a different region without also deliberately updating every SDK read/write.
- The Next.js build records Netlify’s build-time `CONTEXT` in the nonsecret `BAKERY_DEPLOY_CONTEXT` constant; it does not rely on `CONTEXT` being available in Functions at runtime. Netlify contexts other than `production` automatically append `-preview` to that base name. Thus `product-images` becomes `product-images-preview`. This keeps preview/branch uploads out of the production namespace. Preview stores remain site-wide and persistent. Keep preview databases and credentials isolated too; do not write preview image URLs into the live catalog. A local Netlify emulator is not evidence of production persistence.
- `APP_URL` must be the canonical origin used to access the admin UI; preview deployments need their own correctly scoped value. Uploads require a valid admin session and matching Origin, including outside middleware. The endpoint rate-limits uploads per admin account.

## Accepted images and responses

`POST /api/admin/uploads` accepts exactly one multipart file field named `file`, for public product photos only. It does not fetch URLs or accept arbitrary customer documents.

The limit is 3 MiB per input photo with a bounded multipart body of 3 MiB + 128 KiB. This leaves room below Netlify's effective binary request limit (approximately 4.5 MB after encoding). The admin UI should reject oversized files before sending them so the host's own limit does not produce a generic error.

Actual bytes must decode as JPEG, PNG, WebP or GIF. SVG/XML and other formats are rejected before decoding, irrespective of filename/MIME. Inputs may contain no more than 25 million pixels or 10,000 pixels on either axis. Images are oriented, resized inside 2,400 × 2,400 pixels, and re-encoded as WebP without EXIF/GPS/XMP metadata. GIFs become still first frames.

The result is `{ "url": "/api/media/<opaque UUID>.webp" }` with HTTP 201. The original filename is never used as a path. New writes are conditional and cannot overwrite an existing key. Save the returned URL in the product record as usual. An uploaded but unsaved product photo can remain an unreferenced object; there is intentionally no automatic deletion that might erase a shared historical image.

Public `GET /api/media/<UUID>.webp` reads only canonical image keys from this dedicated store. It returns WebP content, nosniff, immutable caching and an ETag. Missing/invalid keys return uncached 404; provider failures return uncached 503 so a transient storage outage is not cached as a missing photo. Do not put private files or secrets in this store. Public images may remain in browser caches even after a record stops referring to them.

## Preserve existing photos before cutover

No actual photos are in the source repository. These steps require a separately approved transfer of the existing public bakery photos to the selected Netlify site. Do not seed/reset the old database, delete originals, or assume that changing the storage setting moves files.

1. Back up the old database and both possible image directories (`UPLOAD_DIR`, normally `uploads`, and older `public/uploads`). Preserve the originals untouched. Keep backups outside the public repository and deployment artifact.
2. Inventory all referenced `ProductImage.url` values and any image paths used by appearance/settings. Record old URL, intended product or setting, source filename, byte count and a SHA-256 digest. Work only from the known photo directories; reject symlinks, traversal names and missing files rather than following or guessing them. Do not include customer records, secrets, `.env` files, unrelated files or arbitrary remote downloads.
3. Rehearse against an isolated preview site/store and copied catalog first. There are two safe migration paths:
   - **Keep an existing UUID WebP URL:** verify the file is a real, sanitized WebP and that its filename passes `isProductImageName`. Re-encode a separate staging copy using `sanitizeImage` if needed; never modify the source. Copy that reviewed image to the correct site-wide store under exactly the same UUID `.webp` key. Use an authorized operator's Netlify tooling or a reviewed one-time migration that calls `createProductImageStorage().put(bytes, originalName)` with runtime context. The helper refuses collisions; on a pre-existing key, compare digests and skip only if identical. Never overwrite a different image under an immutable URL.
   - **Other old formats/names:** upload the reviewed photo through the authenticated admin endpoint and record the returned new URL. Review the old-to-new URL mapping, then update only the intended product/settings references in the destination database. Do not loosen the public route's safe-key validation to accept arbitrary legacy paths.
4. Existing `/api/media/<UUID>.webp` URLs keep working once their matching keys are copied. The legacy `/uploads/<UUID>.webp` fallback rewrite serves the same key from `/api/media/`, preserving older same-name paths without committing image files to source. Files with other names/extensions need the explicit mapping from step 3.
5. Verify every referenced photo by making a same-origin request and visually checking the product/settings page. Compare counts and file digests for unchanged copies; for re-encoded copies retain both source and destination digests. Check missing-file cases explicitly. Confirm the product still displays after an authorized second deployment, not just after a page refresh.
6. Keep the originals and a photo manifest until restore has been rehearsed. Database backups alone do not contain image bytes. Preserve a separate backup/export of the referenced Blobs objects. Do not remove files merely because one current product no longer references them; check appearance, other products and historical needs first.

The official Netlify CLI supports `blobs:list`, `blobs:get --output`, and `blobs:set --input` for authorized operators. Unlike the app's immutable helper, generic CLI writes can overwrite keys: check the destination first and stop on any mismatch. Use an authenticated official CLI session; never paste tokens into chat, source, command arguments, migration manifests or logs. Do not enable `--force` to bypass a collision warning. No CLI transfer, provider provisioning or deployment has been performed by this implementation.

## Local development and verification

Development/test defaults to local storage in `UPLOAD_DIR` (or `./uploads`), retaining reads from the older `public/uploads` folder. Do not use a production database for image tests. Local writes are exclusive and cannot overwrite an existing filename.

Focused automated checks: `node --import tsx --test tests/images.test.ts`.

Before launch, verify the actual Netlify runtime can upload as an admin, rejects a customer/unauthenticated/cross-origin upload, serves the photo from the same origin with correct headers, isolates preview storage, and preserves a production image through a new deployment. Unit tests use a fake Blobs store and local filesystem; they do not prove remote provider configuration, free-tier capacity, persistence or disaster recovery.

## Official references

- [Netlify Blobs API, site-wide stores, conditional writes and consistency](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- [Netlify Functions binary payload limits](https://docs.netlify.com/build/functions/configuration/)
- [Netlify CLI Blobs commands](https://cli.netlify.com/commands/blobs/)
