import { SetupSettingsForm } from "@/components/SetupSettingsForm";
import { getSetupConfigSummary } from "@/lib/app-config";
import { ENCRYPTION_KEY_MISCONFIGURED_MESSAGE, UNDECRYPTABLE_SETTING_MESSAGE } from "@/lib/config-messages";
import { getManualPaymentConfig } from "@/lib/manual-payment-config";
import { requireAdmin } from "@/lib/auth";
import { resendConfigured } from "@/lib/mail-provider";
export default async function AdminSetupPage() {
  await requireAdmin();
  const [fields, payment] = await Promise.all([getSetupConfigSummary(), getManualPaymentConfig()]);
  const enabled = fields.find(field => field.key === "VENMO_CHECKOUT_ENABLED")?.value === "true";
  // Never pass the config object or its secrets into a client component.
  return <div className="space-y-5">
    <section className="panel p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-black">Shop setup</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-ink/70">Configure payment, email, and launch settings. Secret values are never shown again after saving.</p></div><span className="badge bg-crumb">{payment.ready ? "Checkout ready" : "Checkout paused"}</span></div></section>
    {fields.some(field => field.encryptionKeyValid === false) ? <p className="border-2 border-ink bg-jam p-3 text-sm font-bold" role="status">{ENCRYPTION_KEY_MISCONFIGURED_MESSAGE}</p> : null}
    {fields.some(field => field.undecryptable) ? <p className="border-2 border-ink bg-jam p-3 text-sm font-bold" role="status">{UNDECRYPTABLE_SETTING_MESSAGE}</p> : null}
    <section className="panel space-y-3 p-4" aria-labelledby="payment-readiness"><h2 id="payment-readiness" className="text-lg font-black">Venmo checkout readiness</h2><p className="text-sm">{enabled ? "Checkout has been enabled in configuration." : "Checkout is disabled."} Orders are accepted only when every required check passes. Manual payment requires independent verification in Venmo.</p>{payment.reasons.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{payment.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul> : <p className="font-bold">Required configuration checks pass. Continue checking each payment independently before fulfillment.</p>}</section>
    <SetupSettingsForm fields={fields} emailStatus={{ resendConfigured: resendConfigured() }} />
  </div>;
}
