import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { NewSubmissionForm } from "./new-submission-form";

export const metadata = { title: "New submission" };

export default async function NewSubmissionPage() {
  const ctx = await requireRole("company_user");
  const supabase = await createClient();
  const [{ data: companies }, { data: deals }, { data: setting }] = await Promise.all([
    supabase.from("companies").select("id, display_name, reporting_currency, reporting_unit").eq("status", "active").order("display_name"),
    supabase.from("deal_projects").select("id, company_id, name").eq("status", "active"),
    supabase.from("platform_settings").select("value").eq("key", "max_upload_mb").maybeSingle(),
  ]);
  return (
    <>
      <PageHeader title="New submission" breadcrumbs={[{ label: "Submissions", href: "/submissions" }, { label: "New" }]}
        description="Create a draft, upload financial statements and supporting schedules, then submit for automated processing and analyst review." />
      {ctx.companies.length === 0 || !companies?.length ? <EmptyState title="No active company membership" description="Ask your administrator to add you to a company." /> : (
        <NewSubmissionForm
          companies={companies.map((c) => ({ id: c.id, name: c.display_name, currency: c.reporting_currency, unit: c.reporting_unit }))}
          deals={deals ?? []}
          maxMb={Number(setting?.value ?? 25)}
        />
      )}
    </>
  );
}
