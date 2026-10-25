import { equityBridge, quantile, type BridgeItem, type EquityBridge, type Scenario } from "./common";

export interface Comparable {
  name: string; industry?: string; revenue: number | null; ebitda: number | null; enterpriseValue: number | null;
  equityValue?: number | null; netDebt?: number | null; currency: string; reportingDate?: string; source: string; notes?: string;
  included: boolean; exclusionReason?: string;
}

export interface ComparablesInput {
  currency: string;
  multiple: "ev_ebitda" | "ev_revenue";
  targetMetricValue: number | null;        // e.g. selected (adjusted) EBITDA of the target
  targetMetricLabel: string;
  netDebt: number | null;
  otherBridgeItems: BridgeItem[];
  baseMultipleOverride?: number | null;    // analyst-selected multiple (must be justified)
  overrideJustification?: string;
  comparables: Comparable[];
}

export interface CompResult {
  name: string; evEbitda: number | null; evRevenue: number | null; valid: boolean; excludedReason: string | null;
}

export interface MultipleStats { count: number; mean: number | null; median: number | null; p25: number | null; p75: number | null; min: number | null; max: number | null }

export interface ComparablesOutput {
  comps: CompResult[];
  stats: { ev_ebitda: MultipleStats; ev_revenue: MultipleStats };
  selectedMultiples: Scenario;
  impliedEnterpriseValue: Scenario;
  impliedEquityValue: Scenario;
  bridge: { low: EquityBridge | null; base: EquityBridge | null; high: EquityBridge | null };
  errors: string[];
  warnings: string[];
}

function stats(values: number[]): MultipleStats {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return { count: 0, mean: null, median: null, p25: null, p75: null, min: null, max: null };
  return { count: s.length, mean: s.reduce((a, b) => a + b, 0) / s.length, median: quantile(s, 0.5), p25: quantile(s, 0.25), p75: quantile(s, 0.75), min: s[0], max: s[s.length - 1] };
}

/** Comparable-company valuation. Low/base/high = 25th percentile / median / 75th percentile of the valid included set. */
export function valueComparables(input: ComparablesInput): ComparablesOutput {
  const errors: string[] = [];
  const warnings: string[] = [
    "Comparable data is entered manually by analysts and is not verified market data.",
  ];
  const comps: CompResult[] = input.comparables.map((c) => {
    const reasons: string[] = [];
    if (!c.included) reasons.push(`Excluded by analyst${c.exclusionReason ? `: ${c.exclusionReason}` : ""}`);
    if (c.currency !== input.currency) reasons.push(`Currency ${c.currency} differs from ${input.currency}`);
    if (c.enterpriseValue === null || !(c.enterpriseValue > 0)) reasons.push("Enterprise value missing or not positive");
    const evEbitda = c.enterpriseValue && c.ebitda && c.ebitda > 0 ? c.enterpriseValue / c.ebitda : null;
    const evRevenue = c.enterpriseValue && c.revenue && c.revenue > 0 ? c.enterpriseValue / c.revenue : null;
    if (input.multiple === "ev_ebitda" && evEbitda === null && reasons.length === 0) reasons.push("EBITDA missing, zero or negative: EV/EBITDA not meaningful");
    if (input.multiple === "ev_revenue" && evRevenue === null && reasons.length === 0) reasons.push("Revenue missing or not positive");
    return { name: c.name, evEbitda, evRevenue, valid: reasons.length === 0, excludedReason: reasons.length ? reasons.join("; ") : null };
  });
  const valid = comps.filter((c) => c.valid);
  const st = {
    ev_ebitda: stats(valid.map((c) => c.evEbitda).filter((v): v is number => v !== null)),
    ev_revenue: stats(valid.map((c) => c.evRevenue).filter((v): v is number => v !== null)),
  };
  const s = st[input.multiple];
  if (s.count === 0) errors.push("No valid comparables in the selected set.");
  else if (s.count < 3) warnings.push(`Only ${s.count} valid comparable(s); the range is not statistically robust.`);
  if (input.targetMetricValue === null || !Number.isFinite(input.targetMetricValue)) errors.push(`Target ${input.targetMetricLabel} is not available.`);
  else if (input.targetMetricValue <= 0) errors.push(`Target ${input.targetMetricLabel} is zero or negative; a multiple-based valuation is not meaningful.`);
  if (input.baseMultipleOverride != null) {
    if (!(input.baseMultipleOverride > 0)) errors.push("The selected base multiple must be positive.");
    if (!input.overrideJustification || input.overrideJustification.trim().length < 10) errors.push("Justify the selected base multiple (10+ characters).");
  }
  const sel: Scenario = errors.length || s.count === 0 ? { low: null, base: null, high: null }
    : { low: s.p25, base: input.baseMultipleOverride ?? s.median, high: s.p75 };
  const ev = (m: number | null) => (m === null || input.targetMetricValue === null ? null : m * input.targetMetricValue);
  const impliedEV: Scenario = { low: ev(sel.low), base: ev(sel.base), high: ev(sel.high) };
  const b = (v: number | null) => (v === null ? null : equityBridge(v, input.netDebt, input.otherBridgeItems));
  const bridge = { low: b(impliedEV.low), base: b(impliedEV.base), high: b(impliedEV.high) };
  if (input.netDebt === null && !errors.length) warnings.push("Net debt is unavailable; only enterprise value is shown.");
  return {
    comps, stats: st, selectedMultiples: sel, impliedEnterpriseValue: impliedEV,
    impliedEquityValue: { low: bridge.low?.equityValue ?? null, base: bridge.base?.equityValue ?? null, high: bridge.high?.equityValue ?? null },
    bridge, errors, warnings,
  };
}
