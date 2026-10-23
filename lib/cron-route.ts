import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";

export async function handleCron(request: Request, work: () => Promise<Record<string, unknown>>) {
  if (!isCronAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await work()) });
  } catch {
    console.error("Cron worker failed.");
    return NextResponse.json({ error: "Cron worker failed." }, { status: 500 });
  }
}
