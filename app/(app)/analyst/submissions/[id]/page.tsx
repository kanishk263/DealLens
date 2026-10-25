import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DocumentList, type DocumentRow } from "@/components/documents/document-list";
import { StatusTimeline } from "@/components/documents/timeline";
import { ActionButton } from "@/components/forms/action-form";
import { MetricCard } from "@/components/financial/metric-card";
import { loadAnalystSubmission } from "@/lib/database/submission-context";
import { formatDate, formatDateTime, humanize } from "@/lib/utilities/format";
import { requestReanalysis, transitionSubmission } from "../../actions";

export default async function AnalystOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sub, supabase, canWork } = await loadAnalystSubmission(id);
  const [{ data: documents }, { data: history }, { data: jobs }, { data: items }, { data: issues }] = await Promise.all([
    supabase.from("documents").select("id, original_filename, file_type, file_size_bytes, document_category, document_version, processing_status, uploaded_at, extraction_metadata").eq("submission_id", id).order("uploaded_at"),
    supabase.from("submission_status_history").select("id, to_status, occurred_at, actor_kind, reason").eq("submission_id", id).order("occurred_at"),
    supabase.from("processing_jobs").select("id, job_type, job_status, completed_at, error_code").eq("submission_id", id).order("created_at", { ascending: false }).limit(5),
    supabase.from("financial_line_items").select("mapping_status").eq("submission_id", id),
    supabase.from("data_quality_issues").select("severity").eq("submission_id", id).eq("status", "open"),
  ]);
  const by = (s: string) => (items ?? []).filter((i) => i.mapping_status === s).length;
  const pendingJob = (jobs ?? []).some((j) => ["queued", "running"].includes(j.job_status));
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Extracted values" value={String(items?.length ?? 0)} sublabel={`${by("auto_mapped")} auto-mapped · ${by("analyst_confirmed") + by("analyst_mapped")} analyst-reviewed`} />
        <MetricCard label="Mappings to review" value={String(by("needs_review") + by("unmapped"))} sublabel={`${by("needs_review")} uncertain · ${by("unmapped")} unmapped`} />
        <MetricCard label="Open quality issues" value={String(issues?.length ?? 0)} sublabel={`${(issues ?? []).filter((i) => ["critical", "high"].includes(i.severity)).length} critical/high`} />
        <MetricCard label="Analysis version" value={`v${sub.current_analysis_version}`} sublabel={pendingJob ? "Processing in progress…" : "Up to date with last run"} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Submission" actions={canWork ? (
            <div className="flex gap-2">
              <ActionButton action={requestReanalysis} fields={{ submissionId: id }} label="Recalculate analysis" />
              {sub.submission_status === "clarification_required" ? <ActionButton action={transitionSubmission} fields={{ submissionId: id, to: "in_analysis", reason: "Resumed by analyst" }} label="Resume analysis" /> : null}
              {sub.submission_status === "in_analysis" ? <ActionButton action={transitionSubmission} fields={{ submissionId: id, to: "uploaded", reason: "Reprocessing requested by analyst" }} label="Reprocess documents" confirm="Re-run extraction for all documents? Analyst mapping changes on re-extracted items will be replaced." /> : null}
            </div>) : null} />
          <CardBody>
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div><dt className="text-muted">Company</dt><dd>{(sub.companies as { display_name: string } | null)?.display_name}</dd></div>
              <div><dt className="text-muted">Deal type</dt><dd>{humanize(sub.deal_type)}</dd></div>
              <div><dt className="text-muted">Reporting period</dt><dd>{formatDate(sub.reporting_period_start)} – {formatDate(sub.reporting_period_end)}</dd></div>
              <div><dt className="text-muted">Currency / unit</dt><dd>{sub.reporting_currency} · {sub.reporting_unit}</dd></div>
              <div><dt className="text-muted">Analyst</dt><dd>{(sub.analyst as { full_name: string | null } | null)?.full_name ?? "Unassigned"}</dd></div>
              <div><dt className="text-muted">Submitted</dt><dd>{formatDateTime(sub.submitted_at)}</dd></div>
              {sub.notes ? <div className="sm:col-span-3"><dt className="text-muted">Company notes</dt><dd className="whitespace-pre-wrap">{sub.notes}</dd></div> : null}
            </dl>
          </CardBody>
        </Card>
        <Card><CardHeader title="Timeline" /><CardBody><StatusTimeline events={history ?? []} /></CardBody></Card>
      </div>
      <Card><CardHeader title="Documents" description="Original files are available through short-lived, audited links." /><DocumentList documents={(documents ?? []) as DocumentRow[]} /></Card>
    </div>
  );
}
