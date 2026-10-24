import { handleContactPost } from "@/lib/contact-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return handleContactPost(request);
}
