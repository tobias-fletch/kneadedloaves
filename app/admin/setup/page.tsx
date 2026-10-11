import { SetupSettingsForm } from "@/components/SetupSettingsForm";
import { getSetupConfigSummary } from "@/lib/app-config";

export default async function AdminSetupPage() {
  const fields = await getSetupConfigSummary();
  const missing = fields.filter((field) => !field.configured);

  return (
    <div className="space-y-5">
      <section className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black">Shop setup</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-ink/70">
              Add payment, email, social, and launch values here. Secret values are never shown again after saving.
            </p>
          </div>
          <span className="badge bg-crumb text-ink">{missing.length ? `${missing.length} missing` : "Ready"}</span>
        </div>
      </section>
      <SetupSettingsForm fields={fields} />
    </div>
  );
}
