import { readFile } from "fs/promises";
import path from "path";
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!/^[a-f0-9-]{36}\.webp$/.test(name)) return new Response(null, { status: 404 });
  try {
    const bytes = await readFile(path.join(process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads"), name));
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=31536000, immutable" } });
  } catch { return new Response(null, { status: 404 }); }
}
