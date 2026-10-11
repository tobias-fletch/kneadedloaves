import sharp from "sharp";

// Stay below Netlify's effective binary request limit, leaving room for multipart.
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_UPLOAD_BODY_BYTES = MAX_IMAGE_BYTES + 128 * 1024;
export const MAX_IMAGE_PIXELS = 25_000_000;
const MAX_IMAGE_DIMENSION = 10_000;

export class ImageUploadError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ImageUploadError";
  }
}

// Inspect bytes before passing anything to a decoder. In particular, SVG must
// never reach an SVG/XML renderer, even when its filename or MIME says PNG.
function imageFormat(bytes: Buffer) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "gif";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export async function sanitizeImage(bytes: Buffer) {
  if (!bytes.length) throw new ImageUploadError("Choose a non-empty image.");
  if (bytes.length > MAX_IMAGE_BYTES) throw new ImageUploadError("Image must be 3 MB or smaller.", 413);
  const format = imageFormat(bytes);
  if (!format) throw new ImageUploadError("Upload a JPG, PNG, WebP or GIF image.");
  try {
    const image = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, animated: false, failOn: "warning" });
    const meta = await image.metadata();
    if (meta.format !== format || !meta.width || !meta.height ||
        meta.width > MAX_IMAGE_DIMENSION || meta.height > MAX_IMAGE_DIMENSION ||
        meta.width * meta.height > MAX_IMAGE_PIXELS) {
      throw new ImageUploadError("Image dimensions are too large or invalid.");
    }
    // Sharp strips EXIF, GPS, XMP and other metadata by default. Do not use
    // keepMetadata/withMetadata here. GIF uploads become a still first frame.
    const result = await image.rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 }).toBuffer();
    if (result.length > MAX_IMAGE_BYTES) throw new ImageUploadError("Image is too large after processing.", 413);
    return result;
  } catch (error) {
    if (error instanceof ImageUploadError) throw error;
    throw new ImageUploadError("Image could not be decoded. Choose a valid JPG, PNG, WebP or GIF.");
  }
}

export function isWebpImage(bytes: Buffer) {
  return imageFormat(bytes) === "webp" && bytes.length > 12 && bytes.length <= 5 * 1024 * 1024;
}

export function validateImageUploadOrigin(request: Request, env: NodeJS.ProcessEnv = process.env) {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ImageUploadError("Request origin is not allowed.", 403);
  }
  let expected: string;
  try {
    const configured = env.APP_URL || env.NEXT_PUBLIC_APP_URL;
    if (env.NODE_ENV === "production" && !configured) throw new Error("Missing app URL");
    expected = new URL(configured || request.url).origin;
  } catch {
    throw new ImageUploadError("Image uploads are not configured.", 503);
  }
  if (origin !== expected) throw new ImageUploadError("Request origin is not allowed.", 403);
}

export async function readImageUpload(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) throw new ImageUploadError("Send one image as multipart form data.", 415);
  const declaredSize = request.headers.get("content-length");
  if (declaredSize && (!/^\d+$/.test(declaredSize) || Number(declaredSize) > MAX_UPLOAD_BODY_BYTES)) {
    throw new ImageUploadError("Request is too large.", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ImageUploadError("Choose an image to upload.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_UPLOAD_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw new ImageUploadError("Request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let form: FormData;
  try {
    // Parse only the already bounded bytes; an absent/false Content-Length
    // cannot cause Request.formData() to buffer an unlimited upload.
    form = await new Response(Buffer.concat(chunks), { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new ImageUploadError("Image upload form is invalid.");
  }
  const entries = Array.from(form.entries());
  const file = form.get("file");
  if (entries.length !== 1 || entries[0][0] !== "file" || !file || typeof file === "string") {
    throw new ImageUploadError("Choose exactly one product image.");
  }
  if (file.size > MAX_IMAGE_BYTES) throw new ImageUploadError("Image must be 3 MB or smaller.", 413);
  // Filenames and browser-supplied MIME types are intentionally not trusted.
  return sanitizeImage(Buffer.from(await file.arrayBuffer()));
}

type UploadSession = { sub: string; role: string } | null;
type UploadDependencies = {
  getSession: () => Promise<UploadSession>;
  canUpload: (request: Request, userId: string) => Promise<boolean>;
  saveImage: (bytes: Buffer) => Promise<string>;
  env?: NodeJS.ProcessEnv;
};

export async function handleProductImageUpload(request: Request, dependencies: UploadDependencies) {
  try {
    const session = await dependencies.getSession();
    if (!session) return Response.json({ error: "Sign in to upload product images." }, { status: 401 });
    if (session.role !== "ADMIN") return Response.json({ error: "Administrator access is required." }, { status: 403 });
    validateImageUploadOrigin(request, dependencies.env);
    if (!await dependencies.canUpload(request, session.sub)) {
      return Response.json({ error: "Too many image uploads. Try again later." }, { status: 429 });
    }
    const bytes = await readImageUpload(request);
    const url = await dependencies.saveImage(bytes);
    return Response.json({ url }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ImageUploadError) return Response.json({ error: error.message }, { status: error.status });
    // Do not expose provider responses, local paths, or credentials to clients.
    console.error("Product image upload failed.");
    return Response.json({ error: "Image could not be saved. Please try again." }, { status: 503 });
  }
}
