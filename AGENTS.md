# AGENTS.md

Guidance for AI coding agents working on this project. Read this before changing anything.

## Project

**Canadian International College (CIC) financial reporting model.** A university accounting project (IAS 1 / IFRS 18 presentation, taught at definition level) built as a portfolio piece.

Data flow: React web app -> Node/Express API -> SQLite journal -> Excel workbook (six statements) and Power BI (analysis dashboard).

The fictional entity is a private for-profit university with one owner, currency EGP, financial year 1 July to 30 June (default FY 2026/27), three faculties: BA (Business Administration), BT (Business Technology), CS (Computer Science), plus "Central" for shared items.

The owner of this project is new to Python and comfortable with JavaScript. Everything new is JavaScript/Node. Explain accounting rules in plain language when you change them.

## Layout

| Path | Purpose |
|---|---|
| `server/src/core.js` | Pure business logic: 31 accounts, 30 templates, validation, summaries, monthly tax suggestion. No web or database code. |
| `server/src/db.js` | SQLite layer (`better-sqlite3`). Tables `entries` and `lines`. Amounts stored as integer cents. |
| `server/src/app.js` | Express API (`createApp(config)`), static serving of `server/public`. Settings come from environment variables. |
| `server/src/index.js` | Starts the server. |
| `server/test/` | Automated tests (`node:test`, no test libraries). |
| `server/scripts/` | One-off tools, for example the sample-year seeder (to be ported from `seed_sample_year.py`). |
| `server/public/` | Front end build output, used when hosting as a single app. |
| `client/` | React front end (Vite), built from the Figma design. |
| `excel/` | `CIC_Financial_Model_v2.xlsx`, the live-feed Excel model (18 sheets, including JournalFeed and Journal Manual). |
| `powerbi/` | `dim_accounts.csv`, `POWER_BI_GUIDE.md`, later the `.pbix`. |
| `design/` | Figma link and exported images. |
| `docs/` | Project plan and status notes. |
| `legacy/` | The old Python/Flask version, kept only as the reference for the parity check. Do not extend it. Delete it once parity passes. |

Not every folder exists yet. Check the real directory before assuming; see Status.

## Commands

```
cd server
npm install
npm test               # must end with: fail 0
npm start              # http://127.0.0.1:5000
npm run dev            # restarts on file changes
```

Settings (environment variables): `CIC_API_KEY` (protects writes; empty means open, development only), `CIC_DATABASE` (default `server/data/cic.db`), `CIC_FY_START` (default `2026-07-01`), `CIC_TAX_RATE` (default `0.225`), `PORT` (default `5000`).

Requires Node 18 or newer (developed on Node 24).

## Rules that must not be broken

**Money**
- Every amount in `core.js` and in the database is an integer number of cents. Never add, subtract or compare decimal amounts. Convert only at the edges: `toCents` on the way in, `toMoney` on the way out. The API sends and receives normal decimal amounts (for example `19.99`).
- Compare money for equality exactly (`===` on cents). There is no tolerance.
- Tax rounding is exact half-up using integer (BigInt) math, matching Excel's `ROUND`. Never use `Math.round`, `toFixed` or floating point on the tax result.

**Accounting**
- Accrual basis. Revenue is recorded when earned, not when cash arrives.
- Every entry balances: total debits equal total credits.
- `Net = Debit - Credit`. Assets, expenses and drawings are debit-normal; liabilities, capital and revenue are credit-normal.
- Accounting equation: `Assets = Liabilities + (Capital + Revenue - Expenses - Drawings)`.
- Account IDs are labels, never amounts: 1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx revenue, 5xxx expenses.

**Journal schema** (the contract between UI, API, Excel and Power BI; do not change columns casually):
`EntryID, Date, TxnType, AccountID, Debit, Credit, Faculty, Description`. One row per debit or credit line; rows sharing an EntryID are one transaction. Served at `/journal.csv`.

**Validation** (enforced by `validateEntry` in `core.js` and mirrored in Excel): date inside the financial year; at least two lines; each line has a debit or a credit, never both, never zero, never negative; account must exist; faculty (BA, BT or CS) required on accounts 4010, 4050, 5010, 5090, otherwise "Central"; debits equal credits.

**Income tax** (monthly, year-to-date): `suggested = ROUND(MAX(0, rate x YTD profit before tax)) - tax expense recorded in earlier months`. Entry: Dr 5900 Income tax expense, Cr 2030 Income tax payable; a negative amount reverses that entry. `to_post = suggested - already posted this month`; the API proposes an entry only when `to_post` is at least 0.50, so a posted entry is never offered twice. Profit before tax excludes account 5900.

**Months:** a bare number in `through` or `month` means a *fiscal* month (1 = July). `YYYY-MM` means that calendar month. Keep this behaviour; tests depend on it.

**Cash flow:** built from lines hitting account 1010. A cash line takes its label from the account on the opposite side of the entry (the account's cash flow line in the chart of accounts). If several accounts are opposite, cash is split in proportion to their amounts. Statements are simple cash received and cash paid, with no operating/investing/financing split.

**Keep in sync:** the chart of accounts and templates exist in two places, `server/src/core.js` and the Excel sheets "Chart of Accounts" and "Templates" (plus `powerbi/dim_accounts.csv`). Change all together.

## Design (front end)

- Source of truth: the Figma file `TABJwJmuvkNYfJUhodeS2H` (use the Figma tools, `get_design_context` and `get_screenshot`, rather than guessing). Keep the existing styling.
- Palette: burgundy `#960003` for table header rows, filled buttons and the "Dashboard" title; white cards on a light page background; black 1px card borders; gray secondary text; green only for the "Balanced" state.
- Cards: 15px corner radius, Inter font, burgundy header row with white bold labels, white data row.
- Layout: Data Entry card on top; Dashboard below with three cards on the left (Cash Position, Accounting Equation with the Balanced indicator, Profit & Loss) and a Print Reports panel on the right.
- The Profit & Loss card is the dashboard summary (Profit before tax, Income tax, Net income). "Income Statement" is a separate Excel sheet that gets printed.
- Match states the design does not show (loading, empty, error, unbalanced) to the same style and tell the owner what you chose.

## Out of scope (not yet taught; do not add without asking)

IFRS 18 income statement categories and subtotals, the operating/investing/financing cash flow split, loans and interest, depreciation, unearned revenue, prepaid expenses, ratio analysis.

## Conventions

- Node 18+, ES modules, Express 4, `better-sqlite3`. No ORM, no extra dependencies unless there is a clear need.
- Keep business rules in `core.js` and keep it free of Express and SQL so it stays easy to test.
- Every behaviour change needs a test. Tests must pass before finishing.
- Never commit secrets. `CIC_API_KEY` is an environment variable only. `server/data/` and `*.db` are local data and must not be committed.
- API field names stay snake_case (`account_id`, `txn_type`) so Excel, Power BI and the front end agree.

## Reference test case (lecture example)

Entries (starting investment 10,000): owner invests 10,000; equipment 5,000 paid 1,500 and 3,500 on account; service on account 1,200; owner draws 1,000; collect 600; pay supplier 3,500; collect 600. Expected: cash 5,200, assets 10,200, liabilities 0, equity 10,200. After posting the suggested July tax of 270: net income 930, tax payable 270, equity 9,930. The Excel workbook has a "Test Case" sheet with the same data. `server/test/api.test.js` encodes it.

## Status

Done and verified:
- Node backend: `core.js`, `db.js`, `app.js`, same endpoints as the Python version. 18 tests pass on Node 24.
- Excel workbook built, recalculated with zero errors, lecture example and stress cases match. Checked with LibreOffice only, not Microsoft Excel itself.
- Excel live feed: the JournalFeed sheet is loaded by Power Query from `/journal.csv`; Journal columns A-H read from it when `Assumptions!C17` (named range `JournalSource`) is `Feed`, or from the Journal Manual sheet when it is `Manual`. Refresh with Data > Refresh All while the server is running (desktop Excel only).

Not done yet, in suggested order:
1. Restructure into the layout above (move the Excel file, `powerbi/`, docs; put the Python version in `legacy/`).
2. Port `seed_sample_year.py` to `server/scripts/` (JavaScript, same assumptions, `--dry-run` first).
3. Parity check: load the same sample year into the Python and Node versions and compare `/api/summary` for every month, `/api/tax/suggest` for every month, and `/journal.csv`. Refresh Excel against the Node server and confirm all 10 checks pass. Then delete `legacy/`.
4. React front end from the Figma design (`client/`).
5. Print endpoints or print views for the statements (see Known limitations).
6. Hosting and a refresh test. SQLite on hosts with temporary disks can lose data; use a persistent disk or move `db.js` to PostgreSQL. Always set `CIC_API_KEY` when hosting.
7. Power BI model (star schema, DAX measures), report pages and theme. The `.pbix` cannot be generated by an agent; provide queries, measures and build steps.
8. Portfolio package: README, screenshots, demo recording, GitHub repository, CV bullets.

## Known limitations

- The API only has summary, tax suggestion, entries, accounts, templates and the journal feed. The six statements, Trial Balance, Tax and Checks pages shown as print buttons in the design are computed in Excel only. The API has no endpoints for them yet.
- The Journal sheet in Excel holds 2,000 lines; extend its formulas downward if more are needed.
- Tax must be posted monthly by the user (the API only suggests the entry), and the Excel Checks sheet fails until it is.
- Hosting and Power BI refresh are untested until built. Excel for the web cannot reach `127.0.0.1`, so the live feed needs desktop Excel until the backend is hosted.
- Tuition in the sample year is billed monthly while teaching (no unearned revenue yet); billing a whole semester up front would swing profit and make the YTD tax method reverse tax each month.
