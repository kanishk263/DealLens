import { describe, expect, it } from "vitest";
import { valueDcf, type DcfInput } from "@/lib/valuation/dcf";
import { valueComparables, type Comparable, type ComparablesInput } from "@/lib/valuation/comparables";
import { equityBridge, quantile } from "@/lib/valuation/common";

const dcfBase: DcfInput = {
  currency: "USD", baseYearLabel: "FY2024", baseRevenue: 1000, baseNetWorkingCapital: 100, years: 1,
  revenueGrowth: [0.1], ebitdaMargin: [0.2], daPctRevenue: [0.05], capexPctRevenue: [0.05], nwcPctRevenue: [0.1],
  taxRate: 0.25, wacc: 0.1, terminalGrowth: 0.02, midYear: false, netDebt: 300, otherBridgeItems: [],
};

describe("DCF", () => {
  it("matches a hand-computed one-year model", () => {
    // Revenue 1100; EBITDA 220; D&A 55; EBIT 165; tax 41.25; NOPAT 123.75; capex 55; ΔNWC 110−100 = 10
    // UFCF = 123.75 + 55 − 55 − 10 = 113.75; PV = 113.75/1.1 = 103.409…
    // TV = 113.75 × 1.02 / 0.08 = 1450.3125; PV(TV) = 1318.4659…; EV = 1421.875
    const r = valueDcf(dcfBase);
    expect(r.valid).toBe(true);
    expect(r.years[0].ufcf).toBeCloseTo(113.75, 10);
    expect(r.terminalValue).toBeCloseTo(1450.3125, 10);
    expect(r.enterpriseValue).toBeCloseTo(1421.875, 8);
    expect(r.bridge?.equityValue).toBeCloseTo(1121.875, 8);
    expect(r.years[0].label).toBe("FY2025E");
  });

  it("applies the mid-year convention to forecast cash flows only", () => {
    const r = valueDcf({ ...dcfBase, midYear: true });
    expect(r.years[0].discountFactor).toBeCloseTo(1 / Math.sqrt(1.1), 12);
    expect(r.pvTerminalValue).toBeCloseTo(1450.3125 / 1.1, 8);
  });

  it("rejects WACC ≤ terminal growth", () => {
    const r = valueDcf({ ...dcfBase, wacc: 0.03, terminalGrowth: 0.03 });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/WACC must exceed/);
    expect(r.enterpriseValue).toBeNull();
  });

  it("rejects missing periods, invalid ranges and negative capex", () => {
    expect(valueDcf({ ...dcfBase, years: 2 }).errors.join(" ")).toMatch(/one value per forecast year/);
    expect(valueDcf({ ...dcfBase, taxRate: 0.9 }).valid).toBe(false);
    expect(valueDcf({ ...dcfBase, capexPctRevenue: [-0.1] }).valid).toBe(false);
    expect(valueDcf({ ...dcfBase, baseRevenue: 0 }).valid).toBe(false);
  });

  it("marks sensitivity cells invalid where WACC ≤ g and centres the grid on the base case", () => {
    const r = valueDcf({ ...dcfBase, wacc: 0.04, terminalGrowth: 0.02 });
    expect(r.sensitivity.values[2][2]).toBeCloseTo(r.enterpriseValue!, 8);
    // wacc 2% vs g 2.5% / 3% → invalid
    expect(r.sensitivity.values[0][3]).toBeNull();
    expect(r.sensitivity.values[0][4]).toBeNull();
  });

  it("orders scenarios low < base < high and warns on dominant terminal value", () => {
    const r = valueDcf({ ...dcfBase, wacc: 0.07, years: 3, revenueGrowth: [0.1, 0.1, 0.1], ebitdaMargin: [0.2, 0.2, 0.2], daPctRevenue: [0.05, 0.05, 0.05], capexPctRevenue: [0.05, 0.05, 0.05], nwcPctRevenue: [0.1, 0.1, 0.1] });
    const s = r.scenarios.enterpriseValue;
    expect(s.low!).toBeLessThan(s.base!);
    expect(s.base!).toBeLessThan(s.high!);
    expect(r.warnings.some((w) => /Terminal value is/.test(w))).toBe(true);
  });

  it("does not show equity value without net debt", () => {
    const r = valueDcf({ ...dcfBase, netDebt: null });
    expect(r.bridge?.equityValue).toBeNull();
    expect(r.scenarios.equityValue.base).toBeNull();
  });

  it("does not apply tax credits to losses", () => {
    const r = valueDcf({ ...dcfBase, ebitdaMargin: [-0.1] });
    expect(r.years[0].taxes).toBe(0);
  });
});

const comp = (name: string, ev: number, ebitda: number | null, revenue = 1000, extra: Partial<Comparable> = {}): Comparable =>
  ({ name, enterpriseValue: ev, ebitda, revenue, currency: "USD", source: "Analyst-entered sample", included: true, ...extra });

const compsBase: ComparablesInput = {
  currency: "USD", multiple: "ev_ebitda", targetMetricValue: 100, targetMetricLabel: "EBITDA", netDebt: 150, otherBridgeItems: [],
  comparables: [comp("A", 800, 100), comp("B", 1000, 100), comp("C", 1200, 100), comp("D", 1400, 100)],
};

describe("comparables", () => {
  it("computes multiples, quartiles and implied values", () => {
    const r = valueComparables(compsBase);
    expect(r.stats.ev_ebitda).toMatchObject({ count: 4, mean: 11, median: 11, min: 8, max: 14 });
    expect(r.selectedMultiples.low).toBeCloseTo(9.5);
    expect(r.selectedMultiples.high).toBeCloseTo(12.5);
    expect(r.impliedEnterpriseValue.base).toBeCloseTo(1100);
    expect(r.impliedEquityValue.base).toBeCloseTo(950);
  });

  it("excludes invalid observations with visible reasons", () => {
    const r = valueComparables({ ...compsBase, comparables: [...compsBase.comparables, comp("Neg", 900, -50), comp("EUR", 900, 90, 1000, { currency: "EUR" }), comp("Out", 5000, 100, 1000, { included: false, exclusionReason: "Outlier" })] });
    const reasons = Object.fromEntries(r.comps.map((c) => [c.name, c.excludedReason]));
    expect(reasons.Neg).toMatch(/negative/);
    expect(reasons.EUR).toMatch(/Currency/);
    expect(reasons.Out).toMatch(/Outlier/);
    expect(r.stats.ev_ebitda.count).toBe(4);
  });

  it("requires a positive target metric and justified overrides", () => {
    expect(valueComparables({ ...compsBase, targetMetricValue: -10 }).errors.join(" ")).toMatch(/zero or negative/);
    expect(valueComparables({ ...compsBase, baseMultipleOverride: 10, overrideJustification: "" }).errors.length).toBe(1);
    expect(valueComparables({ ...compsBase, baseMultipleOverride: 10, overrideJustification: "Closest peer by size and margin" }).impliedEnterpriseValue.base).toBe(1000);
  });

  it("warns on small samples and labels data as unverified", () => {
    const r = valueComparables({ ...compsBase, comparables: compsBase.comparables.slice(0, 2) });
    expect(r.warnings.join(" ")).toMatch(/not statistically robust/);
    expect(r.warnings.join(" ")).toMatch(/not verified market data/);
  });

  it("supports EV/Revenue", () => {
    const r = valueComparables({ ...compsBase, multiple: "ev_revenue", targetMetricValue: 500 });
    expect(r.stats.ev_revenue.median).toBeCloseTo(1.1);
    expect(r.impliedEnterpriseValue.base).toBeCloseTo(550);
  });
});

describe("helpers", () => {
  it("bridges EV to equity with explicit items", () => {
    expect(equityBridge(1000, 200, [{ label: "Minority interest", amount: 50 }]).equityValue).toBe(750);
    expect(equityBridge(1000, -100).equityValue).toBe(1100); // net cash increases equity
  });
  it("interpolates quantiles", () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75);
  });
});
