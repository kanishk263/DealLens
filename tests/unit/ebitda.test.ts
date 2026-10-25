import { describe, expect, it } from "vitest";
import { buildBridge, type Adjustment } from "@/lib/financial/ebitda";

const periods = [{ id: "p1", label: "FY2023" }, { id: "p2", label: "FY2024" }];
const adj = (o: Partial<Adjustment>): Adjustment => ({ id: Math.random().toString(), financial_period_id: "p2", adjustment_type: "restructuring",
  description: "x", amount: 100, sign: 1, status: "approved", currency: "USD", ...o });

describe("EBITDA bridge", () => {
  it("adds only approved adjustments, with sign", () => {
    const rows = buildBridge(periods, { p1: { value: 1000, basis: "reported" }, p2: { value: 1200, basis: "calculated" } }, [
      adj({ amount: 150 }), adj({ amount: 40, sign: -1 }), adj({ amount: 500, status: "proposed" }), adj({ amount: 70, status: "rejected" }),
    ], "USD");
    expect(rows[1]).toMatchObject({ baseEbitda: 1200, approved: 110, proposed: 500, rejected: 70, adjustedEbitda: 1310 });
    expect(rows[0]).toMatchObject({ approved: 0, adjustedEbitda: 1000 });
  });
  it("is unavailable when EBITDA is missing", () => {
    const [r] = buildBridge([periods[0]], { p1: { value: null, basis: null } }, [], "USD");
    expect(r.adjustedEbitda).toBeNull();
    expect(r.unavailableReason).toMatch(/unavailable/);
  });
  it("handles negative EBITDA arithmetically without hiding it", () => {
    const [r] = buildBridge([periods[0]], { p1: { value: -300, basis: "calculated" } }, [adj({ financial_period_id: "p1", amount: 100 })], "USD");
    expect(r.adjustedEbitda).toBe(-200);
  });
  it("refuses to combine adjustments in another currency", () => {
    const [r] = buildBridge([periods[1]], { p2: { value: 1000, basis: "reported" } }, [adj({ currency: "EUR" })], "USD");
    expect(r.adjustedEbitda).toBeNull();
    expect(r.currencyMismatch).toBe(true);
  });
});
