import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { handleProductImageUpload, MAX_IMAGE_BYTES, MAX_UPLOAD_BODY_BYTES, readImageUpload, sanitizeImage, validateImageUploadOrigin } from "../lib/images";
import { createProductImageStorage, isProductImageName, productImageStoreName, type ProductImageBlobStore } from "../lib/storage";
import { GET as getMedia } from "../app/api/media/[name]/route";

const origin = "https://bakery.example";
const name = "2a06be9e-5d7f-4dcd-9863-fc3947a3e5bf.webp";
const env = { NODE_ENV: "production", APP_URL: origin } as NodeJS.ProcessEnv;
const makePng = () => sharp({ create: { width: 12, height: 10, channels: 3, background: "red" } }).png().toBuffer();

function requestFor(bytes: Buffer, overrides: { filename?: string; mime?: string; origin?: string } = {}) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: overrides.mime || "image/png" }), overrides.filename || "bread.png");
  return new Request(`${origin}/api/admin/uploads`, { method: "POST", body: form, headers: { origin: overrides.origin || origin } });
}

function memoryStore() {
  const values = new Map<string, ArrayBuffer>();
  const calls: string[] = [];
  const store: ProductImageBlobStore = {
    async get(key, options) {
      assert.equal(options.type, "arrayBuffer");
      assert.equal(options.consistency, "strong");
      calls.push(`get:${key}`);
      return values.get(key) || null;
    },
    async set(key, value, options) {
      assert.equal(options.onlyIfNew, true);
      assert.deepEqual(options.metadata, { contentType: "image/webp" });
      calls.push(`set:${key}`);
      if (values.has(key)) return { modified: false };
      values.set(key, value);
      return { modified: true };
    }
  };
  return { values, calls, store };
}

test("product photos are decoded from bytes, resized, oriented and stripped of metadata", async () => {
  const jpeg = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: "red" } })
    .withMetadata({ orientation: 6 }).withExif({ IFD0: { Copyright: "Private metadata" } }).jpeg().toBuffer();
  const bytes = await sanitizeImage(jpeg);
  const meta = await sharp(bytes).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 800);
  assert.equal(meta.height, 2400);
  assert.equal(meta.exif, undefined);
  assert.equal(meta.xmp, undefined);
  assert.equal(meta.icc, undefined);
  const uploaded = await readImageUpload(requestFor(await makePng(), { filename: "../../private.svg", mime: "text/plain" }));
  assert.equal((await sharp(uploaded).metadata()).format, "webp");
});

test("SVG, HTML, malformed images, oversized bytes and excessive dimensions are rejected", async () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    Buffer.from("<html>private</html>"), Buffer.from([0xff, 0xd8, 0xff, 0x01]), Buffer.alloc(MAX_IMAGE_BYTES + 1)]) {
    await assert.rejects(sanitizeImage(bytes));
  }
  const tooWide = await sharp({ create: { width: 10_001, height: 1, channels: 3, background: "red" } }).png().toBuffer();
  await assert.rejects(sanitizeImage(tooWide), /dimensions/);
  const tooManyPixels = await sharp({ create: { width: 5001, height: 5000, channels: 3, background: "red" } }).png().toBuffer();
  await assert.rejects(sanitizeImage(tooManyPixels));
});

test("upload CSRF checks fail closed independently of middleware", () => {
  const req = (headers: HeadersInit = {}) => new Request(`${origin}/api/admin/uploads`, { method: "POST", headers });
  assert.doesNotThrow(() => validateImageUploadOrigin(req({ origin }), env));
  for (const headers of [{}, { origin: "https://evil.example" }, { origin: "null" }, { origin, "sec-fetch-site": "cross-site" }] as HeadersInit[]) {
    assert.throws(() => validateImageUploadOrigin(req(headers), env), /origin/);
  }
  assert.throws(() => validateImageUploadOrigin(req({ origin }), { NODE_ENV: "production" }), /not configured/);
});

test("multipart body is bounded even with absent or dishonest Content-Length", async () => {
  const boundary = "test-boundary";
  for (const contentLength of [undefined, "1", String(MAX_UPLOAD_BODY_BYTES + 1)]) {
    const headers = new Headers({ "content-type": `multipart/form-data; boundary=${boundary}` });
    if (contentLength) headers.set("content-length", contentLength);
    const request = new Request(`${origin}/api/admin/uploads`, {
      method: "POST", headers, body: Buffer.alloc(MAX_UPLOAD_BODY_BYTES + 1)
    });
    await assert.rejects(readImageUpload(request), error => (error as { status: number }).status === 413);
  }
});

test("upload accepts exactly one file and rejects URL input, extra fields and malformed forms", async () => {
  const png = await makePng();
  const forms = [new FormData(), new FormData(), new FormData(), new FormData()];
  forms[0].append("url", "https://internal.example/secret");
  forms[1].append("file", "https://internal.example/secret");
  forms[2].append("file", new Blob([new Uint8Array(png)]), "first.png");
  forms[2].append("file", new Blob([new Uint8Array(png)]), "second.png");
  forms[3].append("file", new Blob([new Uint8Array(png)]), "first.png");
  forms[3].append("destination", "../private");
  for (const body of forms) await assert.rejects(readImageUpload(new Request(origin, { method: "POST", body })));
  await assert.rejects(readImageUpload(new Request(origin, { method: "POST", body: "{}", headers: { "content-type": "application/json" } })));
  await assert.rejects(readImageUpload(new Request(origin, { method: "POST", body: "broken", headers: { "content-type": "multipart/form-data; boundary=test" } })));
});

test("upload authorization and rate limit run before any write", async () => {
  let writes = 0;
  const common = { env, canUpload: async () => true, saveImage: async () => { writes++; return `/api/media/${name}`; } };
  const png = await makePng();
  for (const [session, status] of [[null, 401], [{ sub: "customer", role: "CUSTOMER" }, 403]] as const) {
    const response = await handleProductImageUpload(requestFor(png), { ...common, getSession: async () => session });
    assert.equal(response.status, status);
  }
  const admin = { ...common, getSession: async () => ({ sub: "admin", role: "ADMIN" }) };
  assert.equal((await handleProductImageUpload(requestFor(png, { origin: "https://evil.example" }), admin)).status, 403);
  assert.equal((await handleProductImageUpload(requestFor(png), { ...admin, canUpload: async () => false })).status, 429);
  assert.equal(writes, 0);
  const success = await handleProductImageUpload(requestFor(png), admin);
  assert.equal(success.status, 201);
  assert.deepEqual(await success.json(), { url: `/api/media/${name}` });
  assert.equal(writes, 1);
});

test("provider failures are retryable and never expose sensitive error detail", async () => {
  const response = await handleProductImageUpload(requestFor(await makePng()), {
    env, getSession: async () => ({ sub: "admin", role: "ADMIN" }), canUpload: async () => true,
    saveImage: async () => { throw new Error("provider response with private-token and /local/path"); }
  });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private-token|local\/path/);
});

test("only opaque canonical WebP keys can reach storage", async () => {
  const { store, calls } = memoryStore();
  const storage = createProductImageStorage({ env, blobStore: store });
  const bytes = await sanitizeImage(await makePng());
  for (const invalid of ["../secret", `../${name}`, `%2e%2e%2f${name}`, "private.svg", name.toUpperCase(), name.replace(/-/g, ""), "-".repeat(36) + ".webp"]) {
    assert.equal(isProductImageName(invalid), false);
    assert.equal(await storage.get(invalid), null);
    await assert.rejects(storage.put(bytes, invalid));
  }
  assert.deepEqual(calls, []);
});

test("production images persist across storage instances with conditional immutable writes", async () => {
  const { store } = memoryStore();
  const bytes = await sanitizeImage(await makePng());
  const storage = createProductImageStorage({ env, blobStore: store });
  assert.equal(await storage.put(bytes, name), `/api/media/${name}`);
  const afterRedeploy = createProductImageStorage({ env, blobStore: store });
  assert.deepEqual(await afterRedeploy.get(name), bytes);
  await assert.rejects(afterRedeploy.put(bytes, name), /overwrite/);
  assert.equal(await afterRedeploy.get("3a06be9e-5d7f-4dcd-9863-fc3947a3e5bf.webp"), null);
});

test("production cannot silently fall back to filesystem uploads", async () => {
  const bytes = await sanitizeImage(await makePng());
  const localProduction = createProductImageStorage({ env: { NODE_ENV: "production", IMAGE_STORAGE_PROVIDER: "local", UPLOAD_DIR: "/must-not-be-written" } });
  await assert.rejects(localProduction.put(bytes), /durable object storage/);
  await assert.rejects(localProduction.get(name), /durable object storage/);
});

test("development preserves local media paths without overwriting files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bakery-images-"));
  try {
    const storage = createProductImageStorage({ env: { NODE_ENV: "test", UPLOAD_DIR: directory } });
    const bytes = await sanitizeImage(await makePng());
    assert.equal(await storage.put(bytes, name), `/api/media/${name}`);
    assert.deepEqual(await storage.get(name), bytes);
    assert.deepEqual(await readFile(path.join(directory, name)), bytes);
    await assert.rejects(storage.put(bytes, name), /EEXIST/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("media route preserves safe headers, ETags and noncached missing responses", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bakery-media-"));
  const previous = { UPLOAD_DIR: process.env.UPLOAD_DIR, IMAGE_STORAGE_PROVIDER: process.env.IMAGE_STORAGE_PROVIDER };
  process.env.UPLOAD_DIR = directory;
  process.env.IMAGE_STORAGE_PROVIDER = "local";
  try {
    const storage = createProductImageStorage();
    const bytes = await sanitizeImage(await makePng());
    await storage.put(bytes, name);
    const response = await getMedia(new Request(`${origin}/api/media/${name}`), { params: Promise.resolve({ name }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/webp");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("cache-control") || "", /immutable/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    const cached = await getMedia(new Request(`${origin}/api/media/${name}`, { headers: { "if-none-match": response.headers.get("etag")! } }), { params: Promise.resolve({ name }) });
    assert.equal(cached.status, 304);
    const invalid = await getMedia(new Request(origin), { params: Promise.resolve({ name: "../secret" }) });
    assert.equal(invalid.status, 404);
    assert.equal(invalid.headers.get("cache-control"), "no-store");
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(directory, { recursive: true, force: true });
  }
});


test("Netlify preview and branch contexts never share the production image namespace", () => {
  assert.equal(productImageStoreName({ NODE_ENV: "production", CONTEXT: "production" }), "product-images");
  assert.equal(productImageStoreName({ NODE_ENV: "production", CONTEXT: "deploy-preview" }), "product-images-preview");
  assert.equal(productImageStoreName({ NODE_ENV: "production", CONTEXT: "branch-deploy", NETLIFY_BLOBS_STORE: "bakery-images" }), "bakery-images-preview");
  assert.throws(() => productImageStoreName({ NODE_ENV: "production", NETLIFY_BLOBS_STORE: "../private" }));
});


test("GIF and WebP are accepted by their decoded format and exported as still WebP", async () => {
  for (const input of [await sharp(await makePng()).gif().toBuffer(), await sharp(await makePng()).webp().toBuffer()]) {
    const result = await sanitizeImage(input);
    const metadata = await sharp(result).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.pages, undefined);
  }
});


test("Netlify upload limits leave conservative space for multipart and platform encoding", async () => {
  assert.equal(MAX_IMAGE_BYTES, 3 * 1024 * 1024);
  assert.equal(MAX_UPLOAD_BODY_BYTES, MAX_IMAGE_BYTES + 128 * 1024);
  await assert.rejects(readImageUpload(requestFor(Buffer.alloc(MAX_IMAGE_BYTES + 1))), error =>
    (error as { status: number; message: string }).status === 413 && /3 MB/.test((error as Error).message));
});

test("preview isolation uses the baked deploy context when runtime CONTEXT is absent", () => {
  const previous = process.env.BAKERY_DEPLOY_CONTEXT;
  process.env.BAKERY_DEPLOY_CONTEXT = "deploy-preview";
  try {
    assert.equal(productImageStoreName({ NODE_ENV: "production" }), "product-images-preview");
  } finally {
    if (previous === undefined) delete process.env.BAKERY_DEPLOY_CONTEXT;
    else process.env.BAKERY_DEPLOY_CONTEXT = previous;
  }
});

test("media storage outages remain retryable and cannot become cached 404s", async () => {
  const previous = process.env.IMAGE_STORAGE_PROVIDER;
  process.env.IMAGE_STORAGE_PROVIDER = "unconfigured-provider";
  try {
    const response = await getMedia(new Request(`${origin}/api/media/${name}`), { params: Promise.resolve({ name }) });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("retry-after"), "30");
  } finally {
    if (previous === undefined) delete process.env.IMAGE_STORAGE_PROVIDER;
    else process.env.IMAGE_STORAGE_PROVIDER = previous;
  }
});
