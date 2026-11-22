"""Pure business logic for the CIC journal (no web or database code here).

Mirrors the rules in the Excel model: same chart of accounts, same validation,
same monthly year-to-date income tax formula.
"""
import calendar
import datetime as dt
from decimal import ROUND_HALF_UP, Decimal

FACULTIES = ["BA", "BT", "CS", "Central"]
CASH_ID = 1010
TAX_EXPENSE_ID = 5900
TAX_PAYABLE_ID = 2030

# id: (name, type, faculty_tag)
ACCOUNTS = {
    1010: ("Cash at bank", "Asset", False),
    1100: ("Fees receivable", "Asset", False),
    1110: ("Other receivables", "Asset", False),
    1200: ("Inventory: bookstore", "Asset", False),
    1210: ("Inventory: cafeteria", "Asset", False),
    1220: ("Inventory: lab and office supplies", "Asset", False),
    1500: ("Land and buildings", "Asset", False),
    1510: ("Lab and IT equipment", "Asset", False),
    1520: ("Furniture and fittings", "Asset", False),
    1530: ("Vehicles", "Asset", False),
    2010: ("Accounts payable", "Liability", False),
    2020: ("Salaries payable", "Liability", False),
    2030: ("Income tax payable", "Liability", False),
    3010: ("Owner's capital", "Equity", False),
    3020: ("Owner's drawings", "Equity", False),
    4010: ("Tuition fees", "Revenue", True),
    4020: ("Application and registration fees", "Revenue", False),
    4030: ("Bookstore sales", "Revenue", False),
    4040: ("Cafeteria sales", "Revenue", False),
    4050: ("Training and consulting services", "Revenue", True),
    4060: ("Facility rental income", "Revenue", False),
    5010: ("Academic salaries", "Expense", True),
    5020: ("Administrative salaries", "Expense", False),
    5030: ("Cost of sales: bookstore", "Expense", False),
    5040: ("Cost of sales: cafeteria", "Expense", False),
    5050: ("Lab and office supplies used", "Expense", False),
    5060: ("Utilities", "Expense", False),
    5070: ("Marketing and admissions", "Expense", False),
    5080: ("Repairs and maintenance", "Expense", False),
    5090: ("Scholarships and discounts", "Expense", True),
    5900: ("Income tax expense", "Expense", False),
}

# code: (name, suggested debit text, suggested credit text)
TEMPLATES = {
    "T01": ("Owner invests cash", "1010", "3010"),
    "T02": ("Owner invests an asset", "15xx asset", "3010"),
    "T03": ("Owner draws cash", "3020", "1010"),
    "T04": ("Tuition billed", "1100", "4010"),
    "T05": ("Tuition collected later", "1010", "1100"),
    "T06": ("Tuition received in cash immediately", "1010", "4010"),
    "T07": ("Application fees received", "1010", "4020"),
    "T08": ("Bookstore sale (cash)", "1010", "4030"),
    "T09": ("Cafeteria sale (cash)", "1010", "4040"),
    "T10": ("Training or consulting service on account", "1110", "4050"),
    "T11": ("Other receivable collected", "1010", "1110"),
    "T12": ("Facility rental received", "1010", "4060"),
    "T13": ("Scholarship paid in cash", "5090", "1010"),
    "T14": ("Scholarship applied against fees owed", "5090", "1100"),
    "T15": ("Inventory bought on account", "1200/1210/1220", "2010"),
    "T16": ("Inventory bought for cash", "1200/1210/1220", "1010"),
    "T17": ("Supplier paid", "2010", "1010"),
    "T18": ("Stock sold: cost recorded", "5030/5040", "1200/1210"),
    "T19": ("Lab or office supplies used", "5050", "1220"),
    "T20": ("Asset bought for cash", "15xx asset", "1010"),
    "T21": ("Asset bought on account", "15xx asset", "2010"),
    "T22": ("Asset bought part cash, part account", "15xx asset", "1010 + 2010"),
    "T23": ("Salaries paid in cash", "5010/5020", "1010"),
    "T24": ("Salaries earned but unpaid", "5010/5020", "2020"),
    "T25": ("Salaries payable settled", "2020", "1010"),
    "T26": ("Utilities, marketing or maintenance paid in cash", "5060/5070/5080", "1010"),
    "T27": ("Utilities, marketing or maintenance on account", "5060/5070/5080", "2010"),
    "T28": ("Monthly income tax accrual", "5900", "2030"),
    "T29": ("Income tax paid", "2030", "1010"),
    "Custom": ("Custom entry", "any", "any"),
}


def round_half_up(x):
    """Whole-number rounding that matches Excel's ROUND(x, 0) for x >= 0.

    Python's built-in round() rounds halves to the nearest even number (28929262.5 -> 28929262),
    while Excel rounds halves up (28929262.5 -> 28929263). The tax rule must agree with the Excel Tax sheet.
    """
    return int(Decimal(str(round(x, 6))).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def fiscal_month(date, fy_start):
    """1..12 inside the financial year, else None."""
    m = (date.year - fy_start.year) * 12 + date.month - fy_start.month + 1
    return m if 1 <= m <= 12 else None


def month_end(fy_start, month_no):
    idx = fy_start.month - 1 + month_no - 1
    y, m = fy_start.year + idx // 12, idx % 12 + 1
    return dt.date(y, m, calendar.monthrange(y, m)[1])


def parse_month(value, fy_start):
    """Accept 'YYYY-MM' or an int 1..12; return the fiscal month number or None."""
    if value is None or value == "":
        return 12
    try:
        if isinstance(value, int) or str(value).isdigit():
            n = int(value)
            return n if 1 <= n <= 12 else None
        y, m = str(value).split("-")
        return fiscal_month(dt.date(int(y), int(m), 1), fy_start)
    except (ValueError, TypeError):
        return None


def _amount(x):
    if x in (None, ""):
        return 0.0
    return round(float(x), 2)


def validate_entry(payload, fy_start):
    """Return (clean_entry, errors). clean_entry is None if there are errors."""
    errors = []
    try:
        date = dt.date.fromisoformat(str(payload.get("date", "")))
    except ValueError:
        date = None
        errors.append("Date is missing or not in YYYY-MM-DD format.")
    if date and fiscal_month(date, fy_start) is None:
        errors.append(f"Date {date} is outside the financial year starting {fy_start}.")
    txn_type = payload.get("txn_type") or "Custom"
    if txn_type not in TEMPLATES:
        errors.append(f"Unknown transaction type '{txn_type}'.")
    raw_lines = payload.get("lines") or []
    if len(raw_lines) < 2:
        errors.append("An entry needs at least two lines.")
    entry_faculty = payload.get("faculty") or ""
    lines, total_dr, total_cr = [], 0.0, 0.0
    for i, ln in enumerate(raw_lines, start=1):
        try:
            acct = int(ln.get("account_id"))
        except (TypeError, ValueError):
            errors.append(f"Line {i}: account is missing.")
            continue
        if acct not in ACCOUNTS:
            errors.append(f"Line {i}: unknown account {acct}.")
            continue
        try:
            dr, cr = _amount(ln.get("debit")), _amount(ln.get("credit"))
        except (TypeError, ValueError):
            errors.append(f"Line {i}: amount is not a number.")
            continue
        if dr < 0 or cr < 0:
            errors.append(f"Line {i}: amounts must be positive.")
        if dr > 0 and cr > 0:
            errors.append(f"Line {i}: a line has a debit or a credit, not both.")
        if dr == 0 and cr == 0:
            errors.append(f"Line {i}: amount is missing.")
        name, _typ, tagged = ACCOUNTS[acct]
        fac = ln.get("faculty") or entry_faculty
        if tagged:
            if fac not in ("BA", "BT", "CS"):
                errors.append(f"Line {i}: {acct} {name} needs a faculty (BA, BT or CS).")
        else:
            fac = "Central"
        total_dr += dr
        total_cr += cr
        lines.append({"account_id": acct, "debit": dr, "credit": cr, "faculty": fac})
    if abs(total_dr - total_cr) > 0.005:
        errors.append(f"Entry is out of balance: debits {total_dr:,.2f}, credits {total_cr:,.2f}.")
    if errors:
        return None, errors
    return {"date": date.isoformat(), "txn_type": txn_type,
            "description": (payload.get("description") or "").strip(), "lines": lines}, []


def _net_by_account(lines, fy_start, through_month, only_month=None):
    net = {}
    for ln in lines:
        d = dt.date.fromisoformat(ln["date"])
        fm = fiscal_month(d, fy_start)
        if fm is None or fm > through_month:
            continue
        if only_month is not None and fm != only_month:
            continue
        net[ln["account_id"]] = net.get(ln["account_id"], 0.0) + ln["debit"] - ln["credit"]
    return net


def summary(lines, fy_start, through_month=12):
    """Statement of financial position totals and net income through a fiscal month."""
    net = _net_by_account(lines, fy_start, through_month)
    by_type = {"Asset": 0.0, "Liability": 0.0, "Revenue": 0.0, "Expense": 0.0}
    for acct, amt in net.items():
        typ = ACCOUNTS[acct][1]
        if typ in by_type:
            by_type[typ] += amt
    revenue = -by_type["Revenue"]
    expenses = by_type["Expense"]
    tax = net.get(TAX_EXPENSE_ID, 0.0)
    capital = -net.get(3010, 0.0)
    drawings = net.get(3020, 0.0)
    net_income = revenue - expenses
    equity = capital + net_income - drawings
    assets = by_type["Asset"]
    liabilities = -by_type["Liability"]
    r = lambda v: round(v, 2)
    return {
        "through_month": through_month, "period_end": month_end(fy_start, through_month).isoformat(),
        "cash": r(net.get(CASH_ID, 0.0)), "assets": r(assets), "liabilities": r(liabilities),
        "capital": r(capital), "revenue": r(revenue), "expenses_before_tax": r(expenses - tax),
        "profit_before_tax": r(revenue - (expenses - tax)), "income_tax": r(tax),
        "net_income": r(net_income), "drawings": r(drawings), "equity": r(equity),
        "balance_difference": r(assets - liabilities - equity),
        "balanced": abs(assets - liabilities - equity) < 0.005,
    }


def tax_suggestion(lines, fy_start, month_no, rate):
    """Same rule as the Excel Tax sheet.

    suggested = ROUND(max(0, rate x YTD profit before tax)) - tax expense recorded in earlier months
    """
    def pbt(through, only=None):
        net = _net_by_account(lines, fy_start, through, only)
        rev = -sum(v for a, v in net.items() if ACCOUNTS[a][1] == "Revenue")
        exp = sum(v for a, v in net.items() if ACCOUNTS[a][1] == "Expense" and a != TAX_EXPENSE_ID)
        return rev - exp

    ytd = pbt(month_no)
    required = round_half_up(max(0.0, rate * ytd))
    before = _net_by_account(lines, fy_start, month_no - 1).get(TAX_EXPENSE_ID, 0.0) if month_no > 1 else 0.0
    this_month = _net_by_account(lines, fy_start, month_no, only_month=month_no).get(TAX_EXPENSE_ID, 0.0)
    suggested = required - before
    to_post = suggested - this_month  # what is still missing after anything already posted this month
    proposal = None
    if abs(to_post) >= 0.5:
        amt = round(abs(to_post), 2)
        if to_post > 0:
            proposal = [{"account_id": TAX_EXPENSE_ID, "debit": amt, "credit": 0},
                        {"account_id": TAX_PAYABLE_ID, "debit": 0, "credit": amt}]
        else:  # reverse part of earlier tax
            proposal = [{"account_id": TAX_PAYABLE_ID, "debit": amt, "credit": 0},
                        {"account_id": TAX_EXPENSE_ID, "debit": 0, "credit": amt}]
    return {"month": month_no, "period_end": month_end(fy_start, month_no).isoformat(),
            "profit_before_tax_ytd": round(ytd, 2), "rate": rate, "tax_required_ytd": required,
            "recorded_before_this_month": round(before, 2), "recorded_this_month": round(this_month, 2),
            "suggested": round(suggested, 2), "to_post": round(to_post, 2), "up_to_date": abs(to_post) <= 0.5,
            "proposal": proposal}
