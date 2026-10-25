import { equityBridge, type BridgeItem, type EquityBridge, type Scenario } from "./common";

export interface DcfInput {
  currency: string;
  baseYearLabel: string;
  baseRevenue: number;
  baseNetWorkingCapital: number;       // NWC at the end of the base year
  years: number;                       // forecast years (1–15)
  revenueGrowth: number[];             // per forecast year, fraction
  ebitdaMargin: number[];
  daPctRevenue: number[];
  capexPctRevenue: number[];
  nwcPctRevenue: number[];             // closing NWC as % of revenue
  taxRate: number;
  wacc: number;
  terminalGrowth: number;
  midYear: boolean;
  netDebt: number | null;
  otherBridgeItems: BridgeItem[];
}

export interface DcfYear {
  year: number; label: string; revenue: number; ebitda: number; da: number; ebit: number; taxes: number; nopat: number;
  capex: number; nwc: number; changeInNwc: number; ufcf: number; discountFactor: number; presentValue: number;
}

export interface DcfOutput {
  valid: boolean;
  errors: string[];
  warnings: string[];
  years: DcfYear[];
  sumPvForecast: number | null;
  terminalValue: number | null;
  pvTerminalValue: number | null;
  enterpriseValue: number | null;
  terminalValueShare: number | null;
  bridge: EquityBridge | null;
  scenarios: { enterpriseValue: Scenario; equityValue: Scenario; assumptions: { low: [number, number]; base: [number, number]; high: [number, number] } };
  sensitivity: { waccs: number[]; growths: number[]; values: (number | null)[][] };
}

const range = (x: number, lo: number, hi: number) => Number.isFinite(x) && x >= lo && x <= hi;

export function validateDcf(i: DcfInput): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!Number.isInteger(i.years) || i.years < 1 || i.years > 15) errors.push("Forecast period must be 1–15 years.");
  for (const [name, arr] of [["Revenue growth", i.revenueGrowth], ["EBITDA margin", i.ebitdaMargin], ["D&A % revenue", i.daPctRevenue],
    ["Capex % revenue", i.capexPctRevenue], ["NWC % revenue", i.nwcPctRevenue]] as const) {
    if (arr.length !== i.years) errors.push(`${name} needs one value per forecast year (${i.years}).`);
    if (arr.some((v) => !Number.isFinite(v))) errors.push(`${name} contains an invalid number.`);
  }
  if (!(i.baseRevenue > 0)) errors.push("Base-year revenue must be positive.");
  if (!Number.isFinite(i.baseNetWorkingCapital)) errors.push("Base-year net working capital is required.");
  if (!range(i.wacc, 0.01, 0.5)) errors.push("WACC must be between 1% and 50%.");
  if (!range(i.terminalGrowth, -0.05, 0.1)) errors.push("Terminal growth must be between −5% and 10%.");
  if (Number.isFinite(i.wacc) && Number.isFinite(i.terminalGrowth) && i.wacc <= i.terminalGrowth) errors.push("WACC must exceed the terminal growth rate (Gordon Growth Method).");
  if (!range(i.taxRate, 0, 0.6)) errors.push("Tax rate must be between 0% and 60%.");
  if (i.revenueGrowth.some((g) => !range(g, -0.9, 2))) errors.push("Revenue growth assumptions must be between −90% and 200%.");
  if (i.ebitdaMargin.some((m) => !range(m, -1, 0.9))) errors.push("EBITDA margins must be between −100% and 90%.");
  if (i.daPctRevenue.some((v) => !range(v, 0, 0.5)) || i.capexPctRevenue.some((v) => !range(v, 0, 0.8))) errors.push("D&A and capex must be non-negative percentages of revenue (≤ 50% / 80%).");
  if (i.terminalGrowth > 0.04) warnings.push("Terminal growth above 4% exceeds typical long-run nominal growth assumptions.");
  if (i.revenueGrowth.some((g) => g > 0.5)) warnings.push("Some revenue growth assumptions exceed 50% per year.");
  if (i.ebitdaMargin.some((m) => m < 0)) warnings.push("Negative EBITDA margins in the forecast.");
  return { errors, warnings };
}

/** Enterprise value for given WACC and terminal growth, or null if invalid (used for the grid and scenarios). */
function evAt(i: DcfInput, wacc: number, g: number): { ev: number; years: DcfYear[]; tv: number; pvTv: number; sumPv: number } | null {
  if (!(wacc > g) || wacc <= 0) return null;
  const years: DcfYear[] = [];
  let revenue = i.baseRevenue;
  let prevNwc = i.baseNetWorkingCapital;
  const baseYear = Number(i.baseYearLabel.replace(/\D/g, "")) || 0;
  for (let t = 1; t <= i.years; t++) {
    revenue = revenue * (1 + i.revenueGrowth[t - 1]);
    const ebitda = revenue * i.ebitdaMargin[t - 1];
    const da = revenue * i.daPctRevenue[t - 1];
    const ebit = ebitda - da;
    const taxes = Math.max(ebit, 0) * i.taxRate;   // no tax credit modelled on losses (conservative simplification)
    const nopat = ebit - taxes;
    const capex = revenue * i.capexPctRevenue[t - 1];
    const nwc = revenue * i.nwcPctRevenue[t - 1];
    const changeInNwc = nwc - prevNwc;
    prevNwc = nwc;
    const ufcf = nopat + da - capex - changeInNwc;
    const discountFactor = 1 / Math.pow(1 + wacc, i.midYear ? t - 0.5 : t);
    years.push({ year: t, label: baseYear ? `FY${baseYear + t}E` : `Year ${t}`, revenue, ebitda, da, ebit, taxes, nopat, capex, nwc, changeInNwc, ufcf, discountFactor, presentValue: ufcf * discountFactor });
  }
  const last = years[years.length - 1];
  const tv = (last.ufcf * (1 + g)) / (wacc - g);
  const pvTv = tv / Math.pow(1 + wacc, i.years);     // terminal value discounted from the end of the final year
  const sumPv = years.reduce((s, y) => s + y.presentValue, 0);
  return { ev: sumPv + pvTv, years, tv, pvTv, sumPv };
}

const round4 = (x: number) => Math.round(x * 10000) / 10000;

export function valueDcf(i: DcfInput): DcfOutput {
  const { errors, warnings } = validateDcf(i);
  const empty = { enterpriseValue: { low: null, base: null, high: null }, equityValue: { low: null, base: null, high: null },
    assumptions: { low: [i.wacc + 0.01, i.terminalGrowth - 0.005] as [number, number], base: [i.wacc, i.terminalGrowth] as [number, number], high: [i.wacc - 0.01, i.terminalGrowth + 0.005] as [number, number] } };
  if (errors.length) {
    return { valid: false, errors, warnings, years: [], sumPvForecast: null, terminalValue: null, pvTerminalValue: null, enterpriseValue: null,
      terminalValueShare: null, bridge: null, scenarios: empty, sensitivity: { waccs: [], growths: [], values: [] } };
  }
  const base = evAt(i, i.wacc, i.terminalGrowth)!;
  if (base.years[base.years.length - 1].ufcf <= 0) warnings.push("Final-year UFCF is not positive; the Gordon Growth terminal value is not meaningful.");
  const share = base.ev !== 0 ? base.pvTv / base.ev : null;
  if (share !== null && share > 0.85) warnings.push(`Terminal value is ${(share * 100).toFixed(0)}% of enterprise value; the result is highly sensitive to terminal assumptions.`);
  const waccs = [-0.02, -0.01, 0, 0.01, 0.02].map((d) => round4(i.wacc + d));
  const growths = [-0.01, -0.005, 0, 0.005, 0.01].map((d) => round4(i.terminalGrowth + d));
  const values = waccs.map((w) => growths.map((g) => evAt(i, w, g)?.ev ?? null));
  const sc = empty.assumptions;
  const low = evAt(i, sc.low[0], sc.low[1])?.ev ?? null;
  const high = evAt(i, sc.high[0], sc.high[1])?.ev ?? null;
  const bridge = equityBridge(base.ev, i.netDebt, i.otherBridgeItems);
  const eq = (v: number | null) => (v === null ? null : equityBridge(v, i.netDebt, i.otherBridgeItems).equityValue);
  if (i.netDebt === null) warnings.push("Net debt is unavailable; implied equity value is not shown.");
  return {
    valid: true, errors, warnings, years: base.years, sumPvForecast: base.sumPv, terminalValue: base.tv, pvTerminalValue: base.pvTv,
    enterpriseValue: base.ev, terminalValueShare: share, bridge,
    scenarios: { enterpriseValue: { low, base: base.ev, high }, equityValue: { low: eq(low), base: bridge.equityValue, high: eq(high) }, assumptions: sc },
    sensitivity: { waccs, growths, values },
  };
}
