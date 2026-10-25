import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionButton, ActionForm, FormSubmit } from "@/components/forms/action-form";
import { Select, Textarea } from "@/components/ui/form-controls";
import { loadAnalystSubmission } from "@/lib/database/submission-context";
import { formatAmount, formatDateTime, humanize } from "@/lib/utilities/format";
import { addFindingComment, setFindingStatus } from "../../../actions";
import { FindingForm, type FindingRecord } from "./finding-form";

export default async function FindingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ open?: string }> }) {
  const { id } = await params;
  const { open } = await searchParams;
  const { supabase, sub, canWork, ctx } = await loadAnalystSubmission(id);
  const [{ data: findings }, { data: flags }] = await Promise.all([
    supabase.from("findings").select("*, owner:profiles!findings_owner_id_fkey(full_name), finding_comments(id, comment_text, visibility, created_at, author:profiles!finding_comments_author_id_fkey(full_name))")
      .eq("submission_id", id).order("reference_code"),
    supabase.from("red_flags").select("title, source_period").eq("submission_id", id).eq("review_status", "escalated"),
  ]);
  const cur = sub.reporting_currency as string;
  const suggestions = (flags ?? []).map((f) => `Red flag: ${f.title} (${f.source_period})`);
  const selected = (findings ?? []).find((f) => f.id === open);
  return (
    <div className="space-y-6">
      <Notice>Internal findings and internal comments never appear in client-facing reports or the company workspace (enforced by database policy). Client-visible findings are shown to the company only once approved.</Notice>
      {suggestions.length ? <Notice tone="warning">Escalated red flags awaiting a finding: {suggestions.join("; ")}</Notice> : null}
      <Card>
        <CardHeader title="Findings register" actions={canWork ? <FindingForm submissionId={id} currency={cur} suggestions={suggestions} /> : null} />
        {(findings ?? []).length === 0 ? <CardBody><EmptyState title="No findings yet" /></CardBody> : (
          <Table>
            <THead><tr><TH>ID</TH><TH>Category</TH><TH>Title</TH><TH>Severity</TH><TH className="text-right">Impact</TH><TH>Sources</TH><TH>Status</TH><TH>Visibility</TH><TH>Owner</TH><TH>Updated</TH><TH /></tr></THead>
            <TBody>
              {(findings ?? []).map((f) => (
                <TR key={f.id} className={f.id === open ? "bg-accent-soft/40" : ""}>
                  <TD className="font-mono text-xs">{f.reference_code}</TD>
                  <TD>{humanize(f.category)}</TD>
                  <TD><a href={`?open=${f.id}`} className="font-medium text-accent hover:underline">{f.title}</a></TD>
                  <TD><StatusBadge status={f.severity} /></TD>
                  <TD className="tabular text-right">{f.quantified_impact === null ? "—" : formatAmount(Number(f.quantified_impact), f.impact_currency, sub.reporting_unit)}</TD>
                  <TD className="text-xs text-muted">{(f.source_references as unknown[]).length}</TD>
                  <TD><StatusBadge status={f.status} /></TD>
                  <TD><StatusBadge status={f.visibility} /></TD>
                  <TD className="text-xs">{(f.owner as { full_name: string | null } | null)?.full_name ?? "—"}</TD>
                  <TD className="whitespace-nowrap text-xs text-muted">{formatDateTime(f.updated_at)}</TD>
                  <TD>{canWork && f.status !== "closed" ? <FindingForm submissionId={id} currency={cur} finding={f as unknown as FindingRecord} /> : null}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {selected ? (
        <Card>
          <CardHeader title={`${selected.reference_code} · ${selected.title}`} actions={canWork ? (
            <div className="flex flex-wrap gap-2">
              {selected.status === "draft" ? <ActionButton action={setFindingStatus} fields={{ findingId: selected.id, status: "in_review" }} label="Send for review" /> : null}
              {["draft", "in_review"].includes(selected.status) && (ctx.roles.includes("finance_reviewer") || selected.created_by !== ctx.userId) ? <ActionButton action={setFindingStatus} fields={{ findingId: selected.id, status: "approved" }} label="Approve" variant="primary" /> : null}
              {["draft", "in_review"].includes(selected.status) && !ctx.roles.includes("finance_reviewer") && selected.created_by === ctx.userId ? <span className="text-xs text-muted">Approval requires a reviewer or another analyst</span> : null}
              {selected.status === "approved" ? <ActionButton action={setFindingStatus} fields={{ findingId: selected.id, status: "closed" }} label="Close" variant="ghost" /> : null}
            </div>) : null} />
          <CardBody className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2"><StatusBadge status={selected.severity} /><StatusBadge status={selected.status} /><StatusBadge status={selected.visibility} /></div>
            <p className="whitespace-pre-wrap">{selected.description}</p>
            {selected.recommendation ? <p><span className="font-medium">Recommendation:</span> {selected.recommendation}</p> : null}
            {(selected.source_references as { reference?: string }[]).length ? <ul className="list-disc pl-5 text-xs text-muted">{(selected.source_references as { reference?: string }[]).map((r, i) => <li key={i}>{r.reference}</li>)}</ul> : null}
            <h3 className="pt-2 text-sm font-semibold">Comments</h3>
            <ul className="space-y-2">
              {((selected.finding_comments ?? []) as { id: string; comment_text: string; visibility: string; created_at: string; author: { full_name: string | null } | null }[])
                .sort((a, b) => a.created_at.localeCompare(b.created_at)).map((c) => (
                <li key={c.id} className={`rounded-md border px-3 py-2 ${c.visibility === "internal" ? "border-border bg-subtle" : "border-info/30 bg-info-soft"}`}>
                  <p className="text-xs text-muted">{c.author?.full_name ?? "—"} · {formatDateTime(c.created_at)} · <Badge tone={c.visibility === "internal" ? "neutral" : "info"}>{c.visibility === "internal" ? "Internal note" : "Client visible"}</Badge></p>
                  <p className="mt-1 whitespace-pre-wrap">{c.comment_text}</p>
                </li>
              ))}
            </ul>
            {canWork ? (
              <ActionForm action={addFindingComment} resetOnSuccess className="space-y-2">
                <>
                    <input type="hidden" name="findingId" value={selected.id} />
                    <Textarea name="text" required placeholder="Add a comment" aria-label="Comment" className="min-h-16" />
                    <div className="flex items-center gap-2">
                      <Select name="visibility" defaultValue="internal" className="w-48" aria-label="Comment visibility"><option value="internal">Internal note</option><option value="client_visible">Client visible</option></Select>
                      <FormSubmit size="sm">Add comment</FormSubmit>
                    </div>
                  </>
              </ActionForm>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
