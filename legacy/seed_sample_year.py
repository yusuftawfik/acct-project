"""Generate a synthetic sample financial year for CIC and post it through the API.

Everything in the ASSUMPTIONS block below is invented. It is sample data for the
model, not real accounts. Change a number, run the script again, and the whole
year changes with it.

Usage (run from the project folder, with `python app.py` running in another window):

    python seed_sample_year.py --dry-run          # build and check the year, post nothing
    python seed_sample_year.py --dry-run --csv sample_journal.csv
    python seed_sample_year.py                    # post to http://127.0.0.1:5000
    python seed_sample_year.py --reset            # delete existing entries first (asks to confirm)

If the app has CIC_API_KEY set, pass --api-key or set the same environment variable.
Standard library only; it imports core.py so the validation and tax rule are identical to the app.
"""
import argparse
import calendar
import csv
import datetime as dt
import json
import os
import random
import sys
import urllib.error
import urllib.request

import core

# =====================================================================
# ASSUMPTIONS (all invented, amounts in EGP)
# Month numbers: 1 = July ... 12 = June (financial year 1 July to 30 June)
# =====================================================================
SEED = 2026

# Students per faculty: (semester 1, semester 2). Total about 3,000.
STUDENTS = {"BA": (1040, 1020), "BT": (960, 940), "CS": (1000, 985)}
TUITION_PER_SEMESTER = {"BA": 45_000, "BT": 55_000, "CS": 65_000}
SCHOLARSHIP_RATE = 0.08            # share of billed tuition given as scholarships/discounts

# Tuition is earned while the semester is taught, so it is billed in equal monthly instalments:
# semester 1 in September to January, semester 2 in February to June. (Billing the whole semester
# up front would need unearned revenue, which the course has not covered yet.)
TEACHING_MONTHS = {0: range(3, 8), 1: range(8, 13)}
COLLECT_SAME_MONTH = 0.70          # share of each month's net bill collected in that month; the rest the month after

#                 Jul  Aug  Sep  Oct  Nov  Dec  Jan  Feb  Mar  Apr  May  Jun   (millions EGP)
APPLICATION_FEES = [0.9, 1.3, 0.4, 0.3, 0.3, 0.4, 0.7, 0.5, 0.5, 0.7, 0.9, 1.1]
BOOKSTORE_SALES = [0.2, 0.8, 4.5, 1.2, 0.8, 0.6, 0.5, 3.0, 0.8, 0.6, 0.5, 0.3]
CAFETERIA_SALES = [0.4, 0.3, 1.6, 2.2, 2.2, 1.8, 1.2, 1.8, 2.2, 2.1, 2.0, 0.9]
FACILITY_RENTAL = [1.2, 1.2, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.5, 0.9]
UTILITIES = [2.4, 2.6, 2.0, 1.7, 1.5, 1.5, 1.5, 1.5, 1.6, 1.8, 2.2, 2.5]
MARKETING = [3.0, 3.5, 1.5, 1.0, 0.8, 0.8, 1.2, 1.5, 2.5, 3.0, 3.2, 3.0]
MAINTENANCE = [4.0, 3.5, 1.0, 0.8, 0.8, 0.8, 0.8, 1.0, 0.8, 0.8, 1.0, 2.0]

TRAINING_BASE = {"BA": 350_000, "BT": 450_000, "CS": 650_000}   # training and consulting per month
TRAINING_SEASON = [1.2, 1.1, 0.9, 1.0, 1.0, 0.9, 0.8, 0.9, 1.0, 1.0, 1.1, 1.2]

ACADEMIC_SALARY_MONTHLY = {"BA": 3_830_000, "BT": 4_000_000, "CS": 4_670_000}
ADMIN_SALARY_MONTHLY = 4_200_000

BOOKSTORE_COST_RATE = 0.70
CAFETERIA_COST_RATE = 0.65
SUPPLIES_USED_MONTHLY = 800_000
SUPPLIES_PURCHASES = {1: 6_000_000, 7: 4_000_000}     # bought for cash in July and January

OWNER_CASH = 120_000_000
OWNER_BUILDINGS = 400_000_000

# Equipment purchases: month, day, template, asset account, total, cash paid now, month the rest is paid
EQUIPMENT = [
    dict(m=1, day=8, txn="T22", asset=1510, total=12_000_000, cash=4_000_000, due=4, what="Lab and IT equipment"),
    dict(m=2, day=20, txn="T20", asset=1520, total=3_000_000, cash=3_000_000, due=None, what="Furniture and fittings"),
    dict(m=2, day=25, txn="T20", asset=1530, total=2_400_000, cash=2_400_000, due=None, what="Vehicles"),
    dict(m=7, day=12, txn="T21", asset=1510, total=6_000_000, cash=0, due=10, what="Lab and IT equipment"),
]
DRAWINGS = {6: 20_000_000, 12: 25_000_000}             # owner draws in December and June
TAX_PAY_MONTHS = (4, 7, 10)                            # tax paid in Oct, Jan, Apr for the quarter before
TAX_RATE = 0.225

SALES_JITTER = 0.06      # random +/- variation on sales
COST_JITTER = 0.05       # random +/- variation on utilities


# =====================================================================
# Building the year
# =====================================================================
def mdate(fy_start, m, day):
    idx = fy_start.month - 1 + m - 1
    y, mo = fy_start.year + idx // 12, idx % 12 + 1
    return dt.date(y, mo, min(day, calendar.monthrange(y, mo)[1]))


def build_year(fy_start, tax_rate=TAX_RATE, seed=SEED):
    """Return (entries, flat_lines, monthly_summaries). Every entry is validated by core."""
    rnd = random.Random(seed)

    def jit(base, j):
        return int(round(base * (1 + rnd.uniform(-j, j)), -2))

    millions = lambda arr, j: [jit(v * 1_000_000, j) for v in arr]
    app_fees = millions(APPLICATION_FEES, SALES_JITTER)
    book = millions(BOOKSTORE_SALES, SALES_JITTER)
    cafe = millions(CAFETERIA_SALES, SALES_JITTER)
    rental = millions(FACILITY_RENTAL, SALES_JITTER)
    util = millions(UTILITIES, COST_JITTER)
    mark = millions(MARKETING, COST_JITTER)
    maint = millions(MAINTENANCE, COST_JITTER)
    book_cost = [int(round(v * BOOKSTORE_COST_RATE)) for v in book]
    cafe_cost = [int(round(v * CAFETERIA_COST_RATE)) for v in cafe]
    training = {f: [jit(TRAINING_BASE[f] * TRAINING_SEASON[i], SALES_JITTER) for i in range(12)]
                for f in TRAINING_BASE}

    entries, flat, summaries = [], [], []
    ap_due = []                       # (month, amount) supplier amounts to pay
    state = {"salaries_prev": 0, "training_prev": 0, "unpaid_prev": 0}

    def validate(payload):
        clean, errors = core.validate_entry(payload, fy_start)
        if errors:
            raise SystemExit(f"Generated entry is invalid: {errors}\n{payload}")
        return clean

    def balance(acct, through):
        total = 0.0
        for ln in flat:
            if ln["account_id"] == acct and core.fiscal_month(dt.date.fromisoformat(ln["date"]), fy_start) <= through:
                total += ln["debit"] - ln["credit"]
        return total

    for m in range(1, 13):
        pending = []   # (date, seq, payload)

        def post(day, txn, desc, lines, month_end=False):
            d = core.month_end(fy_start, m) if month_end else mdate(fy_start, m, day)
            payload = {"date": d.isoformat(), "txn_type": txn, "description": desc,
                       "lines": [{"account_id": a, "debit": dr, "credit": cr, "faculty": fac}
                                 for (a, dr, cr, fac) in lines if (dr or cr)]}
            pending.append((d, len(pending), validate(payload)))

        i = m - 1
        label = calendar.month_name[mdate(fy_start, m, 1).month]

        # --- owner and equipment
        if m == 1:
            post(1, "T01", "Owner invests cash to start the year", [(1010, OWNER_CASH, 0, None), (3010, 0, OWNER_CASH, None)])
            post(1, "T02", "Owner contributes campus land and buildings (at cost)",
                 [(1500, OWNER_BUILDINGS, 0, None), (3010, 0, OWNER_BUILDINGS, None)])
        for eq in EQUIPMENT:
            if eq["m"] != m:
                continue
            on_account = eq["total"] - eq["cash"]
            lines = [(eq["asset"], eq["total"], 0, None)]
            if eq["cash"]:
                lines.append((1010, 0, eq["cash"], None))
            if on_account:
                lines.append((2010, 0, on_account, None))
                ap_due.append((eq["due"], on_account))
            post(eq["day"], eq["txn"], f"Purchase: {eq['what']}", lines)
        if m in DRAWINGS:
            post(20, "T03", "Owner's drawings", [(3020, DRAWINGS[m], 0, None), (1010, 0, DRAWINGS[m], None)])

        # --- tuition: monthly billing while teaching, scholarships, collections
        if state["unpaid_prev"] > 0:
            post(8, "T05", "Tuition collected from last month's bill",
                 [(1010, state["unpaid_prev"], 0, None), (1100, 0, state["unpaid_prev"], None)])
            state["unpaid_prev"] = 0
        for sem, months in TEACHING_MONTHS.items():
            if m in months:
                n = len(months)
                gross = {f: int(round(STUDENTS[f][sem] * TUITION_PER_SEMESTER[f] / n)) for f in STUDENTS}
                schol = {f: int(round(gross[f] * SCHOLARSHIP_RATE)) for f in STUDENTS}
                net = sum(gross.values()) - sum(schol.values())
                post(15, "T04", f"Semester {sem + 1} tuition billed for {label}",
                     [(1100, sum(gross.values()), 0, None)] + [(4010, 0, gross[f], f) for f in gross])
                post(16, "T14", f"Scholarships applied against fees owed, {label}",
                     [(5090, schol[f], 0, f) for f in schol] + [(1100, 0, sum(schol.values()), None)])
                got = int(round(net * COLLECT_SAME_MONTH))
                post(20, "T05", f"Tuition collected during {label}", [(1010, got, 0, None), (1100, 0, got, None)])
                state["unpaid_prev"] = net - got

        # --- other revenue
        post(25, "T07", "Application and registration fees received", [(1010, app_fees[i], 0, None), (4020, 0, app_fees[i], None)])
        post(26, "T08", "Bookstore sales (cash)", [(1010, book[i], 0, None), (4030, 0, book[i], None)])
        post(26, "T09", "Cafeteria sales (cash)", [(1010, cafe[i], 0, None), (4040, 0, cafe[i], None)])
        post(3, "T12", "Facility rental received", [(1010, rental[i], 0, None), (4060, 0, rental[i], None)])
        tr = {f: training[f][i] for f in training}
        post(24, "T10", "Training and consulting services on account",
             [(1110, sum(tr.values()), 0, None)] + [(4050, 0, tr[f], f) for f in tr])
        if m > 1:
            post(12, "T11", "Training and consulting receivables collected",
                 [(1010, state["training_prev"], 0, None), (1110, 0, state["training_prev"], None)])
        state["training_prev"] = sum(tr.values())

        # --- inventory: bookstore and cafeteria stock bought a month ahead
        nxt = (i + 1) % 12
        book_buy = book_cost[0] + book_cost[1] if m == 1 else book_cost[nxt]
        cafe_buy = cafe_cost[0] + cafe_cost[1] if m == 1 else cafe_cost[nxt]
        post(5, "T15", "Bookstore stock bought on account", [(1200, book_buy, 0, None), (2010, 0, book_buy, None)])
        ap_due.append((m + 1, book_buy))
        post(6, "T16", "Cafeteria stock bought for cash", [(1210, cafe_buy, 0, None), (1010, 0, cafe_buy, None)])
        post(27, "T18", "Bookstore cost of sales", [(5030, book_cost[i], 0, None), (1200, 0, book_cost[i], None)])
        post(27, "T18", "Cafeteria cost of sales", [(5040, cafe_cost[i], 0, None), (1210, 0, cafe_cost[i], None)])
        if m in SUPPLIES_PURCHASES:
            post(4, "T16", "Lab and office supplies bought for cash",
                 [(1220, SUPPLIES_PURCHASES[m], 0, None), (1010, 0, SUPPLIES_PURCHASES[m], None)])
        post(27, "T19", "Lab and office supplies used", [(5050, SUPPLIES_USED_MONTHLY, 0, None), (1220, 0, SUPPLIES_USED_MONTHLY, None)])

        # --- running costs
        post(28, "T26", "Utilities paid", [(5060, util[i], 0, None), (1010, 0, util[i], None)])
        post(14, "T26", "Marketing and admissions campaigns paid", [(5070, mark[i], 0, None), (1010, 0, mark[i], None)])
        post(18, "T27", "Repairs and maintenance on account", [(5080, maint[i], 0, None), (2010, 0, maint[i], None)])
        ap_due.append((m + 1, maint[i]))

        # --- salaries: earned at month end, paid on the 5th of the next month
        if m > 1:
            post(5, "T25", "Last month's salaries paid", [(2020, state["salaries_prev"], 0, None), (1010, 0, state["salaries_prev"], None)])
        acad = ACADEMIC_SALARY_MONTHLY
        total_sal = sum(acad.values()) + ADMIN_SALARY_MONTHLY
        post(0, "T24", f"Salaries earned for {label}",
             [(5010, acad[f], 0, f) for f in acad] + [(5020, ADMIN_SALARY_MONTHLY, 0, None), (2020, 0, total_sal, None)],
             month_end=True)
        state["salaries_prev"] = total_sal

        # --- suppliers and equipment payable
        due_now = sum(a for (dm, a) in ap_due if dm == m)
        if due_now:
            post(10, "T17", "Suppliers paid", [(2010, due_now, 0, None), (1010, 0, due_now, None)])

        # --- income tax payment for the previous quarter (amount from the balance at last month end)
        if m in TAX_PAY_MONTHS:
            payable = -balance(core.TAX_PAYABLE_ID, m - 1)
            if payable > 0.5:
                pay = int(round(payable))
                post(15, "T29", "Income tax paid", [(2030, pay, 0, None), (1010, 0, pay, None)])

        # add this month's entries, then compute the monthly tax from the year-to-date profit
        for d, seq, clean in sorted(pending, key=lambda t: (t[0], t[1])):
            entries.append(clean)
            for ln in clean["lines"]:
                flat.append({"date": clean["date"], "account_id": ln["account_id"], "debit": ln["debit"], "credit": ln["credit"]})
        tax = core.tax_suggestion(flat, fy_start, m, tax_rate)
        if tax["proposal"]:
            d = core.month_end(fy_start, m)
            desc = "Monthly income tax accrual" if tax["to_post"] > 0 else "Income tax accrual reversed"
            clean = validate({"date": d.isoformat(), "txn_type": "T28", "description": desc,
                              "lines": [dict(ln, faculty=None) for ln in tax["proposal"]]})
            entries.append(clean)
            for ln in clean["lines"]:
                flat.append({"date": clean["date"], "account_id": ln["account_id"], "debit": ln["debit"], "credit": ln["credit"]})

        s = core.summary(flat, fy_start, m)
        s["month"] = m
        s["label"] = label
        for acct, name in ((1010, "cash"), (1100, "receivables"), (1200, "bookstore stock"), (1210, "cafeteria stock"),
                           (1220, "supplies stock"), (1110, "other receivables")):
            if balance(acct, m) < -0.005:
                raise SystemExit(f"Month {m}: {name} went negative ({balance(acct, m):,.0f}). Adjust the assumptions.")
        if balance(core.TAX_PAYABLE_ID, m) > 0.005:
            raise SystemExit(f"Month {m}: income tax payable went negative. Adjust TAX_PAY_MONTHS or the assumptions.")
        if not s["balanced"]:
            raise SystemExit(f"Month {m}: the accounting equation does not balance.")
        summaries.append(s)

    return entries, flat, summaries


# =====================================================================
# Output: summary, CSV, API
# =====================================================================
def print_summary(entries, summaries):
    n_lines = sum(len(e["lines"]) for e in entries)
    print(f"\n{len(entries)} entries, {n_lines} journal lines (the Excel Journal holds 2,000).\n")
    print(f"{'Month':<10}{'Revenue YTD':>16}{'Net income YTD':>16}{'Cash':>16}{'Assets':>18}{'Equity':>18}")
    for s in summaries:
        print(f"{s['label']:<10}{s['revenue']:>16,.0f}{s['net_income']:>16,.0f}{s['cash']:>16,.0f}{s['assets']:>18,.0f}{s['equity']:>18,.0f}")
    f = summaries[-1]
    margin = f["profit_before_tax"] / f["revenue"] if f["revenue"] else 0
    print(f"\nYear end: revenue {f['revenue']:,.0f}; profit before tax {f['profit_before_tax']:,.0f} "
          f"({margin:.1%} of revenue); income tax {f['income_tax']:,.0f}; net income {f['net_income']:,.0f}.")
    print(f"Assets {f['assets']:,.0f} = liabilities {f['liabilities']:,.0f} + equity {f['equity']:,.0f} "
          f"(difference {f['balance_difference']:,.2f}).")


def write_csv(path, entries):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["EntryID", "Date", "TxnType", "AccountID", "Debit", "Credit", "Faculty", "Description"])
        for eid, e in enumerate(entries, start=1):
            for ln in e["lines"]:
                w.writerow([eid, e["date"], e["txn_type"], ln["account_id"], ln["debit"] or "", ln["credit"] or "",
                            ln["faculty"], e["description"]])
    print(f"Wrote {path}")


def call(base, method, path, key="", payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if key:
        req.add_header("X-API-Key", key)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read().decode("utf-8") or "{}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="http://127.0.0.1:5000")
    ap.add_argument("--api-key", default=os.environ.get("CIC_API_KEY", ""))
    ap.add_argument("--fy-start", default="2026-07-01", help="used for --dry-run; otherwise read from the app")
    ap.add_argument("--tax-rate", type=float, default=TAX_RATE)
    ap.add_argument("--seed", type=int, default=SEED)
    ap.add_argument("--dry-run", action="store_true", help="build and check the year, post nothing")
    ap.add_argument("--csv", help="also write the year to this CSV file (same columns as /journal.csv)")
    ap.add_argument("--reset", action="store_true", help="delete ALL existing entries in the app first (asks to confirm)")
    args = ap.parse_args()

    fy_start = dt.date.fromisoformat(args.fy_start)
    if not args.dry_run:
        try:
            status, health = call(args.url, "GET", "/api/health")
        except (urllib.error.URLError, OSError) as err:
            sys.exit(f"Cannot reach {args.url} ({err}). Start the app with `python app.py` first.")
        fy_start = dt.date.fromisoformat(health["financial_year_start"])
        print(f"Connected. Financial year starts {fy_start}.")

    entries, _flat, summaries = build_year(fy_start, args.tax_rate, args.seed)
    print_summary(entries, summaries)
    if args.csv:
        write_csv(args.csv, entries)
    if args.dry_run:
        print("\nDry run: nothing was posted.")
        return

    status, existing = call(args.url, "GET", "/api/entries")
    if existing:
        if not args.reset:
            sys.exit(f"\nThe app already holds {len(existing)} entries. Nothing was posted. "
                     "Run again with --reset to delete them first.")
        if input(f"\nDelete all {len(existing)} existing entries? Type YES to confirm: ").strip() != "YES":
            sys.exit("Cancelled. Nothing was changed.")
        for e in existing:
            call(args.url, "DELETE", f"/api/entries/{e['id']}", args.api_key)
        print(f"Deleted {len(existing)} entries.")

    for n, e in enumerate(entries, start=1):
        status, body = call(args.url, "POST", "/api/entries", args.api_key, e)
        if status != 201:
            sys.exit(f"Entry {n} was rejected ({status}): {body}\nStopped. Entries before it were already posted.")
    print(f"\nPosted {len(entries)} entries.")
    status, s = call(args.url, "GET", "/api/summary?through=12")
    print(f"API summary through June: assets {s['assets']:,.0f}, net income {s['net_income']:,.0f}, balanced: {s['balanced']}")


if __name__ == "__main__":
    main()
