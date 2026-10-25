import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/states";
import { formatDateTime } from "@/lib/utilities/format";
import { SettingForm } from "./setting-form";

export const metadata = { title: "Platform settings" };

export default async function SettingsPage() {
  await requireRole("superadmin");
  const supabase = await createClient();
  const { data } = await supabase.from("platform_settings").select("key, value, description, updated_at").order("key");
  return (
    <>
      <PageHeader title="Platform settings" description="Application-level configuration. Secrets and environment variables are never shown or editable here." />
      <div className="mb-4"><Notice>OAuth credentials, Supabase keys and database passwords are managed in your hosting provider and Supabase dashboard, not in DealLens.</Notice></div>
      <Card>
        <CardHeader title="Configuration" />
        <CardBody className="divide-y divide-border p-0">
          {(data ?? []).map((s) => (
            <div key={s.key} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="font-mono text-sm">{s.key}</p>
                <p className="text-sm text-muted">{s.description}</p>
                <p className="text-xs text-faint">Updated {formatDateTime(s.updated_at)}</p>
              </div>
              <SettingForm settingKey={s.key} value={s.value as number | boolean} />
            </div>
          ))}
        </CardBody>
      </Card>
    </>
  );
}
