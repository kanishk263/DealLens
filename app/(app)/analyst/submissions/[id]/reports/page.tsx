import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, Notice } from "@/components/ui/states";
import { ActionButton, ActionForm } from "@/components/forms/action-form";
import { Input } from "@/components/ui/form-controls";
import { Button } from "@/components/ui/button";
import { ReportPreview } from "@/components/reports/report-preview";
import { loadAnalystSubmission } from "@/lib/database/submission-context";
import type { ReportConfig } from "@/lib/reporting/config";
import { formatDateTime, humanize } from "@/lib/utilities/format";
import { publishReport, regenerateReport, reopenForNewVersion, reviewReport, submitReport } from "./actions";
import { ReportForm } from "./report-form";

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ preview?: string }> }) {
  const { id } = await params;
  const { preview } = await searchParams;
  const { supabase, sub, canWork, ctx, isAssigned } = await loadAnalystSubmission(id);
  const [{ data: reports }, { data: jobs }] = await Promise.all([
    supabase.from("reports").select("*, author:profiles!reports_created_by_fkey(full_name), approver:profiles!reports_approved_by_fkey(full_name), publisher:profiles!reports_published_by_fkey(full_name)")
      .eq("submission_id", id).order("report_version", { ascending: false }),
    supabase.from("processing_jobs").select("report_id, job_status, safe_error_message").eq("submission_id", id).eq("job_type", "generate_report").in("job_status", ["queued", "running", "failed"]),
  ]);
  const busy = new Set((jobs ?? []).filter((j) => ["queued", "running"].includes(j.job_status)).map((j) => j.report_id));
  const failed = new Map((jobs ?? []).filter((j) => j.job_status === "failed").map((j) => [j.report_id, j.safe_error_message]));
  const open = (reports ?? []).find((r) => ["draft", "pending_review", "changes_requested", "approved"].includes(r.status));
  const canCreate = canWork && ["in_analysis", "clarification_required"].includes(sub.submission_status) && !open;
  const isReviewer = ctx.roles.includes("finance_reviewer");
  const previewed = (reports ?? []).find((r) => r.id === preview && r.snapshot);
  return (
    <div className="space-y-6">
      <Notice>Lifecycle: draft → pending review → approved (by a reviewer other than the author) → published. Published versions are immutable; changes after publication create a new version and supersede the old one.</Notice>
      <Card>
        <CardHeader title="Report versions" actions={<div className="flex gap-2">
          {canCreate ? <ReportForm submissionId={id} /> : null}
          {sub.submission_status === "published" && isAssigned ? <ActionButton action={reopenForNewVersion} fields={{ submissionId: id }} label="Reopen for a new version" confirm="Reopen this submission to prepare a new report version? The published report stays available and unchanged." /> : null}
        </div>} />
        {(reports ?? []).length === 0 ? <CardBody><EmptyState title="No reports yet" description={canWork ? "Create a draft when findings and valuations are ready." : undefined} /></CardBody> : (
          <ul className="divide-y divide-border">
            {(reports ?? []).map((r) => {
              const mine = r.created_by === ctx.userId;
              return (
                <li key={r.id} className="space-y-2 px-5 py-4 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{r.report_title} <span className="text-muted">v{r.report_version} · {humanize(r.report_type)}</span></p>
                      <p className="text-xs text-muted">
                        Drafted by {(r.author as { full_name: string | null } | null)?.full_name ?? "—"} · {formatDateTime(r.created_at)}
                        {r.generated_at ? ` · rendered ${formatDateTime(r.generated_at)}${r.is_final_render ? " (final)" : ""}` : ""}
                        {r.approved_at ? ` · approved by ${(r.approver as { full_name: string | null } | null)?.full_name} ${formatDateTime(r.approved_at)}` : ""}
                        {r.published_at ? ` · published by ${(r.publisher as { full_name: string | null } | null)?.full_name} ${formatDateTime(r.published_at)}` : ""}
                      </p>
                      {r.review_notes ? <p className="mt-1 text-xs">Reviewer notes: {r.review_notes}</p> : null}
                      {r.content_checksum ? <p className="font-mono text-[11px] text-faint">sha256 {r.content_checksum.slice(0, 16)}…</p> : null}
                    </div>
                    <div className="flex items-center gap-2"><StatusBadge status={r.status} />{busy.has(r.id) ? <span className="text-xs text-info">Rendering…</span> : null}</div>
                  </div>
                  {failed.get(r.id) && !busy.has(r.id) ? <p className="text-xs text-danger">Last render failed: {failed.get(r.id)}</p> : null}
                  <div className="flex flex-wrap items-center gap-2">
                    {r.storage_path ? <Button asChild size="sm" variant="secondary"><a href={`/api/reports/${r.id}/download`}>Download PDF</a></Button> : null}
                    {r.snapshot ? <Button asChild size="sm" variant="ghost"><a href={`?preview=${r.id}`}>Preview contents</a></Button> : null}
                    {canWork && ["draft", "changes_requested"].includes(r.status) ? <>
                      <ReportForm submissionId={id} report={{ id: r.id, title: r.report_title, type: r.report_type, config: r.config as ReportConfig }} />
                      <ActionButton action={regenerateReport} fields={{ reportId: r.id }} label="Regenerate PDF" />
                      <ActionButton action={submitReport} fields={{ reportId: r.id }} label="Submit for review" variant="primary" />
                    </> : null}
                    {isReviewer && r.status === "pending_review" && !mine ? (
                      <ActionForm action={reviewReport} className="flex flex-wrap items-center gap-2">
                        {(p) => <>
                          <input type="hidden" name="reportId" value={r.id} />
                          <Input name="notes" placeholder="Review notes" className="h-8 w-56" aria-label="Review notes" />
                          <Button type="submit" name="decision" value="approved" size="sm" disabled={p}>Approve</Button>
                          <Button type="submit" name="decision" value="changes_requested" size="sm" variant="secondary" disabled={p}>Request changes</Button>
                        </>}
                      </ActionForm>
                    ) : null}
                    {isReviewer && r.status === "pending_review" && mine ? <span className="text-xs text-muted">Another reviewer must approve your report.</span> : null}
                    {r.status === "approved" && (isReviewer || isAssigned) ? (
                      r.is_final_render ? <ActionButton action={publishReport} fields={{ reportId: r.id }} label="Publish to company" variant="primary" confirm="Publish this approved report? The company will be notified and the version becomes immutable." />
                        : <span className="text-xs text-info">Final approved PDF is rendering; publishing becomes available when it completes.</span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {previewed ? <Card><CardHeader title={`Preview · v${previewed.report_version}`} description="This is the exact snapshot the PDF was rendered from." /><CardBody><ReportPreview snap={previewed.snapshot} /></CardBody></Card> : null}
    </div>
  );
}
