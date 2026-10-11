import sharp from "sharp";
export async function sanitizeImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error("Image must be smaller than 5 MB.");
  const image = sharp(bytes, { limitInputPixels: 25000000, animated: false, failOn: "warning" });
  const meta = await image.metadata();
  if (!meta.format || !["jpeg", "png", "webp", "gif"].includes(meta.format)) throw new Error("Upload a JPG, PNG, WebP or GIF image.");
  return image.rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
}
