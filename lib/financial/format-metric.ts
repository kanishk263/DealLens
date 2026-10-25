import { formatAmount, formatDays, formatMultiple, formatPercent } from "@/lib/utilities/format";
import type { MetricFormat } from "./metric-definitions";

export function formatMetric(value: number | null | undefined, format: MetricFormat, currency?: string, unit?: string): string {
  if (value === null || value === undefined) return "—";
  switch (format) {
    case "percent": return formatPercent(value);
    case "pp": return `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1)} pp`;
    case "days": return formatDays(value);
    case "multiple": return formatMultiple(value);
    default: return formatAmount(value, currency, unit);
  }
}
