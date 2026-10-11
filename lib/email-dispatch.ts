import { after } from "next/server";
import { processEmailQueue } from "@/lib/email-queue";

/** Durable jobs are committed first; hosting keeps this bounded task alive after response. */
export function dispatchQueuedEmail() {
  after(async () => {
    try {
      for (let index = 0; index < 2; index++) if (!await processEmailQueue()) break;
    } catch { console.error("Queued email awaits retry."); }
  });
}
