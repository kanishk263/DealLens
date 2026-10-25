# Financial methodology

This document defines every figure DealLens calculates. Implementation: `processing/deallens_worker/financial/`
(metrics, red flags), `processing/deallens_worker/validation/` (reconciliations, data quality),
`lib/financial/ebitda.ts` (EBITDA bridge) and `lib/valuation/` (valuation). Formula version: **v1**.

> All outputs are analytical estimates produced from the data provided. Automated metrics are **preliminary** until
> an analyst reviews them and they are included in an approved, published report.

## 1. From documents to standard categories

1. **Extraction** keeps the original label, the exact source text (`raw_value`), the parsed number and the source
   coordinates (Excel sheet + cell; CSV row + column; PDF page + table/line + row + column). If coordinates are not
   available the UI says so ("coordinates unavailable") rather than inventing a reference.
2. **Parsing conventions**: parentheses or a trailing minus denote negatives; dashes denote nil (0); currency symbols
   and thousands separators are ignored; percentage cells are treated as ratios and **not** imported as values
   (DealLens recalculates ratios); spreadsheet errors and formulas without cached values are flagged as invalid.
   Formulas are never evaluated.
3. **Periods** are read from column headers: `FY2023`, `2023`, `2023A/F/E/B`, `Budget 2024`, `Q1 2024`, `H1 2024`,
   month labels and dates. Annual labels are dated with the fiscal year-end taken from the submission's reporting-period
   end. Date headers are classified as annual/quarterly/monthly from their spacing. Budget and forecast columns are kept
   separate from actuals.
4. **Mapping** uses ordered, statement-aware rules (`normalization/rules.py`). Confidence ≥ 0.85 with no close
   alternative → `auto_mapped`; otherwise `needs_review`; no rule → `unmapped`. Only `auto_mapped`,
   `analyst_mapped` and `analyst_confirmed` items enter calculations. Schedule rows (revenue by customer/segment)
   always require analyst confirmation. Aggregate rows ("All other customers") are never treated as one customer.
5. **Normalisation** scales values to the submission unit (units / thousands / millions), stores expense categories
   (COGS, SG&A, R&D, other opex, D&A, interest, tax, capex) as positive magnitudes and **does not convert currencies**:
   values in another currency get no normalised value and raise a critical data-quality issue.
6. **Selection**: when a category has several values in one period, analyst-reviewed items win, then the highest
   confidence, then the earliest document. Disagreeing values (beyond tolerance) raise a *conflicting values* issue;
   values are never averaged.

**Tolerance** (rounding): `max(1 presentation unit, 0.1% × magnitude)`.

## 2. Profitability

| Metric | Definition |
|---|---|
| Gross profit | Reported if presented; otherwise Revenue − COGS. The recalculated figure is always kept separately. |
| Gross margin | Gross profit ÷ Revenue (unavailable if revenue ≤ 0) |
| EBIT | Reported operating profit; else **bottom-up** Net income + Taxes + Interest expense − Interest income; else **top-down** Gross profit − mapped operating expenses − D&A (flagged *warning*: completeness not verified) |
| EBITDA (reported) | As presented by the company |
| EBITDA (calculated) | EBIT + Depreciation & amortisation |
| EBITDA (headline) | Reported if presented, otherwise calculated. The basis is stored and displayed per period. The two definitions are never blended. |
| EBIT / EBITDA / Net margin | Measure ÷ Revenue |
| Margin change | Margin − prior comparable margin, in percentage points |
| Growth | Current ÷ prior comparable period − 1; unavailable if the prior value is ≤ 0 |
| Interest coverage | EBIT ÷ Interest expense (unavailable if interest = 0) |

**Comparable periods**: growth and averages use the immediately preceding *actual* period of the same type
(annual vs annual, quarterly vs quarterly). Non-comparable pairs produce "unavailable", never a silent comparison.

**Revenue CAGR**: `(last ÷ first)^(1/years) − 1` over consecutive annual actual periods with positive revenue at both ends.

**Forecast vs actual**: `actual ÷ plan − 1` where a budget/forecast column has the same period end as an actual column.

**Customer concentration**: largest confirmed customer ÷ revenue; top five ÷ revenue.

## 3. EBITDA normalisation

```
Base EBITDA (headline, basis shown)
+ Σ approved adjustments (signed: add-back +, deduction −)
= Adjusted EBITDA
```

- Adjustments are entered by analysts with type, description, positive amount, direction, currency (the period's),
  supporting evidence and rationale. DealLens never auto-classifies an expense as non-recurring.
- Status: `proposed` → `approved` / `rejected`. **Only approved** items enter Adjusted EBITDA; proposed and rejected
  totals are shown separately. The proposer cannot approve their own adjustment.
- Adjusted EBITDA is unavailable if base EBITDA is unavailable or an adjustment's currency differs from the submission.

## 4. Working capital

| Metric | Definition |
|---|---|
| Net working capital (accounting) | Total current assets − Total current liabilities |
| Operating working capital | (Current assets − Cash) − (Current liabilities − Short-term debt) |
| Trade working capital | Accounts receivable + Inventory − Accounts payable (inventory treated as nil with a *warning* if not reported) |
| DSO | Average AR ÷ Revenue × days |
| DIO | Average inventory ÷ COGS × days |
| DPO | Average AP ÷ COGS × days |
| Cash conversion cycle | DSO + DIO − DPO (DIO treated as 0 with a *warning* when unavailable) |

**Average balance** = (opening + closing) ÷ 2 where the prior comparable period's balance exists; otherwise the closing
balance is used and the basis is recorded. **Days convention**: actual calendar days in the period when its start and end
dates are known (e.g. 366 for FY2024); otherwise 365 (annual), 91 (quarterly) or 30 (monthly). Zero/negative
denominators make the metric unavailable.

## 5. Debt and leverage

- **Gross debt** = short-term borrowings + long-term borrowings *as mapped*. Lease liabilities, provisions, payables and
  other liabilities are **not** assumed to be interest-bearing debt. If only one component is mapped the result is a
  *warning*.
- **Net debt** = Gross debt − Cash and cash equivalents.
- **Debt / EBITDA** and **Net debt / EBITDA**: only for annual periods with positive EBITDA; otherwise unavailable with
  the reason (zero/negative EBITDA, missing, or not annual/LTM).

## 6. Cash flow

- Operating, investing and financing cash flows as reported.
- **Capital expenditure**: purchases of PP&E/fixed assets, stored as a positive magnitude.
- **Free cash flow (v1)** = Operating cash flow − Capital expenditure. Other definitions (after lease payments, after
  interest, levered/unlevered) exist; this convention is stated wherever FCF is shown.
- **OCF / EBITDA** and **FCF / EBITDA** only when EBITDA > 0.

## 7. Reconciliations

| Check | Test | Inputs |
|---|---|---|
| Balance sheet | Total assets = Total liabilities + Total equity (or reported total liabilities and equity) | must all be mapped |
| Cash roll-forward | Beginning cash + Net change in cash = Ending cash | beginning cash from the CF statement, else prior period closing cash |

Outcomes: `reconciled` (within tolerance), `variance` (with the amount), or `not_tested` (with the missing inputs).
An incomplete statement is never marked reconciled.

## 8. Data-quality checks

Missing statements (IS high; BS/CF medium); missing or non-consecutive periods; fewer than three annual periods (low);
periods outside the declared range (informational); duplicate period columns; conflicting or duplicate line items;
invalid numeric values (incl. formulas without cached values); mixed currencies (critical); inconsistent or scaled units;
missing revenue/profit (high); missing operating cash flow; negative revenue/assets/AR/inventory/cash ("requires
investigation"); mixed sign conventions for an expense; unmapped / uncertain mappings (internal); large
period-over-period movements (> 50%, illustrative); possible duplicate uploads (checksum); reconciliation variances (high)
and untested balance-sheet checks (informational); failed/unsupported documents (critical).

Every issue has severity, description, suggested resolution, source references and status. Analysts can acknowledge,
resolve or dismiss with notes; issues that disappear on re-analysis are auto-resolved with a note; analyst decisions are kept.

## 9. Red-flag rules

Thresholds live in `processing/config/thresholds.json`, each with a rationale and an `illustrative: true` marker. They
are screening levels for a demonstration, **not industry standards**. Every flag records the rule, observed value,
comparison value, threshold, period, source references, explanation, recommended follow-up and review status.

| Rule | Trigger (illustrative default) | Severity |
|---|---|---|
| Revenue decline | Lower than prior comparable period for 2 consecutive periods | High |
| Gross / EBITDA margin deterioration | Fall ≥ 3.0 pp period over period | Medium |
| OCF persistently below EBITDA | OCF/EBITDA < 70% in ≥ 2 periods | Medium |
| Receivables / inventory outpacing revenue | Growth exceeds revenue growth by ≥ 15 pp | Medium |
| Working-capital absorption | ΔTrade working capital > 5% of revenue | Medium |
| High leverage | Net debt / EBITDA > 3.5x | High |
| Negative free cash flow | FCF < 0 in ≥ 2 periods | High |
| Large unexplained movement | Change > 50% and > 5% of revenue | Low |
| Significant EBITDA adjustments | Proposed + approved > 10% of EBITDA | Medium |
| Balance-sheet reconciliation failure | Variance beyond tolerance | High |
| Material data gaps | Missing statements or < 2 periods | Medium |
| Customer concentration | Top customer > 20% or top five > 50% | Medium |
| Reported vs recalculated | Gross profit or EBITDA differs by > 2% | Medium |

Analysts can dismiss, resolve or escalate a flag with a mandatory explanation; review status survives re-analysis.
A red flag indicates a matter requiring investigation, **not** proof of fraud, misrepresentation or misconduct.
Where the data cannot establish a driver, the flag says so and labels the item an area for investigation.

## 10. Valuation (engine `valuation-v1`, `lib/valuation/`)

Valuations are **analytical estimates** under stated assumptions, not guarantees of transaction price or return.
Every save creates an immutable model version storing inputs, assumptions, outputs, engine version, author and review
status. Outputs are **recomputed on the server** from validated inputs at save time (browser previews are discarded),
and the model list re-runs the engine on stored inputs to show whether each version reproduces.

### 10.1 Comparable companies
- Comparables are entered manually with a mandatory source. DealLens provides no market data; sample values are not
  verified market data.
- Multiples: `EV / EBITDA` and `EV / Revenue`.
- Invalid observations are excluded with a visible reason: excluded by analyst (with reason), currency different from the
  target, EV missing/non-positive, EBITDA ≤ 0 (EV/EBITDA not meaningful), revenue ≤ 0.
- Statistics over the valid included set: count, mean, median, 25th/75th percentiles (linear interpolation), min, max.
  Fewer than three valid comparables → warning.
- Selection: **low = P25, base = median, high = P75**. The analyst may override the base multiple only with a written
  justification.
- `Implied EV = selected multiple × target metric`. The target metric defaults to Adjusted EBITDA when approved
  adjustments exist, otherwise the headline EBITDA; it must be positive.

### 10.2 Discounted cash flow
```
Revenue_t = Revenue_{t−1} × (1 + g_t)
EBITDA_t  = Revenue_t × margin_t;  D&A_t = Revenue_t × d_t;  EBIT_t = EBITDA_t − D&A_t
Taxes_t   = max(EBIT_t, 0) × tax rate      (no tax credit on losses — conservative simplification)
NWC_t     = Revenue_t × nwc_t;  ΔNWC_t = NWC_t − NWC_{t−1}  (NWC_0 = base-year working capital)
UFCF_t    = EBIT_t × (1 − tax) + D&A_t − Capex_t − ΔNWC_t
PV_t      = UFCF_t / (1 + WACC)^t           (t − 0.5 with the mid-year convention)
TV        = UFCF_N × (1 + g_T) / (WACC − g_T)   requires WACC > g_T
PV(TV)    = TV / (1 + WACC)^N
EV        = Σ PV_t + PV(TV)
```
Validation: 1–15 forecast years with one assumption per year; base revenue > 0; WACC 1–50%; terminal growth −5–10% and
below WACC; tax 0–60%; growth −90–200%; margins −100–90%; D&A and capex non-negative. Warnings: terminal growth > 4%,
growth > 50%, negative margins, non-positive final-year UFCF, terminal value > 85% of EV.

Sensitivity: EV for WACC ±1/±2 pp × terminal growth ±0.5/±1 pp; combinations with WACC ≤ g are shown as invalid.
Scenarios: low (WACC +1 pp, g −0.5 pp), base, high (WACC −1 pp, g +0.5 pp).
Pre-filled inputs come from the latest analysis (revenue, EBITDA margin, D&A, capex, trade working capital, net debt);
tax 25%, WACC 10% and terminal growth 2% are illustrative defaults the analyst must replace.

### 10.3 Equity bridge
`Equity value = Enterprise value − Net debt − Σ explicit bridge items` (e.g. minority interests, debt-like items).
Equity value is not shown when net debt is unavailable. Enterprise value and equity value are always labelled separately.

### 10.4 Review
Models start as `draft`; the author may submit for review; approval/rejection requires a finance reviewer who is not the
author. Only approved models are eligible for client-facing reports.
