/**
 * EBITDA normalisation bridge: Reported EBITDA + approved adjustments = Adjusted EBITDA.
 * Proposed and rejected adjustments are reported separately and never included.
 */
export interface Adjustment {
  id: string; financial_period_id: string; adjustment_type: string; description: string; amount: number; sign: 1 | -1;
  status: "proposed" | "approved" | "rejected"; currency: string;
}

export interface BridgeRow {
  periodId: string;
  periodLabel: string;
  baseEbitda: number | null;
  baseBasis: string | null;
  approved: number;
  proposed: number;
  rejected: number;
  adjustedEbitda: number | null;
  approvedItems: Adjustment[];
  unavailableReason?: string;
  currencyMismatch: boolean;
}

export function signedAmount(a: Pick<Adjustment, "amount" | "sign">): number {
  return Number(a.amount) * a.sign;
}

export function buildBridge(
  periods: { id: string; label: string }[], ebitda: Record<string, { value: number | null; basis: string | null }>,
  adjustments: Adjustment[], currency: string,
): BridgeRow[] {
  return periods.map((p) => {
    const mine = adjustments.filter((a) => a.financial_period_id === p.id);
    const sum = (s: Adjustment["status"]) => mine.filter((a) => a.status === s).reduce((t, a) => t + signedAmount(a), 0);
    const currencyMismatch = mine.some((a) => a.currency !== currency);
    const base = ebitda[p.id]?.value ?? null;
    const approved = sum("approved");
    let reason: string | undefined;
    if (base === null) reason = "EBITDA is unavailable for this period, so Adjusted EBITDA cannot be calculated.";
    else if (currencyMismatch) reason = "An adjustment is in a different currency from the submission; convert it before including it.";
    return {
      periodId: p.id, periodLabel: p.label, baseEbitda: base, baseBasis: ebitda[p.id]?.basis ?? null,
      approved, proposed: sum("proposed"), rejected: sum("rejected"),
      adjustedEbitda: reason ? null : (base as number) + approved,
      approvedItems: mine.filter((a) => a.status === "approved"), unavailableReason: reason, currencyMismatch,
    };
  });
}
