import { Badge } from "@/components/ui/badge";
import { formatAmount, formatPercent } from "@/lib/utilities/format";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Snapshot = any;

/** HTML preview of exactly the snapshot the PDF is rendered from. */
export function ReportPreview({ snap }: { snap: Snapshot }) {
  const cur = snap.submission.currency, unit = snap.submission.unit;
  const last = snap.periods.at(-1);
  const m = (k: string) => snap.metrics?.[k]?.[last]?.value ?? null;
  return (
    <article className="space-y-5 text-sm">
      <header>
        <p className="text-xs uppercase tracking-wide text-muted">{snap.company.display_name}{snap.company.is_synthetic ? " · synthetic data" : ""}</p>
        <h2 className="text-lg font-semibold">{snap.report.title} <span className="text-muted">v{snap.report.version}</span></h2>
        <p className="text-xs text-muted">Snapshot captured {new Date(snap.captured_at).toLocaleString("en-GB")} · analysis v{snap.submission.analysis_version} · {cur} {unit}</p>
        <div className="mt-2 flex flex-wrap gap-1">{snap.sections.map((s: string) => <Badge key={s}>{s.replace(/_/g, " ")}</Badge>)}</div>
      </header>
      {snap.sections.includes("executive_summary") ? <section><h3 className="font-semibold">Executive summary</h3><p className="whitespace-pre-wrap text-muted">{snap.executive_summary || "No executive summary provided."}</p></section> : null}
      {last ? (
        <section className="grid gap-2 sm:grid-cols-4">
          {[["Revenue", formatAmount(m("revenue"), cur, unit)], ["EBITDA", formatAmount(m("ebitda"), cur, unit)], ["EBITDA margin", formatPercent(m("ebitda_margin"))], ["Net debt", formatAmount(m("net_debt"), cur, unit)]].map(([l, v]) => (
            <div key={l} className="rounded-md border border-border p-2"><p className="text-xs text-muted">{l} · {last}</p><p className="tabular font-semibold">{v}</p></div>
          ))}
        </section>
      ) : null}
      <section>
        <h3 className="font-semibold">Findings included ({snap.findings.length})</h3>
        {snap.findings.length === 0 ? <p className="text-muted">No approved client-visible findings.</p> : (
          <ul className="list-disc pl-5">{snap.findings.map((f: any) => <li key={f.reference_code}><span className="font-mono text-xs">{f.reference_code}</span> {f.title} <span className="text-muted">({f.severity})</span></li>)}</ul>
        )}
      </section>
      <section>
        <h3 className="font-semibold">Valuations included ({snap.valuations.length})</h3>
        {snap.valuations.length === 0 ? <p className="text-muted">No approved valuation models.</p> : (
          <ul className="list-disc pl-5">{snap.valuations.map((v: any) => <li key={v.name}>{v.name} v{v.version}: EV {formatAmount(v.enterprise_value.low, cur, unit)} – {formatAmount(v.enterprise_value.high, cur, unit)}</li>)}</ul>
        )}
      </section>
      <section><h3 className="font-semibold">EBITDA adjustments included</h3><p className="text-muted">{snap.ebitda_adjustments.length} approved adjustment(s).</p></section>
      <p className="rounded-md bg-subtle px-3 py-2 text-xs text-muted">Excluded by design: internal findings, internal comments, red flags, unapproved adjustments and valuations, review notes.</p>
    </article>
  );
}
