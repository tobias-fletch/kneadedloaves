import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStore } from "@netlify/blobs";
import { isWebpImage } from "./images";

const IMAGE_NAME = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$/;
export const PRODUCT_IMAGE_STORE = "product-images";
export const isProductImageName = (name: string) => IMAGE_NAME.test(name);

export function productImageStoreName(env: NodeJS.ProcessEnv = process.env) {
  const base = env.NETLIFY_BLOBS_STORE || PRODUCT_IMAGE_STORE;
  // Site-wide stores survive deploys and are otherwise shared by previews.
  // Never let preview uploads write into the production image namespace.
  // Next's config bakes this nonsecret value from Netlify's build CONTEXT;
  // CONTEXT itself is not guaranteed to exist in a Function at runtime.
  const context = process.env.BAKERY_DEPLOY_CONTEXT || env.CONTEXT;
  const name = context && context !== "production" ? `${base}-preview` : base;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) throw new Error("Product image store name is invalid.");
  return name;
}

// Only sanitized, public catalog images belong here. Do not reuse this store
// or public media route for order attachments, customer files, or secrets.
export interface ProductImageBlobStore {
  get(key: string, options: { type: "arrayBuffer"; consistency: "strong" }): Promise<ArrayBuffer | null>;
  set(key: string, value: ArrayBuffer, options: { onlyIfNew: true; metadata: { contentType: string } }): Promise<{ modified: boolean }>;
}

type StorageOptions = { env?: NodeJS.ProcessEnv; blobStore?: ProductImageBlobStore };

export function createProductImageStorage({ env = process.env, blobStore }: StorageOptions = {}) {
  function provider() {
    const selected = env.IMAGE_STORAGE_PROVIDER || (env.NODE_ENV === "production" ? "netlify-blobs" : "local");
    if (!["local", "netlify-blobs"].includes(selected)) throw new Error("Image storage provider is invalid.");
    if (selected === "local" && env.NODE_ENV === "production") {
      throw new Error("Production product images require durable object storage.");
    }
    return selected;
  }
  function store(): ProductImageBlobStore {
    const name = productImageStoreName(env);
    // Called inside a request, never at import/build time. Netlify supplies the
    // site's runtime credentials; no personal access token belongs in app env.
    return blobStore || getStore({ name, consistency: "strong" });
  }
  function localDirectory() {
    return path.resolve(env.UPLOAD_DIR || path.join(process.cwd(), "uploads"));
  }
  return {
    async put(bytes: Buffer, name = `${randomUUID()}.webp`) {
      if (!isProductImageName(name) || !isWebpImage(bytes)) throw new Error("Invalid product image.");
      if (provider() === "netlify-blobs") {
        const { modified } = await store().set(name, new Uint8Array(bytes).buffer, {
          onlyIfNew: true,
          metadata: { contentType: "image/webp" }
        });
        if (!modified) throw new Error("Product image already exists; refusing to overwrite.");
      } else {
        await mkdir(localDirectory(), { recursive: true });
        await writeFile(path.join(localDirectory(), name), bytes, { flag: "wx", mode: 0o600 });
      }
      return `/api/media/${name}`;
    },
    async get(name: string) {
      if (!isProductImageName(name)) return null;
      let bytes: Buffer | null = null;
      if (provider() === "netlify-blobs") {
        const value = await store().get(name, { type: "arrayBuffer", consistency: "strong" });
        if (value) bytes = Buffer.from(value);
      } else {
        // Preserve locally stored UUID.webp photos, including the older public
        // upload folder, until the approved migration copies them to Blobs.
        const locations = [localDirectory(), path.join(process.cwd(), "public", "uploads")];
        for (const directory of locations) {
          try { bytes = await readFile(path.join(directory, name)); break; }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        }
      }
      return bytes && isWebpImage(bytes) ? bytes : null;
    }
  };
}

export const productImageStorage = createProductImageStorage();
