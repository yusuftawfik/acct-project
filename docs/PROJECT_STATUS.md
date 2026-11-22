# CIC Financial Reporting Model: Project Status

Last updated: 24 October 2026

A single place to see **what is done, what is left, and the context behind the decisions**.
Rules and conventions for AI agents live in `AGENTS.md` (the source of truth for accounting rules, schema, validation and commands). The full original plan is in `university_financial_model_plan.md`.

---

## 1. What this project is

A university accounting project (IAS 1 / IFRS 18 presentation, taught at definition level), built to a standard good enough to show in a CV for internships.

- **Entity:** Canadian International College (CIC), a fictional private for-profit university with one owner.
- **Currency and year:** EGP, financial year 1 July to 30 June (default FY 2026/27).
- **Faculties:** BA (Business Administration), BT (Business Technology), CS (Computer Science), plus "Central" for shared items. About 3,000 students (roughly 1,000 per faculty).
- **Engine:** the accounting equation, `Assets = Liabilities + (Capital + Revenue - Expenses - Drawings)`. Each transaction is entered once and every statement is built from it.
- **Six statements:** statement of financial position, income statement, net income, cash flows, owner's equity, notes to disclosure.

```
Web app -> Flask API -> SQLite journal -> Excel (six statements + 10 checks)
                                       -> Power BI (dashboard)   [not built yet]
```

## 2. Done

| Piece | What exists | How it was verified |
|---|---|---|
| Scope and design | 31 accounts, 29 transaction templates (plus Custom), monthly year-to-date income tax at 22.5%, journal schema | Documented in `AGENTS.md` |
| Backend and database | `core.py` (pure business logic), `db.py` (SQLite), `app.py` (Flask API) | 10 automated tests pass (`python test_api.py`) |
| Web app | `static/index.html`, one file, vanilla JavaScript | Clicked through end to end in a headless browser |
| Excel model | `CIC_Financial_Model_v2.xlsx`, 18 sheets, six statements, 10 integrity checks | Recalculated with zero errors; lecture example matches; opened and refreshed in desktop Excel |
| Excel live feed | `JournalFeed` sheet loaded by Power Query from `/journal.csv`; Journal columns A-H read from it | Refresh All pulls new entries; confirmed working in desktop Excel |
| Feed / Manual switch | `Assumptions!C17` (named `JournalSource`): `Feed` or `Manual`; `Journal Manual` sheet is the typed-input fallback | Both modes tested |
| Sample year of data | `seed_sample_year.py` generates and posts 259 entries (619 lines) | Dry run, test on a throwaway database, and the same journal in Excel: all 10 checks PASS |
| Tax rounding fix | `core.round_half_up` matches Excel's ROUND (Python's `round()` rounds halves to even) | New test in `test_api.py` |
| Sample year loaded | Loaded into the project database with `--reset`, Excel refreshed | All checks pass |

**Sample year at a glance** (all figures are invented, from the script's assumptions):

| Item | EGP |
|---|---|
| Revenue | 391,499,700 |
| Profit before tax | 68,239,175 (17.4% of revenue) |
| Income tax (22.5%) | 15,353,814 |
| Net income | 52,885,361 |
| Total assets | 553,134,537 |
| Liabilities | 25,249,176 |
| Owner's equity | 527,885,361 |
| Closing cash | 118,188,087 |

## 3. Still to do (suggested order)

1. **Power BI model and report.** Load `/journal.csv` from the local app (Power BI Desktop, Windows only). Build a star schema: journal facts, chart of accounts, a date table, faculties. Add DAX measures (revenue, expenses, profit, tax, assets, liabilities, equity, balance check) and the report pages:
   - the accounting equation by month (assets vs liabilities + equity)
   - the statements, switchable by slicer
   - revenue and costs by faculty and fee type
   - a green/red balance indicator
   An agent cannot create the `.pbix` file; it provides the queries, measures and build steps, and you build the report.
2. **Hosting and a refresh test.** Put the backend online so refresh works without your computer. The risky step: free hosts change often, and SQLite can lose data on temporary disks (use a persistent disk or move `db.py` to PostgreSQL). Always set `CIC_API_KEY` when hosting. **Fallback:** Power BI reads a CSV exported from the app.
3. **Portfolio package.** Update `README.md`, take screenshots, record a short demo, publish to GitHub (without `cic.db` or any secrets), write CV bullets.
4. **Later expansions, only once the course covers them:** IFRS 18 income statement categories and subtotals, the operating/investing/financing cash flow split, loans and interest, depreciation, unearned revenue, prepaid expenses, ratio analysis. Do not add these without deciding to.

## 4. Extra context and decisions

- **Why a university:** recognisable, varied transactions, easy to explain in an interview. Owner-owned and for-profit, so capital, revenue, expenses and drawings all apply (a non-profit would use "net assets", which was not taught).
- **Why a web app and database:** one journal feeds both Excel and Power BI, and entering data on a page is easier than typing into Excel. This goes beyond the accounting course. It is what makes the project a portfolio piece, but **the accounting is what you will be questioned on.**
- **Scope was cut on purpose:** IFRS 18 categories, the cash flow split, loans and interest were removed because the course has not covered them. Income tax, inventory and faculties were added.
- **Tuition is billed monthly while teaching** (September to January, February to June), not as a whole semester up front. Billing a semester at once needs unearned revenue (not taught) and swung monthly profit so much that the year-to-date tax method reversed tax every month.
- **Journal layout is a contract** between the web app, API, Excel and Power BI: `EntryID, Date, TxnType, AccountID, Debit, Credit, Faculty, Description`. Do not change columns casually.
- **Chart of accounts and templates exist in two places** (`core.py` and the Excel sheets "Chart of Accounts" and "Templates"). Change both together.
- **The sample data is synthetic.** Say so clearly in the README. Real university accounts only publish annual totals, not journals; they are useful for checking proportions (for example salaries at about 60% of costs), not as a data source.

## 5. How to run

```
pip install -r requirements.txt
python app.py                                  # http://127.0.0.1:5000 (leave this window open)
python test_api.py                             # must print: Ran 10 tests ... OK
python seed_sample_year.py --dry-run           # builds and checks the sample year, posts nothing
python seed_sample_year.py --reset             # replaces existing entries with the sample year (asks you to type YES)
```

In Excel (desktop): open `CIC_Financial_Model_v2.xlsx`, then Data > Refresh All **while the app is running**. If the app is off you get "Unable to connect to the remote server"; the old data stays, nothing breaks. Settings (environment variables): `CIC_API_KEY`, `CIC_DATABASE`, `CIC_FY_START`, `CIC_TAX_RATE`.

## 6. Known limitations and gotchas

- **Desktop Excel only for the live feed.** Excel for the web has no Get Data button and cannot reach `127.0.0.1`. Power BI Desktop is also Windows only.
- **The Journal sheet holds 2,000 lines.** The sample year uses 619. Extend the formulas downward if you need more.
- **Tax must be posted monthly by the user.** The API only suggests the entry, and the Excel check "tax up to date" fails until it is posted.
- **Entry IDs may not start at 1** after you delete entries (SQLite keeps counting). This is harmless.
- **Do not save over a good workbook while testing.** Keep a known-good copy, for example `CIC_Financial_Model_v2_with_data.xlsx`.
- **Checked with LibreOffice and desktop Excel.** Hosting and Power BI refresh are untested until built.
- **Excel Journal cells in columns A-H are formulas** now. To type entries yourself, set `Assumptions!C17` to `Manual` and use the `Journal Manual` sheet.

## 7. Questions to be ready for (interview or viva)

- What is the accounting equation, and how does the expanded version work? Why must net income appear in equity?
- Accrual versus cash basis: why is revenue recorded when earned, and how does fees receivable arise?
- How are income tax and income tax payable calculated (monthly, year to date, 22.5%), and why can a month's entry be negative?
- How does the cash flow statement know which cash lines belong to which activity?
- What do the 10 checks prove, and what would a failing check point to?
- What is simplified or left out on purpose, and why?
