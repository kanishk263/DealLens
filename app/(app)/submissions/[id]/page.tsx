import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/link-tabs";
import { Notice } from "@/components/ui/states";
import { StatusBadge, SyntheticBadge } from "@/components/ui/status-badge";
import { ActionButton } from "@/components/forms/action-form";
import { DocumentList, type DocumentRow } from "@/components/documents/document-list";
import { DocumentUploader } from "@/components/documents/document-uploader";
import { StatusTimeline } from "@/components/documents/timeline";
import { QualityIssueList, type IssueRow } from "@/components/financial/quality-issues";
import { COMPANY_EDITABLE, STATUS_DESCRIPTIONS, type SubmissionStatus } from "@/lib/submissions/workflow";
import { formatDate, humanize } from "@/lib/utilities/format";
import { removeDocument, submitSubmission } from "../actions";
import { retryProcessing } from "../../admin/actions";
import { CompanyAnalyticsTab } from "./analytics-tab";
import { CompanyClarificationsTab } from "./clarifications-tab";
import { CompanyReportsTab } from "./reports-tab";

export const metadata = { title: "Submission" };

export default async function SubmissionDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  await requireRole("company_user");
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const supabase = await createClient();
  const { data: sub } = await supabase.from("submissions")
    .select("*, companies(display_name), deal_projects(name), analyst:profiles!submissions_assigned_analyst_id_fkey(full_name)")
    .eq("id", id).maybeSingle();
  if (!sub) notFound();  // RLS returns nothing for other companies' submissions
  const status = sub.submission_status as SubmissionStatus;

  const [{ data: documents }, { data: history }, { data: issues }, { count: openClarifications }, { count: reportCount }, { data: setting }] = await Promise.all([
    supabase.from("documents").select("id, original_filename, file_type, file_size_bytes, document_category, document_version, processing_status, uploaded_at, extraction_metadata").eq("submission_id", id).order("uploaded_at"),
    supabase.from("submission_status_history").select("id, to_status, occurred_at, actor_kind, reason").eq("submission_id", id).order("occurred_at"),
    supabase.from("data_quality_issues").select("id, severity, title, description, suggested_resolution, status, resolution_notes, source_references, issue_type").eq("submission_id", id).neq("status", "resolved"),
    supabase.from("clarification_requests").select("id", { count: "exact", head: true }).eq("submission_id", id).eq("status", "open"),
    supabase.from("reports").select("id", { count: "exact", head: true }).eq("submission_id", id),
    supabase.from("platform_settings").select("value").eq("key", "max_upload_mb").maybeSingle(),
  ]);
  const editable = COMPANY_EDITABLE.has(status);
  const docs = (documents ?? []) as DocumentRow[];
  const tabs = [
    { key: "overview", label: "Overview", href: `/submissions/${id}` },
    { key: "documents", label: "Documents", href: `/submissions/${id}?tab=documents`, count: docs.length },
    { key: "quality", label: "Data quality", href: `/submissions/${id}?tab=quality`, count: issues?.length ?? 0 },
    { key: "analytics", label: "Preliminary analytics", href: `/submissions/${id}?tab=analytics` },
    { key: "clarifications", label: "Clarifications", href: `/submissions/${id}?tab=clarifications`, count: openClarifications ?? 0 },
    { key: "reports", label: "Published reports", href: `/submissions/${id}?tab=reports`, count: reportCount ?? 0 },
  ];

  return (
    <>
      <PageHeader
        title={sub.submission_name}
        breadcrumbs={[{ label: "Submissions", href: "/submissions" }, { label: sub.submission_name }]}
        badges={<><StatusBadge status={status} />{sub.is_synthetic ? <SyntheticBadge /> : null}</>}
        description={STATUS_DESCRIPTIONS[status]}
        actions={
          <>
            {status === "draft" && docs.length > 0 ? <ActionButton action={submitSubmission} fields={{ submissionId: id }} label="Submit package" variant="primary" size="md" confirm="Submit this package for processing? Documents will be locked." /> : null}
            {status === "processing_failed" ? <ActionButton action={retryProcessing} fields={{ submissionId: id }} label="Resubmit for processing" variant="primary" size="md" /> : null}
          </>
        }
      />
      <LinkTabs tabs={tabs} active={tab} />
      {tab === "overview" ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Submission details" />
            <CardBody>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div><dt className="text-muted">Company</dt><dd>{(sub.companies as { display_name: string } | null)?.display_name}</dd></div>
                <div><dt className="text-muted">Deal type</dt><dd>{humanize(sub.deal_type)}{sub.deal_projects ? ` · ${(sub.deal_projects as { name: string }).name}` : ""}</dd></div>
                <div><dt className="text-muted">Reporting period</dt><dd>{formatDate(sub.reporting_period_start)} – {formatDate(sub.reporting_period_end)}</dd></div>
                <div><dt className="text-muted">Currency and units</dt><dd>{sub.reporting_currency} · {sub.reporting_unit}</dd></div>
                <div><dt className="text-muted">Assigned analyst</dt><dd>{(sub.analyst as { full_name: string | null } | null)?.full_name ?? "Not yet assigned"}</dd></div>
                <div><dt className="text-muted">Submitted</dt><dd>{formatDate(sub.submitted_at)}</dd></div>
                {sub.notes ? <div className="sm:col-span-2"><dt className="text-muted">Notes</dt><dd className="whitespace-pre-wrap">{sub.notes}</dd></div> : null}
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Processing timeline" />
            <CardBody><StatusTimeline events={history ?? []} /></CardBody>
          </Card>
        </div>
      ) : null}
      {tab === "documents" ? (
        <div className="space-y-6">
          <Card><CardHeader title="Documents" description="Previous versions are retained. Files are private and downloaded through short-lived links." />
            <DocumentList documents={docs} canRemove={status === "draft" || status === "processing_failed"} removeAction={removeDocument} />
          </Card>
          {editable ? (
            <Card><CardHeader title="Add documents" description={status === "clarification_required" ? "Upload supporting documents in response to clarification requests." : undefined} />
              <CardBody><DocumentUploader submissionId={id} maxMb={Number(setting?.value ?? 25)} /></CardBody>
            </Card>
          ) : <Notice>Documents are locked while the submission is {humanize(status).toLowerCase()}.</Notice>}
        </div>
      ) : null}
      {tab === "quality" ? (
        <div className="space-y-4">
          <Notice>These are automated checks on the extracted data. They indicate potential inconsistencies that may need correction or explanation; they are not conclusions.</Notice>
          <QualityIssueList issues={(issues ?? []) as IssueRow[]} />
        </div>
      ) : null}
      {tab === "analytics" ? <CompanyAnalyticsTab submissionId={id} currency={sub.reporting_currency} unit={sub.reporting_unit} version={sub.current_analysis_version} /> : null}
      {tab === "clarifications" ? <CompanyClarificationsTab submissionId={id} status={status} maxMb={Number(setting?.value ?? 25)} /> : null}
      {tab === "reports" ? <CompanyReportsTab submissionId={id} /> : null}
    </>
  );
}
