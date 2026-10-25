"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { StatusBadge } from "@/components/ui/status-badge";
import { METRICS } from "@/lib/financial/metric-definitions";
import { formatMetric } from "@/lib/financial/format-metric";
import { humanize } from "@/lib/utilities/format";

export interface TableCell { value: number | null; status: string; reason: string | null; inputs: Record<string, unknown>; lineItemIds: string[] }
export interface SourceRef { label: string; reference: string; document: string; value: number | null }

/** Metrics × periods. Every cell opens its provenance: formula, inputs, basis and the source line items. */
export function MetricTable({ keys, periods, cells, sources, currency, unit }: {
  keys: string[]; periods: { id: string; label: string }[]; cells: Record<string, TableCell>; sources: Record<string, SourceRef>;
  currency: string; unit: string;
}) {
  const [open, setOpen] = useState<{ key: string; period: string; cell: TableCell } | null>(null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-subtle text-xs uppercase tracking-wide text-muted">
          <tr><th className="px-4 py-2 text-left font-medium">Metric</th>{periods.map((p) => <th key={p.id} className="px-4 py-2 text-right font-medium">{p.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {keys.map((k) => {
            const def = METRICS[k];
            return (
              <tr key={k}>
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  <span className="text-ink">{def?.label ?? humanize(k)}</span>
                  {def ? <span className="block text-[11px] text-faint">{def.formula}</span> : null}
                </th>
                {periods.map((p) => {
                  const cell = cells[`${k}|${p.id}`];
                  if (!cell) return <td key={p.id} className="px-4 py-2 text-right text-faint">—</td>;
                  return (
                    <td key={p.id} className="px-4 py-2 text-right">
                      <button className="tabular rounded px-1 hover:bg-accent-soft" onClick={() => setOpen({ key: k, period: p.label, cell })}
                        title={cell.status === "unavailable" ? cell.reason ?? "Unavailable" : "Show calculation"}>
                        {cell.value === null ? <span className="text-xs text-faint">n/a</span> : formatMetric(cell.value, def?.format ?? "amount", currency, unit)}
                        {cell.status === "warning" ? <span className="ml-1 text-warning" aria-label="warning">*</span> : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-4 py-2 text-xs text-muted">Select a value to see its formula, inputs and source references. * calculated with a stated limitation. n/a: not calculable from valid inputs.</p>
      {open ? (
        <Modal open onOpenChange={(o) => !o && setOpen(null)} wide title={`${METRICS[open.key]?.label ?? open.key} · ${open.period}`} description={METRICS[open.key]?.formula}>
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-2"><StatusBadge status={open.cell.status} />{open.cell.reason ? <span className="text-muted">{open.cell.reason}</span> : null}</div>
            {open.cell.value !== null ? <p className="tabular text-2xl font-semibold">{formatMetric(open.cell.value, METRICS[open.key]?.format ?? "amount", currency, unit)}</p> : null}
            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase text-muted">Inputs</h4>
              <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                {Object.entries(open.cell.inputs).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 border-b border-border py-1"><dt className="text-muted">{humanize(k)}</dt>
                    <dd className="tabular text-right">{typeof v === "number" ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(v) : String(v ?? "—")}</dd></div>
                ))}
              </dl>
            </div>
            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase text-muted">Source line items</h4>
              {open.cell.lineItemIds.length === 0 ? <p className="text-muted">Derived from other metrics only.</p> : (
                <ul className="space-y-1">
                  {open.cell.lineItemIds.map((id) => {
                    const s = sources[id];
                    return <li key={id} className="text-xs">{s ? <><span className="font-medium">{s.label}</span> · {s.document} · <span className="font-mono">{s.reference}</span>{s.value !== null ? ` · ${s.value}` : ""}</> : <span className="font-mono text-faint">{id}</span>}</li>;
                  })}
                </ul>
              )}
            </div>
            <p className="text-xs text-faint">Formula version v1 · preliminary until reviewed and included in an approved report.</p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
