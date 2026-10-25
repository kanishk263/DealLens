"use client";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { MetricFormat } from "@/lib/financial/metric-definitions";
import { formatMetric } from "@/lib/financial/format-metric";

export const SERIES = ["var(--color-series-1)", "var(--color-series-2)", "var(--color-series-3)", "var(--color-series-4)"];
const axisProps = { stroke: "var(--color-chart-axis)", fontSize: 11, tickLine: false, axisLine: false } as const;

function compact(v: number, format: MetricFormat) {
  if (format === "percent") return `${(v * 100).toFixed(0)}%`;
  if (format === "pp") return `${(v * 100).toFixed(1)}pp`;
  if (format === "days") return `${Math.round(v)}`;
  if (format === "multiple") return `${v.toFixed(1)}x`;
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

export interface SeriesDef { key: string; label: string }

/** HTML legend in series order (Recharts' built-in legend re-sorts entries). */
export function SeriesLegend({ series }: { series: SeriesDef[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: SERIES[i % SERIES.length] }} aria-hidden />{s.label}</li>
      ))}
    </ul>
  );
}
type Row = Record<string, string | number | null>;

function TooltipBox({ active, payload, label, format, currency, unit }: {
  active?: boolean; payload?: { name: string; value: number | null; color: string }[]; label?: string; format: MetricFormat; currency?: string; unit?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-ink">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-ink">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
          <span className="text-muted">{p.name}</span>
          <span className="tabular ml-auto">{p.value === null || p.value === undefined ? "Not available" : formatMetric(p.value, format, currency, unit)}</span>
        </p>
      ))}
    </div>
  );
}

/** Grouped/single bar chart on one value axis (zero baseline). Null values are shown as gaps, not zeros. */
export function BarsChart({ data, series, format = "amount", currency, unit, height = 240 }: {
  data: Row[]; series: SeriesDef[]; format?: MetricFormat; currency?: string; unit?: string; height?: number;
}) {
  return (
    <>
    <div style={{ height }} role="img" aria-label={`Bar chart of ${series.map((s) => s.label).join(", ")}`}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke="var(--color-chart-grid)" />
          <XAxis dataKey="period" {...axisProps} />
          <YAxis {...axisProps} width={56} tickFormatter={(v) => compact(v, format)} />
          <ReferenceLine y={0} stroke="var(--color-chart-axis)" />
          <Tooltip cursor={{ fill: "var(--color-subtle)" }} content={<TooltipBox format={format} currency={currency} unit={unit} />} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES[i % SERIES.length]} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
              {series.length === 1 ? <LabelList dataKey={s.key} position="top" fontSize={10} fill="var(--color-muted)" formatter={(v: unknown) => (typeof v === "number" ? compact(v, format) : "n/a")} /> : null}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
    <SeriesLegend series={series} />
    </>
  );
}

/** Line chart on one axis (e.g. margins in %, or working-capital days). Missing values break the line. */
export function LinesChart({ data, series, format = "percent", height = 240 }: { data: Row[]; series: SeriesDef[]; format?: MetricFormat; height?: number }) {
  return (
    <>
    <div style={{ height }} role="img" aria-label={`Line chart of ${series.map((s) => s.label).join(", ")}`}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-chart-grid)" />
          <XAxis dataKey="period" {...axisProps} />
          <YAxis {...axisProps} width={48} tickFormatter={(v) => compact(v, format)} />
          <Tooltip content={<TooltipBox format={format} />} />
          {series.map((s, i) => (
            <Line key={s.key} dataKey={s.key} name={s.label} stroke={SERIES[i % SERIES.length]} strokeWidth={2} connectNulls={false}
              dot={{ r: 4, strokeWidth: 2, stroke: "var(--color-surface)", fill: SERIES[i % SERIES.length] }} activeDot={{ r: 5 }} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
    <SeriesLegend series={series} />
    </>
  );
}

export interface WaterfallStep { label: string; value: number; kind: "total" | "decrease" | "increase" }

/** Profitability waterfall for one period: totals are anchored at zero; movements float between running totals. */
export function Waterfall({ steps, currency, unit, height = 300 }: { steps: WaterfallStep[]; currency?: string; unit?: string; height?: number }) {
  let running = 0;
  const data = steps.map((s) => {
    if (s.kind === "total") { running = s.value; return { label: s.label, base: Math.min(0, s.value), span: Math.abs(s.value), value: s.value, kind: s.kind }; }
    const start = running;
    running = s.kind === "decrease" ? running - s.value : running + s.value;
    return { label: s.label, base: Math.min(start, running), span: Math.abs(running - start), value: s.kind === "decrease" ? -s.value : s.value, kind: s.kind };
  });
  const color = (k: string) => (k === "total" ? "var(--color-series-1)" : k === "decrease" ? "var(--color-series-2)" : "var(--color-series-3)");
  return (
    <>
    <div style={{ height }} role="img" aria-label="Profitability waterfall">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-chart-grid)" />
          <XAxis dataKey="label" {...axisProps} interval={0} fontSize={10} angle={-35} textAnchor="end" height={64} />
          <YAxis {...axisProps} width={56} tickFormatter={(v) => compact(v, "amount")} />
          <Tooltip cursor={{ fill: "var(--color-subtle)" }} formatter={(v: unknown, name: unknown, item: { payload?: { value: number } }) =>
            name === "span" ? [formatMetric(item.payload?.value ?? 0, "amount", currency, unit), "Amount"] : [null, null]} />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="span" stackId="w" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => <Cell key={i} fill={color(d.kind)} />)}
            <LabelList dataKey="value" position="top" fontSize={10} fill="var(--color-muted)" formatter={(v: unknown) => (typeof v === "number" ? compact(v, "amount") : "")} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
      <p className="mt-1 flex flex-wrap gap-4 text-xs text-muted">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--color-series-1)]" />Total</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--color-series-2)]" />Cost / decrease</span>
      </p>
    </>
  );
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: "var(--color-danger)", high: "#c2410c", medium: "var(--color-warning)", low: "var(--color-info)", informational: "var(--color-faint)",
};

/** Horizontal counts by severity; status colours are always paired with the text label. */
export function SeverityBars({ counts }: { counts: { severity: string; count: number }[] }) {
  return (
    <div style={{ height: 40 + counts.length * 30 }} role="img" aria-label="Red flags by severity">
      <ResponsiveContainer>
        <BarChart data={counts} layout="vertical" margin={{ top: 0, right: 32, left: 8, bottom: 0 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="severity" {...axisProps} width={96} tickFormatter={(s: string) => s[0].toUpperCase() + s.slice(1)} />
          <Tooltip cursor={{ fill: "var(--color-subtle)" }} formatter={(v: unknown) => [String(v), "Flags"]} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
            {counts.map((c) => <Cell key={c.severity} fill={SEVERITY_COLOR[c.severity] ?? "var(--color-faint)"} />)}
            <LabelList dataKey="count" position="right" fontSize={11} fill="var(--color-ink)" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface RangeRow { label: string; low: number; base: number; high: number }

/** Valuation "football field": horizontal low–high ranges with the base case labelled. One value axis. */
export function ValuationRange({ rows, currency, unit }: { rows: RangeRow[]; currency: string; unit: string }) {
  const data = rows.map((r) => ({ label: r.label, base: Math.min(r.low, r.high), span: Math.abs(r.high - r.low), mid: r.base, low: r.low, high: r.high }));
  return (
    <div style={{ height: 60 + rows.length * 44 }} role="img" aria-label="Valuation range by method">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 48, left: 8, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke="var(--color-chart-grid)" />
          <XAxis type="number" {...axisProps} tickFormatter={(v) => compact(v, "amount")} domain={["auto", "auto"]} />
          <YAxis type="category" dataKey="label" {...axisProps} width={150} />
          <Tooltip cursor={{ fill: "var(--color-subtle)" }} content={({ active, payload }) => active && payload?.[0] ? (
            <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-md">
              <p className="font-medium">{(payload[0].payload as { label: string }).label}</p>
              {(["low", "mid", "high"] as const).map((k) => <p key={k} className="tabular">{k === "mid" ? "Base" : k[0].toUpperCase() + k.slice(1)}: {formatMetric((payload[0].payload as Record<string, number>)[k], "amount", currency, unit)}</p>)}
            </div>) : null} />
          <Bar dataKey="base" stackId="r" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="span" stackId="r" fill="var(--color-series-1)" radius={4} maxBarSize={18} isAnimationActive={false}>
            <LabelList dataKey="mid" position="right" fontSize={10} fill="var(--color-ink)" formatter={(v: unknown) => (typeof v === "number" ? `base ${compact(v, "amount")}` : "")} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
