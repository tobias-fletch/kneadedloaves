import { prisma } from "@/lib/prisma";
import React from "react";

export default async function AdminEmailPage() {
  const jobs = await prisma.emailJob.findMany({ orderBy: { createdAt: "desc" }, take: 30 }).catch(() => []);

  return (
    <div className="space-y-5">
      <section className="panel p-4">
        <h2 className="text-lg font-black">Customer emails</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-ink/70">
          Manual Venmo orders use fixed lifecycle emails: reservation received and awaiting payment, payment verified after independent bakery verification, and reservation expired. Dates and deadlines are written in Eastern Time, with an HTML version and a plain-text version. Sending an email does not verify payment. SMTP credentials live in Setup.
        </p>
      </section>
      <section className="panel p-4"><h2 className="text-lg font-black">Delivery queue</h2><p>Failed messages can be retried after fixing email settings. Check provider logs first if delivery is uncertain.</p>{jobs.map(job => <div key={job.id} className="border-t py-2"><p>{job.to} · {job.status} · {job.attempts} attempts</p>{job.lastError && <p>{job.lastError}</p>}{job.status === "FAILED" && <form method="post" action="/api/admin/email/retry"><input type="hidden" name="id" value={job.id}/><button className="btn-secondary">Retry delivery</button></form>}</div>)}</section>
      <section className="panel p-4">
        <h2 className="text-lg font-black">Legacy email templates</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-ink/70">
          Saved pickup and delivery confirmation templates are not used by manual Venmo checkout. The legacy template editor is unavailable here so changes cannot be mistaken for updates to the manual-payment emails.
        </p>
      </section>
    </div>
  );
}
