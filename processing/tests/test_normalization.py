import pytest

from deallens_worker.extraction.models import ParsedValue, Period, RawLineItem
from deallens_worker.normalization.normalize import normalize_items
from deallens_worker.normalization.rules import clean_label, match

P = Period("FY2023", "annual", "actual", None, None, (0,))


def item(label, value, statement="income_statement", unit=None, currency=None):
    return RawLineItem(label, P, str(value), ParsedValue(value), statement, "IS", "B5", None, None, 5, 2, "excel_cell",
                       detected_currency=currency, detected_unit=unit)


@pytest.mark.parametrize("label,statement,category", [
    ("Revenue", "income_statement", "revenue"), ("Net sales", "income_statement", "revenue"), ("Turnover", "income_statement", "revenue"),
    ("Cost of sales", "income_statement", "cogs"), ("COGS", "income_statement", "cogs"), ("Gross profit", "income_statement", "gross_profit"),
    ("SG&A", "income_statement", "sga"), ("Selling, general & administrative", "income_statement", "sga"),
    ("Research and development", "income_statement", "rnd"), ("Depreciation & amortisation", "income_statement", "d_and_a"),
    ("Operating profit", "income_statement", "ebit"), ("EBITDA", "income_statement", "ebitda"), ("Finance costs", "income_statement", "interest_expense"),
    ("Income tax expense", "income_statement", "taxes"), ("Net income", "income_statement", "net_income"),
    ("Cash and cash equivalents", "balance_sheet", "cash"), ("Trade receivables", "balance_sheet", "accounts_receivable"),
    ("Inventories", "balance_sheet", "inventory"), ("Total current assets", "balance_sheet", "total_current_assets"),
    ("Property, plant and equipment", "balance_sheet", "ppe"), ("Total assets", "balance_sheet", "total_assets"),
    ("Trade payables", "balance_sheet", "accounts_payable"), ("Accrued expenses", "balance_sheet", "accrued_expenses"),
    ("Short-term borrowings", "balance_sheet", "short_term_debt"), ("Long-term debt", "balance_sheet", "long_term_debt"),
    ("Total liabilities", "balance_sheet", "total_liabilities"), ("Total equity", "balance_sheet", "equity"),
    ("Total liabilities and equity", "balance_sheet", "total_liabilities_and_equity"),
    ("Net cash from operating activities", "cash_flow", "operating_cash_flow"),
    ("Net cash used in investing activities", "cash_flow", "investing_cash_flow"),
    ("Net cash used in financing activities", "cash_flow", "financing_cash_flow"),
    ("Purchase of property, plant and equipment", "cash_flow", "capex"), ("Capital expenditure", "cash_flow", "capex"),
    ("Net increase in cash", "cash_flow", "change_in_cash"), ("Cash at beginning of year", "cash_flow", "beginning_cash"),
    ("Cash at end of year", "cash_flow", "ending_cash"), ("Depreciation", "cash_flow", "cf_non_cash_item"),
    ("3. Revenue (note 4)", "income_statement", "revenue"),
])
def test_rule_matches(label, statement, category):
    assert match(label, statement)[0][0] == category


def test_cost_of_sales_is_not_revenue():
    assert match("Cost of sales", "income_statement")[0][0] == "cogs"


def test_unknown_label_unmapped():
    [n] = normalize_items([item("Widget royalties pool", 5.0)], "USD", "thousands", "income_statement")
    assert n.mapping_status == "unmapped" and n.category is None


def test_weak_rule_needs_review():
    [n] = normalize_items([item("Operating expenses", 100.0)], "USD", "thousands", "income_statement")
    assert n.mapping_status == "needs_review"


def test_expense_sign_normalised_raw_preserved():
    [n] = normalize_items([item("Cost of sales", -600.0)], "USD", "thousands", "income_statement")
    assert n.normalized_value == 600.0 and n.raw.parsed.value == -600.0
    assert "expense_presented_negative_sign_normalised" in n.notes


def test_unit_scaling():
    [n] = normalize_items([item("Revenue", 1.5, unit="millions")], "USD", "thousands", "income_statement")
    assert n.normalized_value == pytest.approx(1500.0)


def test_currency_mismatch_not_converted():
    [n] = normalize_items([item("Revenue", 100.0, currency="EUR")], "USD", "thousands", "income_statement")
    assert n.normalized_value is None and "currency_mismatch_not_converted" in n.notes


def test_clean_label():
    assert clean_label("  2. Trade receivables (Note 12): ") == "trade receivables"
