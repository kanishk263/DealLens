"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { Notice } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/financial/metric-card";
import { valueComparables, type Comparable, type ComparablesInput } from "@/lib/valuation/comparables";
import { formatAmount, formatMultiple } from "@/lib/utilities/format";
import { saveValuationModel } from "@/app/(app)/analyst/submissions/[id]/valuation/actions";

const blank = (currency: string): Comparable => ({ name: "", revenue: null, ebitda: null, enterpriseValue: null, currency, source: "", included: true });
const n = (v: string) => (v.trim() === "" ? null : Number(v));

export function ComparablesBuilder({ submissionId, initial, unit, canWork, targets }: {
  submissionId: string; initial: ComparablesInput; unit: string; canWork: boolean; targets: { ebitda: number | null; adjusted: number | null; revenue: number | null };
}) {
  const [input, setInput] = useState<ComparablesInput>(initial);
  const [name, setName] = useState("Trading comparables");
  const [comments, setComments] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const out = useMemo(() => valueComparables({ ...input, comparables: input.comparables.filter((c) => c.name.trim()) }), [input]);
  const amt = (v: number | null) => formatAmount(v, input.currency, unit);
  const setComp = (i: number, patch: Partial<Comparable>) => setInput((s) => ({ ...s, comparables: s.comparables.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const stats = out.stats[input.multiple];

  async function save() {
    setSaving(true);
    const res = await saveValuationModel({ method: "comparables", submissionId, modelName: name, comments, input: { ...input, comparables: input.comparables.filter((c) => c.name.trim()) } });
    setSaving(false);
    if (res.ok) { toast.success(res.message ?? "Saved"); router.refresh(); } else toast.error(res.error);
  }

  return (
    <div className="space-y-6">
      <Notice tone="warning">Comparable-company figures are entered manually. DealLens does not supply market data, and sample values must not be presented as verified market data. Record the source for every comparable.</Notice>
      <Card>
        <CardHeader title="Target and multiple" />
        <CardBody className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Multiple" htmlFor="multiple">
            <Select id="multiple" value={input.multiple} onChange={(e) => {
              const m = e.target.value as ComparablesInput["multiple"];
              setInput((s) => ({ ...s, multiple: m, targetMetricLabel: m === "ev_ebitda" ? "EBITDA" : "Revenue", targetMetricValue: m === "ev_ebitda" ? targets.adjusted ?? targets.ebitda : targets.revenue }));
            }}><option value="ev_ebitda">EV / EBITDA</option><option value="ev_revenue">EV / Revenue</option></Select>
          </Field>
          <Field label={`Target ${input.targetMetricLabel}`} htmlFor="target" hint={input.multiple === "ev_ebitda" ? (targets.adjusted !== null ? "Pre-filled with Adjusted EBITDA" : "Pre-filled with EBITDA") : "Latest revenue"}>
            <Input id="target" type="number" value={input.targetMetricValue ?? ""} onChange={(e) => setInput((s) => ({ ...s, targetMetricValue: n(e.target.value) }))} />
          </Field>
          <Field label="Target net debt" htmlFor="cnetDebt"><Input id="cnetDebt" type="number" value={input.netDebt ?? ""} onChange={(e) => setInput((s) => ({ ...s, netDebt: n(e.target.value) }))} /></Field>
          <Field label="Base multiple override" htmlFor="override" hint="Optional; requires justification"><Input id="override" type="number" step="0.1" value={input.baseMultipleOverride ?? ""} onChange={(e) => setInput((s) => ({ ...s, baseMultipleOverride: n(e.target.value) }))} /></Field>
          <Field label="Override justification" htmlFor="just" className="sm:col-span-2"><Input id="just" value={input.overrideJustification ?? ""} onChange={(e) => setInput((s) => ({ ...s, overrideJustification: e.target.value }))} /></Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Comparable companies" description={`${input.currency} ${unit}`} actions={<Button size="sm" variant="secondary" onClick={() => setInput((s) => ({ ...s, comparables: [...s.comparables, blank(s.currency)] }))}><Plus className="h-4 w-4" />Add</Button>} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-subtle text-xs text-muted"><tr>{["Include", "Company", "Revenue", "EBITDA", "Enterprise value", "Currency", "Source", "EV/EBITDA", "EV/Revenue", "Status", ""].map((h) => <th key={h} className="px-2 py-2 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {input.comparables.map((c, i) => {
                const r = out.comps.find((x) => x.name === c.name);
                return (
                  <tr key={i}>
                    <td className="px-2 py-1"><input type="checkbox" checked={c.included} onChange={(e) => setComp(i, { included: e.target.checked })} aria-label={`Include ${c.name}`} /></td>
                    <td className="px-2 py-1"><Input className="h-8 w-40" value={c.name} onChange={(e) => setComp(i, { name: e.target.value })} aria-label="Company" /></td>
                    {(["revenue", "ebitda", "enterpriseValue"] as const).map((k) => <td key={k} className="px-2 py-1"><Input className="h-8 w-28 text-right" type="number" value={c[k] ?? ""} onChange={(e) => setComp(i, { [k]: n(e.target.value) })} aria-label={k} /></td>)}
                    <td className="px-2 py-1"><Input className="h-8 w-16" value={c.currency} maxLength={3} onChange={(e) => setComp(i, { currency: e.target.value.toUpperCase() })} aria-label="Currency" /></td>
                    <td className="px-2 py-1"><Input className="h-8 w-44" value={c.source} placeholder="e.g. FY2024 annual report" onChange={(e) => setComp(i, { source: e.target.value })} aria-label="Source" /></td>
                    <td className="tabular px-2 py-1">{formatMultiple(r?.evEbitda)}</td>
                    <td className="tabular px-2 py-1">{formatMultiple(r?.evRevenue)}</td>
                    <td className="max-w-56 px-2 py-1 text-xs">{!c.name ? "" : r?.valid ? <Badge tone="positive">Valid</Badge> : <span className="text-warning">{r?.excludedReason}</span>}
                      {!c.included ? <Input className="mt-1 h-7 text-xs" placeholder="Exclusion reason" value={c.exclusionReason ?? ""} onChange={(e) => setComp(i, { exclusionReason: e.target.value })} aria-label="Exclusion reason" /> : null}</td>
                    <td className="px-2 py-1"><button onClick={() => setInput((s) => ({ ...s, comparables: s.comparables.filter((_, j) => j !== i) }))} aria-label={`Remove ${c.name}`}><Trash2 className="h-4 w-4 text-muted" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {out.errors.length ? <Notice tone="danger" title="Cannot value yet">{out.errors.join(" ")}</Notice> : null}
      {out.warnings.length ? <Notice tone="warning">{out.warnings.join(" ")}</Notice> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Valid comparables" value={String(stats.count)} sublabel={`Mean ${formatMultiple(stats.mean)} · median ${formatMultiple(stats.median)}`} />
        <MetricCard label="Selected multiples" value={out.selectedMultiples.base === null ? null : `${formatMultiple(out.selectedMultiples.low)} / ${formatMultiple(out.selectedMultiples.base)} / ${formatMultiple(out.selectedMultiples.high)}`} sublabel="Low (P25) / base / high (P75)" unavailableReason={out.errors[0]} />
        <MetricCard label="Implied enterprise value" value={out.impliedEnterpriseValue.base === null ? null : amt(out.impliedEnterpriseValue.base)} sublabel={out.impliedEnterpriseValue.low !== null ? `${amt(out.impliedEnterpriseValue.low)} – ${amt(out.impliedEnterpriseValue.high)}` : undefined} unavailableReason={out.errors[0]} formula="Selected multiple × target metric" />
        <MetricCard label="Implied equity value" value={out.impliedEquityValue.base === null ? null : amt(out.impliedEquityValue.base)} sublabel={out.impliedEquityValue.low !== null ? `${amt(out.impliedEquityValue.low)} – ${amt(out.impliedEquityValue.high)}` : undefined} unavailableReason={out.bridge.base?.reason ?? out.errors[0]} formula="EV − net debt − other bridge items" />
      </div>
      {canWork ? (
        <Card><CardHeader title="Save as new model version" /><CardBody className="grid gap-3 sm:grid-cols-3">
          <Field label="Model name" htmlFor="compName"><Input id="compName" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Analyst comments" htmlFor="compComments" className="sm:col-span-2"><Textarea id="compComments" value={comments} onChange={(e) => setComments(e.target.value)} className="min-h-10" /></Field>
          <div><Button onClick={save} disabled={saving || out.errors.length > 0}>{saving ? "Saving…" : "Save version"}</Button></div>
        </CardBody></Card>
      ) : null}
    </div>
  );
}
