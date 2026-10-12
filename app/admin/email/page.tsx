import { prisma } from "@/lib/prisma";
import { EmailTemplateForm } from "@/components/EmailTemplateForm";
import { getOrderEmailTemplates } from "@/lib/email";

export default async function AdminEmailPage() {
  const jobs = await prisma.emailJob.findMany({ orderBy: { createdAt: "desc" }, take: 30 }).catch(() => []);
  const templates = await getOrderEmailTemplates();

  return (
    <div className="space-y-5">
      <section className="panel p-4">
        <h2 className="text-lg font-black">Customer emails</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-ink/70">
          Edit the confirmation emails customers receive after placing pickup or delivery orders. SMTP credentials live in Setup.
        </p>
      </section>
      <section className="panel p-4"><h2 className="text-lg font-black">Delivery queue</h2><p>Failed messages can be retried after fixing email settings. Check provider logs first if delivery is uncertain.</p>{jobs.map(job => <div key={job.id} className="border-t py-2"><p>{job.to} · {job.status} · {job.attempts} attempts</p>{job.lastError && <p>{job.lastError}</p>}{job.status === "FAILED" && <form method="post" action="/api/admin/email/retry"><input type="hidden" name="id" value={job.id}/><button className="btn-secondary">Retry delivery</button></form>}</div>)}</section>
      <EmailTemplateForm templates={templates} />
    </div>
  );
}
