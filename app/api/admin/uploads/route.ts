import { getSession } from "@/lib/auth";
import { handleProductImageUpload } from "@/lib/images";
import { rateLimit } from "@/lib/request";
import { productImageStorage } from "@/lib/storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleProductImageUpload(request, {
    getSession,
    canUpload: (input, userId) => rateLimit(input, "admin-product-images", 40, userId),
    saveImage: bytes => productImageStorage.put(bytes)
  });
}
