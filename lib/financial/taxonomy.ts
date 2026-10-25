/** Standard categories (mirror of processing/deallens_worker/normalization/taxonomy.py; kept in sync by a unit test). */
export const CATEGORY_GROUPS: { statement: string; label: string; categories: Record<string, string> }[] = [
  { statement: "income_statement", label: "Income statement", categories: {
    revenue: "Revenue", cogs: "Cost of Goods Sold", gross_profit: "Gross Profit", sga: "Selling, General and Administrative Expenses",
    rnd: "Research and Development", other_operating_expenses: "Other Operating Expenses", d_and_a: "Depreciation and Amortization",
    ebitda: "EBITDA (reported)", adjusted_ebitda_reported: "Adjusted EBITDA (as reported by company)", ebit: "EBIT / Operating Profit",
    interest_expense: "Interest Expense", interest_income: "Interest Income", profit_before_tax: "Profit Before Tax", taxes: "Taxes", net_income: "Net Income",
  } },
  { statement: "balance_sheet", label: "Balance sheet", categories: {
    cash: "Cash and Cash Equivalents", accounts_receivable: "Accounts Receivable", inventory: "Inventory", other_current_assets: "Other Current Assets",
    total_current_assets: "Total Current Assets", ppe: "Property, Plant and Equipment", other_non_current_assets: "Other Non-Current Assets",
    total_assets: "Total Assets", accounts_payable: "Accounts Payable", accrued_expenses: "Accrued Expenses", short_term_debt: "Short-Term Debt",
    other_current_liabilities: "Other Current Liabilities", total_current_liabilities: "Total Current Liabilities", long_term_debt: "Long-Term Debt",
    lease_liabilities: "Lease Liabilities (not treated as debt by default)", other_non_current_liabilities: "Other Non-Current Liabilities",
    total_liabilities: "Total Liabilities", equity: "Total Equity", equity_component: "Equity component (share capital, reserves)",
    total_liabilities_and_equity: "Total Liabilities and Equity",
  } },
  { statement: "cash_flow", label: "Cash flow statement", categories: {
    operating_cash_flow: "Operating Cash Flow", investing_cash_flow: "Investing Cash Flow", financing_cash_flow: "Financing Cash Flow",
    capex: "Capital Expenditure", change_in_cash: "Change in Cash", beginning_cash: "Beginning Cash Balance", ending_cash: "Ending Cash Balance",
    cf_non_cash_item: "Non-cash adjustment (cash flow)",
  } },
  { statement: "supporting", label: "Supporting schedules", categories: { revenue_segment: "Revenue by segment", customer_revenue: "Revenue by customer" } },
];

export const CATEGORY_LABELS: Record<string, string> = Object.assign({}, ...CATEGORY_GROUPS.map((g) => g.categories));
export const categoryLabel = (key: string | null | undefined) => (key ? CATEGORY_LABELS[key] ?? key : "Unmapped");
