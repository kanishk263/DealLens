import { Card, CardBody } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/link-tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice } from "@/components/ui/states";
import { ChartCard } from "@/components/charts/chart-card";
import { SeverityBars } from "@/components/charts/charts";
import { loadAnalystSubmission } from "@/lib/database/submission-context";
import { formatDateTime, humanize } from "@/lib/utilities/format";
import { ReviewFlag } from "./review-flag";

const ORDER = ["critical", "high", "medium", "low", "informational"];

function show(v: number | null, rule: string) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (/percent|pp|margin|growth|share|%|OCF \/ EBITDA|of revenue|of reported/i.test(rule) && Math.abs(n) < 5) return `${(n * 100).toFixed(1)}%`;
  if (/x$|multiple|EBITDA >/i.test(rule)) return `${n.toFixed(2)}x`;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
}

export default async function RedFlagsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }) {
  const { id } = await params;
  const { status = "open" } = await searchParams;
  const { supabase, canWork } = await loadAnalystSubmission(id);
  const { data } = await supabase.from("red_flags").select("*, profiles(full_name)").eq("submission_id", id).order("created_at");
  const all = (data ?? []).filter((f) => f.is_active);
  const flags = all.filter((f) => status === "all" || f.review_status === status).sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
  const counts = ORDER.map((s) => ({ severity: s, count: all.filter((f) => f.severity === s && f.review_status !== "dismissed").length })).filter((c) => c.count);
  const base = `/analyst/submissions/${id}/red-flags`;
  return (
    <div className="space-y-6">
      <Notice>Red flags are deterministic rule outputs that indicate matters requiring investigation. They are not evidence of fraud, misrepresentation or misconduct. Thresholds are illustrative defaults documented with each flag (processing/config/thresholds.json).</Notice>
      {counts.length ? <ChartCard title="Red flags by severity" subtitle="Active, not dismissed"><SeverityBars counts={counts} /></ChartCard> : null}
      <LinkTabs active={status} tabs={["open", "escalated", "resolved", "dismissed", "all"].map((s) => ({ key: s, label: humanize(s), href: `${base}?status=${s}`, count: s === "all" ? all.length : all.filter((f) => f.review_status === s).length }))} />
      {flags.length === 0 ? <EmptyState title="No red flags in this view" /> : flags.map((f) => {
        const threshold = f.threshold as Record<string, unknown>;
        return (
          <Card key={f.id}>
            <CardBody className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2"><StatusBadge status={f.severity} /><p className="font-medium">{f.title}</p><Badge>{humanize(f.category)}</Badge>{f.source_period ? <Badge tone="accent">{f.source_period}</Badge> : null}</div>
                <div className="flex items-center gap-2"><StatusBadge status={f.review_status} />{canWork ? <ReviewFlag flagId={f.id} status={f.review_status} /> : null}</div>
              </div>
              <p className="text-sm">{f.explanation}</p>
              <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                <div><dt className="text-muted">Triggering rule</dt><dd>{f.triggering_rule}</dd></div>
                <div><dt className="text-muted">Observed</dt><dd className="tabular">{show(f.observed_value, f.triggering_rule)}</dd></div>
                <div><dt className="text-muted">Comparison</dt><dd className="tabular">{show(f.comparison_value, f.triggering_rule)}</dd></div>
                <div><dt className="text-muted">Threshold</dt><dd>{Object.entries(threshold).filter(([k]) => !["rationale", "illustrative", "severity"].includes(k)).map(([k, v]) => `${k}: ${v}`).join(", ") || "—"}{threshold.illustrative ? " (illustrative default)" : ""}</dd></div>
              </dl>
              <p className="text-xs text-muted">Why this threshold: {String(threshold.rationale ?? "")}</p>
              <p className="text-xs"><span className="font-medium">Recommended follow-up:</span> {f.recommended_follow_up}</p>
              {(f.source_references as unknown[]).length ? <p className="text-xs text-faint">Sources: {(f.source_references as { reference?: string; metric?: string; period?: string }[]).map((r) => r.reference ?? `${r.metric} (${r.period})`).join("; ")}</p> : null}
              {f.review_notes ? <p className="rounded-md bg-subtle px-3 py-2 text-xs">Review: {f.review_notes} — {(f.profiles as { full_name: string | null } | null)?.full_name ?? ""} {formatDateTime(f.reviewed_at)}</p> : null}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
