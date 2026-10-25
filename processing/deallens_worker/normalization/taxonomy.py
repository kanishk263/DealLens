"""Standardised financial categories. Keys are stable identifiers stored in the database."""

INCOME_STATEMENT = {
    "revenue": "Revenue", "cogs": "Cost of Goods Sold", "gross_profit": "Gross Profit",
    "sga": "Selling, General and Administrative Expenses", "rnd": "Research and Development",
    "other_operating_expenses": "Other Operating Expenses", "d_and_a": "Depreciation and Amortization",
    "ebitda": "EBITDA (reported)", "adjusted_ebitda_reported": "Adjusted EBITDA (as reported by company)",
    "ebit": "EBIT / Operating Profit", "interest_expense": "Interest Expense", "interest_income": "Interest Income",
    "profit_before_tax": "Profit Before Tax", "taxes": "Taxes", "net_income": "Net Income",
}
BALANCE_SHEET = {
    "cash": "Cash and Cash Equivalents", "accounts_receivable": "Accounts Receivable", "inventory": "Inventory",
    "other_current_assets": "Other Current Assets", "total_current_assets": "Total Current Assets",
    "ppe": "Property, Plant and Equipment", "other_non_current_assets": "Other Non-Current Assets",
    "total_assets": "Total Assets", "accounts_payable": "Accounts Payable", "accrued_expenses": "Accrued Expenses",
    "short_term_debt": "Short-Term Debt", "other_current_liabilities": "Other Current Liabilities",
    "total_current_liabilities": "Total Current Liabilities", "long_term_debt": "Long-Term Debt",
    "lease_liabilities": "Lease Liabilities (not treated as debt by default)",
    "other_non_current_liabilities": "Other Non-Current Liabilities", "total_liabilities": "Total Liabilities",
    "equity": "Total Equity", "equity_component": "Equity component (share capital, reserves)",
    "total_liabilities_and_equity": "Total Liabilities and Equity",
}
CASH_FLOW = {
    "operating_cash_flow": "Operating Cash Flow", "investing_cash_flow": "Investing Cash Flow",
    "financing_cash_flow": "Financing Cash Flow", "capex": "Capital Expenditure", "change_in_cash": "Change in Cash",
    "beginning_cash": "Beginning Cash Balance", "ending_cash": "Ending Cash Balance",
    "cf_non_cash_item": "Non-cash adjustment (cash flow)",
}
SUPPORTING = {"revenue_segment": "Revenue by segment", "customer_revenue": "Revenue by customer"}

CATEGORIES = {**INCOME_STATEMENT, **BALANCE_SHEET, **CASH_FLOW, **SUPPORTING}

STATEMENT_OF = {**{k: "income_statement" for k in INCOME_STATEMENT}, **{k: "balance_sheet" for k in BALANCE_SHEET},
                **{k: "cash_flow" for k in CASH_FLOW}, **{k: "supporting" for k in SUPPORTING}}

# Expense-type categories are stored as positive magnitudes after normalisation (the sign convention
# of the source is preserved in raw_value/parsed_value and reported as a data-quality observation).
EXPENSE_CATEGORIES = {"cogs", "sga", "rnd", "other_operating_expenses", "d_and_a", "interest_expense", "taxes", "capex"}

# Balance-sheet stocks (point-in-time) vs flows; used for averaging and period checks.
BALANCE_CATEGORIES = set(BALANCE_SHEET)
