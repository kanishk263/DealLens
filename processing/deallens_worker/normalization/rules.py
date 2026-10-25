"""Deterministic label → category rules.

Each rule: (regex on the cleaned label, category, allowed statement types or None for any, confidence).
Rules are evaluated in order and the most specific rules come first (e.g. 'cost of sales' before
'sales'). Confidence < AUTO_MAP_THRESHOLD produces `needs_review`, never a silent definitive mapping.
"""
from __future__ import annotations

import re
from typing import Optional

from .taxonomy import STATEMENT_OF

AUTO_MAP_THRESHOLD = 0.85

IS, BS, CF, SUP = "income_statement", "balance_sheet", "cash_flow", "supporting"

_RULES_SRC: list[tuple[str, str, Optional[set], float]] = [
    # ---- cash flow (specific phrases first) ----
    (r"^net cash (flows? )?(from|provided by|generated (from|by)|(used in|from)|\(used in\)( |/)?from|used in|\(used in\)) operat(ing|ions)( activities)?$", "operating_cash_flow", None, 0.97),
    (r"^(cash (flow|generated) from operations|operating cash flows?|cash flows? from operating activities)$", "operating_cash_flow", None, 0.93),
    (r"^net cash (flows? )?(from|provided by|used in|\(used in\)|generated (from|by))( |/)?(\(used in\) )?invest(ing|ment)( activities)?$", "investing_cash_flow", None, 0.97),
    (r"^(cash flows? from investing activities|investing cash flows?)$", "investing_cash_flow", None, 0.93),
    (r"^net cash (flows? )?(from|provided by|used in|\(used in\)|generated (from|by))( |/)?(\(used in\) )?financ(ing|e)( activities)?$", "financing_cash_flow", None, 0.97),
    (r"^(cash flows? from financing activities|financing cash flows?)$", "financing_cash_flow", None, 0.93),
    (r"^(capital expenditures?|capex|purchases? of (property,? plant (and|&) equipment|ppe|fixed assets|tangible assets)|additions to (ppe|fixed assets|property,? plant (and|&) equipment))$", "capex", None, 0.93),
    (r"^net (increase|decrease|increase ?/ ?\(?decrease\)?|change|\(decrease\) ?/ ?increase) in cash( and cash equivalents)?$", "change_in_cash", None, 0.96),
    (r"^(cash( and cash equivalents)? at (the )?(beginning|start) of (the )?(year|period)|opening cash( balance)?|beginning cash( balance)?)$", "beginning_cash", None, 0.96),
    (r"^(cash( and cash equivalents)? at (the )?end of (the )?(year|period)|closing cash( balance)?|ending cash( balance)?)$", "ending_cash", None, 0.96),
    (r"^(depreciation( and|&)? amorti[sz]ation|depreciation|amorti[sz]ation|d ?& ?a|share[- ]based (compensation|payments)|changes? in working capital|(increase|decrease) in (trade )?(receivables|inventor(y|ies)|payables))$", "cf_non_cash_item", {CF}, 0.88),
    # ---- income statement ----
    (r"^(cost of (goods sold|sales|revenues?)|cogs|cost of goods|direct costs)$", "cogs", None, 0.95),
    (r"^gross (profit|margin)$", "gross_profit", None, 0.96),
    (r"^(total )?(net )?(revenues?|sales|turnover|net sales)$", "revenue", {IS, None, "unknown"}, 0.95),
    (r"^(total )?(operating )?revenues? from contracts with customers$", "revenue", None, 0.9),
    (r"^(selling,? general (and|&) administrative( expenses)?|sg ?& ?a|sga|sg and a)$", "sga", None, 0.95),
    (r"^(general (and|&) administrative|g ?& ?a|administrative expenses|selling (and|&) (distribution|marketing)( expenses)?|distribution costs|sales (and|&) marketing)$", "sga", None, 0.86),
    (r"^(research (and|&) development|r ?& ?d)( expenses?| costs?)?$", "rnd", None, 0.95),
    (r"^(adjusted|normali[sz]ed|underlying) ebitda$", "adjusted_ebitda_reported", None, 0.7),
    (r"^ebitda$", "ebitda", None, 0.96),
    (r"^(depreciation( and|&)? amorti[sz]ation|d ?& ?a)( expense)?$", "d_and_a", {IS, None, "unknown"}, 0.95),
    (r"^(depreciation|amorti[sz]ation)( expense)?$", "d_and_a", {IS, None, "unknown"}, 0.8),
    (r"^(operating (profit|income)|ebit|profit from operations|income from operations)$", "ebit", None, 0.93),
    (r"^(interest expense|finance (costs?|expense)|interest (paid|charges?))$", "interest_expense", {IS, None, "unknown"}, 0.92),
    (r"^(interest income|finance income)$", "interest_income", None, 0.92),
    (r"^net (interest|finance) (expense|costs?|income)$", "interest_expense", None, 0.7),
    (r"^(profit|income|earnings) before (income )?tax(es|ation)?$|^pbt$", "profit_before_tax", None, 0.95),
    (r"^(income tax(es)?( expense)?|tax(ation)?( expense| charge)?|provision for income taxes|corporation tax)$", "taxes", None, 0.92),
    (r"^(net (income|profit|earnings|loss)|profit (for|after tax for) the (year|period)|profit after tax(ation)?|net income \(loss\))$", "net_income", None, 0.95),
    (r"^(other operating (expenses|costs|income)|operating expenses|total operating expenses|opex)$", "other_operating_expenses", None, 0.7),
    # ---- balance sheet ----
    (r"^total liabilities (and|&) (shareholders'?|stockholders'?|owners'?)? ?equity$", "total_liabilities_and_equity", None, 0.97),
    (r"^total current assets$", "total_current_assets", None, 0.97),
    (r"^total current liabilities$", "total_current_liabilities", None, 0.97),
    (r"^total assets$", "total_assets", None, 0.97),
    (r"^total liabilities$", "total_liabilities", None, 0.97),
    (r"^total (shareholders'?|stockholders'?|owners'?)? ?equity$|^(shareholders'?|stockholders'?) equity$|^net assets$", "equity", None, 0.95),
    (r"^(share capital|common stock|retained earnings|reserves|additional paid[- ]in capital|accumulated (deficit|losses))$", "equity_component", None, 0.88),
    (r"^(cash( and cash equivalents)?|cash at bank( and in hand)?|cash & cash equivalents)$", "cash", {BS, None, "unknown"}, 0.95),
    (r"^((trade )?(accounts )?receivables?|trade (and other )?receivables|debtors|trade debtors|accounts receivable,? net)$", "accounts_receivable", None, 0.92),
    (r"^(inventor(y|ies)|stocks?)$", "inventory", None, 0.9),
    (r"^(prepaid expenses|prepayments|other current assets|prepaid expenses and other current assets)$", "other_current_assets", None, 0.87),
    (r"^(property,? plant (and|&) equipment(,? net)?|ppe|ppe,? net|fixed assets|tangible (fixed )?assets)$", "ppe", None, 0.93),
    (r"^(intangible assets|goodwill|other non[- ]current assets|right[- ]of[- ]use assets|deferred tax assets|investments)$", "other_non_current_assets", None, 0.86),
    (r"^((trade )?(accounts )?payables?|trade (and other )?payables|creditors|trade creditors)$", "accounts_payable", None, 0.92),
    (r"^(accrued (expenses|liabilities)|accruals)$", "accrued_expenses", None, 0.92),
    (r"^(short[- ]term (debt|borrowings|loans)|current portion of (long[- ]term )?(debt|borrowings)|revolving (credit )?facility|bank overdrafts?|current borrowings)$", "short_term_debt", None, 0.9),
    (r"^(long[- ]term (debt|borrowings|loans)|term loans?|non[- ]current borrowings|bonds payable|notes payable|senior notes)$", "long_term_debt", None, 0.9),
    (r"^(lease liabilit(y|ies)|finance lease liabilit(y|ies)|operating lease liabilit(y|ies))$", "lease_liabilities", None, 0.9),
    (r"^(other current liabilities|deferred revenue|contract liabilities|income taxes? payable|current tax liabilit(y|ies))$", "other_current_liabilities", None, 0.86),
    (r"^(other non[- ]current liabilities|deferred tax liabilit(y|ies)|provisions|long[- ]term provisions)$", "other_non_current_liabilities", None, 0.86),
]

RULES = [(re.compile(p, re.I), cat, allowed, conf) for p, cat, allowed, conf in _RULES_SRC]

_NOTE = re.compile(r"\((note|notes|n)\s*\d+[a-z]?\)|\bnote\s*\d+[a-z]?$", re.I)
_LEADING_NUM = re.compile(r"^(\d+(\.\d+)*[.)]?|[a-z][.)]|[ivx]+[.)])\s+", re.I)


def clean_label(label: str) -> str:
    s = label.strip().lower().replace("’", "'").replace("–", "-").replace("—", "-")
    s = _NOTE.sub("", s)
    s = _LEADING_NUM.sub("", s)
    s = s.replace("&", " & ").replace(" and ", " and ")
    s = re.sub(r"\s*&\s*", " & ", s)
    s = re.sub(r"[:*]+$", "", s)
    s = re.sub(r"\s+", " ", s).strip(" .-")
    return s


def match(label: str, statement: str) -> list[tuple[str, float]]:
    """All matching (category, confidence) pairs for a label in a statement context, best first."""
    cleaned = clean_label(label)
    variants = {cleaned, cleaned.replace(" & ", " and "), cleaned.replace(" and ", " & ")}
    found: dict[str, float] = {}
    for pattern, category, allowed, conf in RULES:
        if allowed is not None and statement not in allowed and not (None in allowed and statement in ("unknown", "supporting")):
            continue
        if any(pattern.search(v) for v in variants):
            c = conf
            # Statement context disagreeing with the category's natural home lowers confidence.
            home = STATEMENT_OF.get(category)
            if statement in (IS, BS, CF) and home and home != statement and category not in ("capex",):
                c = min(c, 0.6)
            found[category] = max(found.get(category, 0), c)
    return sorted(found.items(), key=lambda kv: -kv[1])
