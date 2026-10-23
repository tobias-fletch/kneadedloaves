import { handleSetupPost } from "@/lib/setup-save";

export function POST(request: Request) {
  return handleSetupPost(request);
}
