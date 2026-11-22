# Prompt 2: restyle the Excel workbook to match the website colour scheme

How to use: do this AFTER the front end (Prompt 1) has produced the design tokens (`client/src/tokens.css` and `design/NOTES.md`). Start a session with access to `C:\Users\HP\Desktop\journal-project` (file tools, plus the Figma connector if the tokens do not exist yet) and say:
"Read docs/prompts/02-excel-redesign.md and follow it."

---

## Goal

Make `excel/CIC_Financial_Model_v2.xlsx` look like my website redesign: same colour scheme, same feel. I am graded on this workbook, so it must stay correct and readable above all. This is a styling job only. Explain what you did in plain language (I know JavaScript, not Python or PowerShell).

You cannot run Excel or PowerShell. Work in the parts below. At the end of each part STOP and give me a numbered list of the exact commands to run (Windows PowerShell), the output you expect, and what is untested. Do not start the next part until I paste the results.

## Where the colours come from

1. `client/src/tokens.css` and `design/NOTES.md` (written during the front-end task). Use them as the palette.
2. If they do not exist yet, get the colours from Figma file `TABJwJmuvkNYfJUhodeS2H`, frame "Frame 1" (node `1:2`), with the Figma tools (`get_design_context`, `get_screenshot`). Then write them to `design/NOTES.md`. Do not invent colours.

## HARD RULES for the workbook

- NEVER open and re-save the workbook with openpyxl, pandas, exceljs, xlsx-populate or similar. The workbook contains a Power Query connection (`JournalFeed`, loaded from `http://127.0.0.1:5000/journal.csv`) and those libraries silently delete it. Only Excel itself, driven by PowerShell COM, may save it.
- Reading is fine: you may unzip a COPY of the xlsx and read the XML to inspect it. Never write into the xlsx archive.
- Reuse the pattern of `excel/setup-print.ps1` and `excel/fix-column-widths.ps1`: check Excel is closed, make a timestamped backup in `excel/backup/` BEFORE changing anything, open with Excel COM, change, check the Power Query connection count did not change, save with `$wb.Save()`, quit Excel and release COM objects, exit non-zero with a clear message on failure.
- Do not change: formulas, sheet names, named ranges (for example `JournalSource` = `Assumptions!C17`), the Power Query connection or query, table names, data validation lists, cell positions (no inserted or deleted rows or columns, no moved cells), the journal columns (`EntryID, Date, TxnType, AccountID, Debit, Credit, Faculty, Description`), or the page setup from `setup-print.ps1`.
- Allowed: fills, fonts, font colours, borders, alignment, tab colours, column widths, row heights, table style colours, conditional-format colours (keep each rule's condition and range exactly as it is, only change its colours), and number formats only where needed. Keep amounts as thousands separators with two decimals.
- COM colours are BGR, not RGB. Use a helper: `function Rgb([string]$hex){ $r=[Convert]::ToInt32($hex.Substring(1,2),16); $g=[Convert]::ToInt32($hex.Substring(3,2),16); $b=[Convert]::ToInt32($hex.Substring(5,2),16); return $r + ($g*256) + ($b*65536) }`.
- The font: use the website's font only if it is installed on my Windows PC and normal on others. Otherwise use the closest system font (the workbook uses Calibri and Arial today) and tell me which one you chose and why.

## What exists today (read from the file)

18 visible sheets, each with a tab colour that already groups them by role:

| Sheets | Role | Tab colour now |
|---|---|---|
| README | guide | dark navy `1F3864` |
| Chart of Accounts, Assumptions, Templates | reference and inputs (Assumptions has 2 data-validation dropdowns) | gold `BF9000` |
| Journal (conditional formats: 2), Entry (1) | data entry and the journal table | red `C00000` |
| Journal Manual | manual-entry fallback (1 data validation) | orange `ED7D31` |
| Trial Balance, Tax (conditional format: 1) | calculation | grey `7F7F7F` |
| Financial Position (cond. format: 1), Income Statement, Net Income, Cash Flows, Owners Equity, Notes, JournalFeed | statements | blue `2E75B6` |
| Checks (conditional formats: 2) | integrity checks (PASS / FAIL) | green `548235` |
| Test Case (cond. format: 1) | lecture example | purple `7030A0` |

The Journal sheet is an Excel table (`JournalTable`, header row 4, data rows 5 to 2004, columns A to S). Print areas, fit-to-one-page-wide and headers/footers were set by `setup-print.ps1` and must survive.

## Parts (stop after each)

### E1: inspect and propose (read only, no changes to the workbook)

1. Inspect the workbook (unzip a copy and read the XML, or open it read-only). For each sheet note: title rows, header rows, input cells, total/subtotal rows, section labels, negative numbers, conditional formats and what they colour, table styles, comments.
2. Write `docs/excel-style-guide.md`: (a) the palette: each website token mapped to an Excel role (title band, header fill, header text, section label, input cell, calculated cell, total row, positive/PASS, negative/FAIL, neutral border, tab colours per role); (b) one styling recipe per kind of sheet (statement, calculation, input/reference, journal/data, checks); (c) the font decision.
3. Accessibility: text on any fill must keep a contrast ratio of at least 4.5:1; say which pairs you checked. Printing: no full-page dark fills (they waste ink and print badly); use dark fills only for header bands; keep body areas light.
4. STOP. I review the guide (and compare with the website) and approve or change it.

### E2: write `excel/restyle.ps1`

1. A palette block at the top of the script (name to hex) so I can tune colours by editing one place. The rest of the script only refers to palette names.
2. The script styles every sheet by the recipes in the approved guide, and re-colours the tabs and the conditional-format colours (conditions and ranges untouched). It must be safe to run twice (idempotent).
3. Column widths: every amount column at least 18 wide (the house standard; amounts reach `(553,134,537.00)`), dates at least 13. No `#######` anywhere. The Journal sheet column A is 49.9 wide today although it only holds `E0001`-style ids; propose a sensible width if it helps the one-page-wide Journal PDF.
4. STOP. I close Excel and run: `powershell -ExecutionPolicy Bypass -File excel\restyle.ps1`, then open the workbook and look.

### E3: verify and iterate

1. I start the server with the sample year (see README) and run `server\scripts\export-excel.ps1` (or `POST /api/reports/refresh`).
2. Baseline for the 259-entry sample year before the restyle: `all-statements.pdf` 7 pages, `trial-balance.pdf` 1, `journal.pdf` 7, `checks.pdf` 1, `tax.pdf` 1, and no `#######`. After the restyle the layout should be essentially the same. Report any change in page count.
3. `checks.pdf` must still say ALL CHECKS PASS. Formulas are untouched, so any change there is a bug.
4. Ask me which sheets or colours to adjust; change the palette block and rerun. Repeat until I am happy.

## Done means

- The workbook visibly matches the website colours, on screen and in the exported PDFs.
- No formula, name, sheet name, column or position changed (Excel's Checks sheet and the Test Case lecture example still give the same results).
- The Power Query connection still works (Data > Refresh All loads the journal from the running API).
- No `#######` on screen or in any PDF; page setup and the PDF export still work.
- A backup of every earlier state is in `excel/backup/`, and `docs/excel-style-guide.md` explains the palette.

Out of scope: Power BI. (Once the palette is final, a matching Power BI theme file can be a separate, small task.)
