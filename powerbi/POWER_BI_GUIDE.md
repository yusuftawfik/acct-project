# Power BI guide: CIC dashboard

Build the report in **Power BI Desktop** (Windows). The data comes from the local app, so the pages work with no hosting.
I could not run Power BI myself, so the queries and measures below are untested in Desktop. The "expected values" in section 6 were computed separately from the same journal, so you can check every measure against them.

Files used: `powerbi/dim_accounts.csv` (account list with statement lines and presentation signs).
Save your report as `powerbi/CIC_Dashboard.pbix`.

---

## 1. Load the data

Before you start, run `python app.py` in a terminal and leave it open. Check that `http://127.0.0.1:5000/journal.csv` shows rows in your browser.

For each query below: **Home > Get data > Blank query > Advanced Editor**, delete everything in the box, paste the code, click Done, and rename the query in the right-hand pane.

### Query `Journal`

```
let
    Source = Csv.Document(
        Web.Contents("http://127.0.0.1:5000/journal.csv"),
        [Delimiter = ",", Columns = 8, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]
    ),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Typed = Table.TransformColumnTypes(
        Promoted,
        {
            {"EntryID", Int64.Type}, {"Date", type date}, {"TxnType", type text},
            {"AccountID", Int64.Type}, {"Debit", type number}, {"Credit", type number},
            {"Faculty", type text}, {"Description", type text}
        },
        "en-US"
    ),
    NoBlanks = Table.ReplaceValue(Typed, null, 0, Replacer.ReplaceValue, {"Debit", "Credit"}),
    WithNet = Table.AddColumn(NoBlanks, "Net", each [Debit] - [Credit], type number)
in
    WithNet
```

If Power BI asks about credentials or privacy levels, choose **Anonymous** and Connect.

### Query `Accounts`

```
let
    Source = Csv.Document(
        File.Contents("C:\Users\HP\Desktop\project_1\powerbi\dim_accounts.csv"),
        [Delimiter = ",", Columns = 9, Encoding = 65001, QuoteStyle = QuoteStyle.Csv]
    ),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Typed = Table.TransformColumnTypes(
        Promoted,
        {
            {"AccountID", Int64.Type}, {"AccountName", type text}, {"Type", type text},
            {"NormalBalance", type text}, {"StatementLine", type text}, {"FacultyTag", type text},
            {"CashFlowLine", type text}, {"PresentationSign", Int64.Type}, {"SortOrder", Int64.Type}
        }
    )
in
    Typed
```

### Query `Faculties`

```
let
    Source = #table(
        type table [Faculty = text, FacultyName = text],
        {
            {"BA", "Business Administration"},
            {"BT", "Business Technology"},
            {"CS", "Computer Science"},
            {"Central", "Central (shared)"}
        }
    )
in
    Source
```

Then **Home > Close & Apply**.

## 2. Calendar table

**Modeling > New table**, paste:

```
Calendar =
ADDCOLUMNS(
    CALENDAR(DATE(2026, 7, 1), DATE(2027, 6, 30)),
    "Month", FORMAT([Date], "mmm yyyy", "en-US"),
    "Month sort", YEAR([Date]) * 100 + MONTH([Date]),
    "Fiscal month", MOD(MONTH([Date]) + 5, 12) + 1
)
```

- Select the `Month` column, then Column tools > **Sort by column** > `Month sort`.
- Select the table, Table tools > **Mark as date table** > choose `Date`.
- If you change `CIC_FY_START`, change the two dates in this formula.

Add one calculated column to `Accounts` (**New column**) so statement sections appear in a sensible order:

```
Statement order = CALCULATE(MIN(Accounts[SortOrder]), ALLEXCEPT(Accounts, Accounts[StatementLine]))
```

Then sort `Accounts[StatementLine]` by `Statement order`, and `Accounts[AccountName]` by `SortOrder`.

## 3. Relationships (Model view)

All one-to-many, single direction, from the dimension to `Journal`:

| From (one) | To (many) |
|---|---|
| `Accounts[AccountID]` | `Journal[AccountID]` |
| `Calendar[Date]` | `Journal[Date]` |
| `Faculties[Faculty]` | `Journal[Faculty]` |

## 4. Measures

Select the `Journal` table and use **New measure** for each. Keep sign rules in mind: `Net = Debit - Credit`, so revenue and liabilities are negative in `Net`.

**Basics and the income statement**

```
Debit Total = SUM(Journal[Debit])
Credit Total = SUM(Journal[Credit])
Net Movement = SUM(Journal[Net])

Revenue = -CALCULATE([Net Movement], Accounts[Type] = "Revenue")
Expenses before tax = CALCULATE([Net Movement], Accounts[Type] = "Expense", Accounts[AccountID] <> 5900)
Profit before tax = [Revenue] - [Expenses before tax]
Income tax = CALCULATE([Net Movement], Accounts[AccountID] = 5900)
Net income = [Profit before tax] - [Income tax]
Profit margin = DIVIDE([Profit before tax], [Revenue])
```

**Statement amounts** (signed so assets, liabilities, equity, revenue and expenses all show as positive numbers; drawings show as a deduction):

```
Amount = SUMX(Journal, Journal[Net] * RELATED(Accounts[PresentationSign]))

Amount to date =
VAR d = MAX('Calendar'[Date])
RETURN CALCULATE([Amount], FILTER(ALL('Calendar'), 'Calendar'[Date] <= d))
```

**The accounting equation** ("as at the end of the selected period"):

```
Net to date =
VAR d = MAX('Calendar'[Date])
RETURN CALCULATE([Net Movement], FILTER(ALL('Calendar'), 'Calendar'[Date] <= d))

Assets = CALCULATE([Net to date], Accounts[Type] = "Asset")
Liabilities = -CALCULATE([Net to date], Accounts[Type] = "Liability")
Capital = -CALCULATE([Net to date], Accounts[AccountID] = 3010)
Drawings = CALCULATE([Net to date], Accounts[AccountID] = 3020)
Net income to date = -CALCULATE([Net to date], Accounts[Type] IN {"Revenue", "Expense"})
Equity = [Capital] + [Net income to date] - [Drawings]
Liabilities and equity = [Liabilities] + [Equity]
Equation difference = [Assets] - [Liabilities and equity]
Balance status = IF(ABS([Equation difference]) < 0.5, "BALANCED", "OUT OF BALANCE")

Cash = CALCULATE([Net to date], Accounts[AccountID] = 1010)
Fees receivable = CALCULATE([Net to date], Accounts[AccountID] = 1100)
```

**Faculty view**

```
Faculty contribution = [Revenue] - [Expenses before tax]
```

Only some accounts carry a faculty (tuition, training income, academic salaries, scholarships). The rest sit under "Central", so a faculty's contribution is **before shared costs**. Label it that way on the page.

## 5. Report pages (first round)

1. **Overview.** Cards: Revenue, Profit before tax, Net income, Cash. A card for `Balance status`, with conditional formatting (green for BALANCED, red otherwise). A clustered column chart with `Calendar[Month]` on the axis and `Assets` and `Liabilities and equity` as values: this is the accounting equation by month, and the two columns should always match.
2. **Income statement.** Matrix: rows `Accounts[StatementLine]` then `Accounts[AccountName]`, value `Amount`. Cards for Profit before tax, Income tax and Net income. Slicer on `Calendar[Month]` (multi-select).
3. **Financial position.** Matrix with the same rows, value `Amount to date`. Cards for Assets, Liabilities, Equity and `Net income to date`. Slicer on `Calendar[Month]` set to single select. Equity = Capital + Net income to date - Drawings, so the matrix's equity section will not add up to Equity on its own: show the `Net income to date` card beside it.
4. **Faculties and revenue.** Bar chart: `Faculties[FacultyName]` with `Revenue`. Stacked column: `Calendar[Month]` with `Revenue` by `Accounts[AccountName]`. Treemap of `Expenses before tax` by `Accounts[AccountName]`. Table of `Faculty contribution` by faculty.

**Not in this round (next):** the cash flow statement, the owner's equity statement and the notes. The cash flow page needs each cash line classified by its opposite account, as the Excel model does; that is best done in Power Query and I will build it next.

## 6. Expected values (check every measure against these)

With no slicers, using the sample year (seed 2026):

| Measure | Expected |
|---|---|
| Revenue | 391,499,700 |
| Expenses before tax | 323,260,525 |
| Profit before tax | 68,239,175 |
| Income tax | 15,353,814 |
| Net income | 52,885,361 |
| Assets | 553,134,537 |
| Liabilities | 25,249,176 |
| Capital | 520,000,000 |
| Drawings | 45,000,000 |
| Equity | 527,885,361 |
| Cash | 118,188,087 |
| Equation difference | 0 |

Revenue by faculty: BA 96,984,900; BT 110,077,800; CS 136,781,400; Central 47,655,600.

By month (assets at month end / net income in the month): July 526,448,260 / -22,980,050; December 522,403,995 / +11,600,039; June 553,134,537 / +6,895,044.

Journal rows loaded: 619.

## 7. If something goes wrong

- **"Unable to connect" or a Web.Contents error:** the app is not running. Start `python app.py`, then Home > Refresh.
- **Totals are different from the table above:** you may have different data in the database (for example your own test entries). Re-run `python seed_sample_year.py --reset` and refresh.
- **Revenue shows as negative:** the sign is flipped in the measure. Check the leading minus.
- **The equation chart shows only part of the year:** `Calendar` does not cover your dates, or the relationship to `Journal[Date]` is missing.
