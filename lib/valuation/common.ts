export const ENGINE_VERSION = "valuation-v1";

export interface BridgeItem { label: string; amount: number }  // positive amounts are deducted from EV (e.g. minority interests)

export interface EquityBridge {
  enterpriseValue: number;
  netDebt: number | null;
  otherItems: BridgeItem[];
  equityValue: number | null;
  reason?: string;
}

/** Enterprise value → equity value. Requires net debt; other bridge items must be stated explicitly. */
export function equityBridge(ev: number, netDebt: number | null | undefined, other: BridgeItem[] = []): EquityBridge {
  if (netDebt === null || netDebt === undefined || !Number.isFinite(netDebt)) {
    return { enterpriseValue: ev, netDebt: null, otherItems: other, equityValue: null, reason: "Net debt is not available, so equity value cannot be derived." };
  }
  const deductions = other.reduce((s, i) => s + i.amount, 0);
  return { enterpriseValue: ev, netDebt, otherItems: other, equityValue: ev - netDebt - deductions };
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface Scenario { low: number | null; base: number | null; high: number | null }
