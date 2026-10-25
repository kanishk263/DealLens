export type ReportingUnit = "units" | "thousands" | "millions";

const UNIT_SUFFIX: Record<ReportingUnit, string> = { units: "", thousands: "k", millions: "m" };

export function formatAmount(value: number | null | undefined, currency?: string | null, unit?: string | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: Math.abs(value) < 100 ? 1 : 0 }).format(Math.abs(value));
  const suffix = unit && unit in UNIT_SUFFIX ? UNIT_SUFFIX[unit as ReportingUnit] : "";
  const body = `${currency ? currency + " " : ""}${formatted}${suffix}`;
  return value < 0 ? `(${body})` : body;
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatMultiple(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}x`;
}

export function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${Math.round(value)} days`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export const UNIT_LABEL: Record<string, string> = { units: "", thousands: "thousands", millions: "millions" };
