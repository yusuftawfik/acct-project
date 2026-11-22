# Project Plan: Canadian International College (CIC) Financial Reporting Model

**Tools:** Excel + Power BI + a data-entry UI
**Subject:** IAS 1 / IFRS 18 presentation of financial statements (definition-level, as taught)
**Core idea:** The journal starts empty. Every transaction is added through a web app that talks to a backend API and database. Excel and Power BI both read from that same journal and produce the six statements and the dashboard.

**The equations the whole model rests on**

- Basic: `Assets = Liabilities + Equity`
- Expanded: `Assets = Liabilities + (Capital + Revenue - Expenses - Drawings)`

**The six statements**

1. Statement of financial position
2. Income statement (profit or loss)
3. Net income (profit before tax, less income tax, equals net income)
4. Statement of cash flows (simple cash in and cash out)
5. Statement of owner's equity
6. Notes to disclosure

---

## Phase 0: Scope (COMPLETE)

### Scope sheet

| Item | Decision |
|---|---|
| Entity | Canadian International College (CIC), a private for-profit university with one owner |
| Currency | EGP |
| Period | 1 July to 30 June, 12 months |
| Faculties | Business Administration (BA), Business Technology (BT), Computer Science (CS) |
| Basis of accounting | Accrual: revenue and expenses are recorded when they occur, not when cash moves |
| Statements | The six taught, at definition-level layout |
| Cash flow statement | Simple cash in and cash out, no operating/investing/financing split |
| Depreciation | None; assets are held at cost |
| Inventory | Included (bought on account or for cash, later sold or consumed) |
| Income tax | Included at 22.5% (Egyptian corporate rate) on accounting profit, recorded monthly |
| Loan and interest | Out of scope (not yet taught) |
| IFRS 18 categories and subtotals | Out of scope (not yet taught); listed under later expansion |
| Unearned revenue, prepaid expenses | Out of scope (not taught); listed under later expansion |

### Assumptions

1. A single owner invests opening capital, may inject more later, and takes drawings.
2. Accrual basis: tuition billed raises revenue and fees receivable immediately; later collections only swap receivable for cash.
3. No depreciation: buildings, labs and vehicles stay at cost.
4. Every transaction has two sides, so the equation balances after each entry. Some transactions touch only one side of the equation (for example, a service on account raises assets and equity but not liabilities); others swap items within one side. Double entry handles both.
5. Inventory (bookstore stock, cafeteria supplies, lab consumables) is an asset. Buying on account raises inventory and accounts payable. When sold or consumed, inventory falls and an expense (cost of sales or supplies used) rises.
6. Income tax is 22.5% of profit before tax. Simplifications to state in the notes: tax is applied to accounting profit, and any special tax treatment of private universities is ignored.
7. There is no loan. Financing comes only from the owner's capital and additional investments.

### Reference test case (from lectures)

Used later to test the model, with a starting investment of 10,000:

1. Owner invests cash 10,000
2. Buys equipment 5,000, pays 1,500, rest on account
3. Provides service on account 1,200
4. Owner draws 1,000
5. Collects 600 from transaction 3
6. Pays 3,500 owed from transaction 2
7. Collects the remaining 600 from transaction 3

Expected end result: assets 10,200 (cash 5,200, equipment 5,000), liabilities 0, equity 10,200 (capital 10,000 + revenue 1,200 - drawings 1,000).

---

## Architecture at a glance

```
 Web app (browser form, balance meter, dashboard)
              |  HTTP / JSON
              v
 Backend API (Python, Flask): validation, tax suggestion, summaries
              |
              v
 Database (SQLite in development, PostgreSQL if hosted): the journal
              |
        +-----+---------------------------+
        v                                 v
 Excel (Power Query "Journal Feed")    Power BI (Web or database connector)
 statements + checks                   dashboard
```

The **journal schema** is the contract between every layer. The Excel workbook also works on its own with manual entry, so the project never depends on the backend being online.

---

## Phase 1: Design (COMPLETE once the schema is approved)

### 1.1 Chart of accounts (31 accounts)

IDs are labels, not amounts: 1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx revenue, 5xxx expenses.

**Statement of financial position accounts**

| ID | Account | Type | Normal balance | Statement line | Cash flow line (when opposite a cash entry) |
|---|---|---|---|---|---|
| 1010 | Cash at bank | Asset | Debit | Current assets | (the cash account itself) |
| 1100 | Fees receivable | Asset | Debit | Current assets | Received from students |
| 1110 | Other receivables | Asset | Debit | Current assets | Received from services |
| 1200 | Inventory: bookstore | Asset | Debit | Current assets | Paid to suppliers |
| 1210 | Inventory: cafeteria | Asset | Debit | Current assets | Paid to suppliers |
| 1220 | Inventory: lab and office supplies | Asset | Debit | Current assets | Paid to suppliers |
| 1500 | Land and buildings | Asset | Debit | Non-current assets | Paid for assets |
| 1510 | Lab and IT equipment | Asset | Debit | Non-current assets | Paid for assets |
| 1520 | Furniture and fittings | Asset | Debit | Non-current assets | Paid for assets |
| 1530 | Vehicles | Asset | Debit | Non-current assets | Paid for assets |
| 2010 | Accounts payable | Liability | Credit | Current liabilities | Paid to suppliers |
| 2020 | Salaries payable | Liability | Credit | Current liabilities | Paid to employees |
| 2030 | Income tax payable | Liability | Credit | Current liabilities | Paid for income tax |
| 3010 | Owner's capital | Equity | Credit | Owner's equity | Owner investment |
| 3020 | Owner's drawings | Equity | Debit | Owner's equity (deduction) | Owner drawings |

**Income statement accounts**

| ID | Account | Type | Faculty tag | Cash flow line (when opposite a cash entry) |
|---|---|---|---|---|
| 4010 | Tuition fees | Revenue | Yes | Received from students |
| 4020 | Application and registration fees | Revenue | No | Received from students |
| 4030 | Bookstore sales | Revenue | No | Received from sales |
| 4040 | Cafeteria sales | Revenue | No | Received from sales |
| 4050 | Training and consulting services | Revenue | Yes | Received from services |
| 4060 | Facility rental income | Revenue | No | Received from services |
| 5010 | Academic salaries | Expense | Yes | Paid to employees |
| 5020 | Administrative salaries | Expense | No | Paid to employees |
| 5030 | Cost of sales: bookstore | Expense | No | (non-cash) |
| 5040 | Cost of sales: cafeteria | Expense | No | (non-cash) |
| 5050 | Lab and office supplies used | Expense | No | (non-cash) |
| 5060 | Utilities | Expense | No | Paid to suppliers |
| 5070 | Marketing and admissions | Expense | No | Paid to suppliers |
| 5080 | Repairs and maintenance | Expense | No | Paid to suppliers |
| 5090 | Scholarships and discounts | Expense | Yes | Paid to students |
| 5900 | Income tax expense | Expense | No | Paid for income tax |

**Design choices**

- Faculty is a **tag** in the journal, not a separate account. Four accounts carry it: 4010, 4050, 5010, 5090. Everything else uses "Central".
- Retained profit has no account of its own. Revenue and expense accounts accumulate, and net income flows into the owner's equity statement.
- Scholarships are an expense, not a deduction from revenue.

### 1.2 Transaction templates (T01 to T29)

These are **templates, not data**. They only tell the UI what to pre-fill. The journal starts empty. A "Custom" mode lets the user pick any accounts and any number of lines, as long as debits equal credits.

"15xx" means one of 1500, 1510, 1520, 1530 (chosen at entry). "1200, 1210 or 1220" and similar are short lists chosen at entry.

**Owner**

| # | Transaction | Debit | Credit |
|---|---|---|---|
| T01 | Owner invests cash | 1010 Cash | 3010 Capital |
| T02 | Owner invests an asset | 15xx asset | 3010 Capital |
| T03 | Owner draws cash | 3020 Drawings | 1010 Cash |

**Revenue and collections**

| # | Transaction | Debit | Credit |
|---|---|---|---|
| T04 | Tuition billed | 1100 Fees receivable | 4010 Tuition (faculty tag) |
| T05 | Tuition collected later | 1010 Cash | 1100 Fees receivable |
| T06 | Tuition received in cash immediately | 1010 Cash | 4010 Tuition (faculty tag) |
| T07 | Application fees received | 1010 Cash | 4020 Application fees |
| T08 | Bookstore sale (cash) | 1010 Cash | 4030 Bookstore sales |
| T09 | Cafeteria sale (cash) | 1010 Cash | 4040 Cafeteria sales |
| T10 | Training or consulting service on account | 1110 Other receivables | 4050 Services (faculty tag) |
| T11 | Other receivable collected | 1010 Cash | 1110 Other receivables |
| T12 | Facility rental received | 1010 Cash | 4060 Rental income |
| T13 | Scholarship paid in cash | 5090 Scholarships (faculty tag) | 1010 Cash |
| T14 | Scholarship applied against fees owed | 5090 Scholarships (faculty tag) | 1100 Fees receivable |

**Inventory and suppliers**

| # | Transaction | Debit | Credit |
|---|---|---|---|
| T15 | Inventory bought on account | 1200, 1210 or 1220 | 2010 Accounts payable |
| T16 | Inventory bought for cash | 1200, 1210 or 1220 | 1010 Cash |
| T17 | Supplier paid | 2010 Accounts payable | 1010 Cash |
| T18 | Stock sold: cost recorded | 5030 or 5040 | 1200 or 1210 |
| T19 | Lab or office supplies used | 5050 Supplies used | 1220 Supplies inventory |

**Assets**

| # | Transaction | Debit | Credit |
|---|---|---|---|
| T20 | Asset bought for cash | 15xx asset | 1010 Cash |
| T21 | Asset bought on account | 15xx asset | 2010 Accounts payable |
| T22 | Asset bought part cash, part account | 15xx asset | 1010 Cash and 2010 Payable |

**Operating costs**

| # | Transaction | Debit | Credit |
|---|---|---|---|
| T23 | Salaries paid in cash | 5010 (faculty tag) or 5020 | 1010 Cash |
| T24 | Salaries earned but unpaid | 5010 or 5020 | 2020 Salaries payable |
| T25 | Salaries payable settled | 2020 Salaries payable | 1010 Cash |
| T26 | Utilities, marketing or maintenance paid in cash | 5060, 5070 or 5080 | 1010 Cash |
| T27 | Utilities, marketing or maintenance on account | 5060, 5070 or 5080 | 2010 Accounts payable |

**Income tax**

| # | Transaction | Debit | Credit |
|---|---|---|---|
| T28 | Monthly tax accrual | 5900 Tax expense | 2030 Tax payable |
| T29 | Tax paid (quarterly settlement) | 2030 Tax payable | 1010 Cash |

### 1.3 Income tax rule (monthly)

At each month end, tax is calculated on year-to-date profit:

`Tax to record = MAX(0, 22.5% x year-to-date profit before tax) - tax already recorded this year`

- A loss month lowers year-to-date profit and reduces the tax recorded earlier, so tax never goes negative overall.
- Entry: Dr 5900 Income tax expense, Cr 2030 Income tax payable.
- Settlement is a separate entry (T29), assumed quarterly, so any unpaid balance at 30 June shows as a liability.
- A Tax calculation sheet shows the amount to post each month.

### 1.4 Cash flow rule

The cash flow statement is built from journal lines that hit 1010 Cash at bank. **A cash line takes its label from the account on the opposite side of the entry**, using the "cash flow line" column in the chart of accounts.

Example: equipment 5,000, cash 1,500, payable 3,500. The cash credit of 1,500 sits opposite the equipment debit, so it lands under "Paid for assets". When the 3,500 payable is settled later, that cash lands under "Paid to suppliers".

Open item for Phase 2: when a cash line has several accounts on the opposite side, decide how to allocate it (for example, proportionally).

### 1.5 Journal schema (the contract)

One row per debit or credit line. Several rows sharing an EntryID form one transaction. The journal starts empty.

**Columns the UI writes**

| Column | Meaning | Rule |
|---|---|---|
| EntryID | Groups the lines of one transaction | Auto-generated, unique per transaction |
| Date | When it happened | Must fall within 1 July to 30 June |
| TxnType | T01 to T29, or "Custom" | From the templates or Custom |
| AccountID | Which account the line hits | Must exist in the chart of accounts |
| Debit | Amount, if a debit line | Positive number, else blank |
| Credit | Amount, if a credit line | Positive number, else blank |
| Faculty | BA, BT, CS or Central | Required for 4010, 4050, 5010, 5090; otherwise Central |
| Description | Free text | Optional |

**Columns calculated by Excel and Power BI (never typed)**

| Column | Comes from |
|---|---|
| AccountName, AccountType, StatementLine | Lookup on AccountID |
| CashFlowLine | Lookup on the account on the opposite side of a cash line |
| FiscalMonth | Calculated from Date (July = 1, June = 12) |

**Validation rules (enforced by the UI and the Checks sheet)**

1. For each EntryID, total debits equal total credits.
2. A line has a debit or a credit, never both, and never zero.
3. The account must exist, and the date must be in the financial year.
4. Faculty is mandatory on the four tagged accounts.

**Example:** lecture transaction 2 (equipment 5,000, paid 1,500, rest on account), entered 10 July.

| EntryID | Date | TxnType | AccountID | Debit | Credit | Faculty | Description |
|---|---|---|---|---|---|---|---|
| E0002 | 10 Jul | T22 | 1510 | 5,000 | | Central | Lab computers |
| E0002 | 10 Jul | T22 | 1010 | | 1,500 | Central | Lab computers |
| E0002 | 10 Jul | T22 | 2010 | | 3,500 | Central | Lab computers |

---

## Phase 2: Excel model

1. **Sheets:** README, Assumptions, Chart of Accounts, Journal (empty Excel Table), Entry, Trial Balance, Tax, the six statements, Checks.
2. **Journal as an Excel Table**, so new rows flow into every formula automatically.
3. **Entry sheet** with a transaction-type dropdown that pre-fills the debit and credit accounts, plus a Custom mode. Account and faculty dropdowns come from the chart of accounts.
4. **Trial balance** by month using SUMIFS, the single source for every statement.
5. **Tax sheet** applying the monthly year-to-date rule from 1.3.
6. **Statements**, each driven by a period selector:
   - Statement of financial position
   - Income statement (revenue minus expenses, giving profit before tax)
   - Net income summary (profit before tax, income tax at 22.5%, net income)
   - Statement of cash flows (cash received, cash paid, closing cash, by label from 1.4)
   - Statement of owner's equity (opening capital + investments + net income - drawings)
   - Notes to disclosure (revenue by faculty and type, inventory, tax assumption, accounting policies)
7. **Checks sheet** with pass/fail tests:
   - Assets = Liabilities + Equity
   - Total debits = total credits, and every EntryID balances
   - Closing cash = cash flow ending balance
   - Equity statement closing = SFP equity
   - Year-end tax expense = 22.5% of full-year profit before tax (when the year is profitable)

## Phase 3: Data

8. The journal starts empty. Opening balances, if any, are entered through the UI like any other entry.
9. Two options for the demo year, to decide later: enter transactions manually through the UI, or generate a sample CSV of realistic entries (fee spikes at semester starts, steady payroll, inventory purchases, an equipment purchase) and import it.
10. Whichever is chosen, include deliberate edge cases: unpaid fees collected later, an owner injection, a drawing, a payable settled in a later month.

## Phase 4: Test the Excel model

11. Enter the **reference test case** from Phase 0 through the UI and confirm the expected end balances.
12. Hand-check every statement against the journal for two or three months.
13. Add a test transaction and confirm all six statements and the checks update.
14. Enter a deliberately wrong entry and confirm the checks flag it.

## Phase 5: Backend, web app and connections

Excel model (Phase 2) is built. Phase 5 adds the layers that feed it. Build in stages, testing each before the next.

### 5A. Baseline: Excel Entry sheet (DONE)
- Entry helper in the workbook with a balance indicator, for use without any backend.

### 5B. Backend API and database
- Language and framework: Python with Flask. Database: SQLite while developing; PostgreSQL if hosted (SQLite data can be lost on hosts with temporary disks).
- Tables: entries (id, date, transaction type, description) and lines (account, debit, credit, faculty).
- The backend enforces the four schema validation rules, so bad data can never be stored.
- Endpoints: list, add, edit and delete entries; summary by month; monthly tax suggestion (same year-to-date formula as the Excel Tax sheet); journal feed as CSV and JSON in the exact Journal column layout.
- Simple API key protects writes.
- Automated tests, including a cross-check that the feed reproduces the Excel test-case results.

### 5C. Web app
- Transaction-type dropdown (T01 to T29 and Custom) that pre-fills accounts; multi-line entry for Custom and mixed transactions.
- Live balance meter; post button disabled until debits equal credits.
- Table of entries with edit and delete.
- "Suggest tax entry" button that calls the tax endpoint and pre-fills T28.
- Mini dashboard: assets, liabilities, equity, balance check.

### 5D. Connect Excel and Power BI
- Excel: add a "Journal Feed" sheet loaded by Power Query from the API; the Journal reads from it so no pasting is needed. Manual entry stays as a fallback.
- Power BI: connect to the same feed.
- Confirm early, with a tiny test, that refresh works from the hosted API (desktop Excel for Power Query; the API must be publicly reachable for Power BI cloud refresh).

### 5E. Hosting and security
- Deploy to a free tier after checking its current terms; write step-by-step instructions.
- Set the API key as an environment variable; never commit it.

## Phase 6: Power BI model

22. Load the Excel tables with Power Query.
23. Build a **star schema:** journal fact table plus date, account and faculty dimensions.
24. Write **DAX measures** with careful sign conventions:
    - Totals by account type
    - Statement of financial position lines
    - Income statement lines, profit before tax, income tax and net income
    - Cash received and cash paid by cash flow line
    - Equity roll-forward
    - Balance-check measure
25. Add a what-if parameter (for example, tuition change in percent) if the maths flows through cleanly, including its effect on tax.

## Phase 7: Power BI report

26. Choose a theme (custom JSON theme for colours and fonts) and a consistent page grid.
27. Build these pages:
    - Home and navigation
    - Accounting equation overview
    - Statement of financial position
    - Income statement and net income
    - Cash flows
    - Owner's equity
    - Notes and faculty breakdown
    - Data checks
    - How to use
28. Add polish: bookmarks, drill-through from statements to journal lines, tooltips, properly formatted matrices.

## Phase 8: Publish and connect

29. Store the Excel file on OneDrive and point the model at it.
30. Publish to a workspace, configure scheduled refresh, and test that a new entry (from the UI) reaches the report.
31. Note: embedding the Power BI report inside the custom website is a paid-licence feature. If unavailable, link to the published report or show screenshots instead.

## Phase 9: Documentation and portfolio

32. Write the README: purpose, structure, assumptions, how to use, data dictionary, UI description.
33. Export the report to PDF, take screenshots, record a short demo that includes entering a transaction through the UI and watching the statements update.
34. Put everything on GitHub (model files, web app, screenshots, README) and write two or three CV bullets focused on automation, controls and the entry UI.

---

## Later expansion (once taught)

- IFRS 18 income statement categories (operating, investing, financing) and new subtotals
- Cash flow statement split into operating, investing and financing activities
- Loans and interest
- Depreciation
- Unearned revenue and prepaid expenses
- Ratio analysis and additional statements

The model is built so these slot in without a rebuild.

## Success criteria

- Adding one transaction through the UI updates every statement and the dashboard.
- All checks on the Checks sheet pass.
- The reference test case from Phase 0 produces the expected balances.
- The model contains no hard-coded statement figures.
- A stranger can follow the README and use the model without help.
