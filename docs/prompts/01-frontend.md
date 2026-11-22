# Prompt 1: continue CIC Journal and build the React front end (Task 5)

How to use: start a new session with access to `C:\Users\HP\Desktop\journal-project` (file tools, and the Figma connector switched on) and say:
"Read docs/prompts/01-frontend.md and follow it."

---

## Who I am and how to work with me

I am a university student. This is the CIC Journal accounting project. I am graded on the Excel workbook and Power BI; the website is an extra, so loading, empty and error states only need to be basic. I do not know Python and am comfortable with JavaScript. Explain what you did in plain language.

You cannot run commands. Work in the parts below. At the end of each part STOP and give me a numbered list of the exact commands to run (PowerShell on Windows), the output you expect, and what is untested. Do not start the next part until I paste the results.

Read first: `AGENTS.md`, `README.md`, `design/FIGMA.md`. They are the source of truth for the rules (money is integer cents, accounting rules, journal schema, tax rule). `legacy/` is the old Python version: reference only, do not delete it.

## What is DONE (verified by me running it)

1. **Restructure.** Layout from AGENTS.md exists: `server/`, `client/` (empty), `excel/`, `powerbi/`, `docs/`, `legacy/`, `design/`. Root `package.json` has `npm start` (API + client together, `concurrently`), `npm test`, `npm run build`. `.gitignore` and `.env.example` exist.
2. **Sample-year seeder.** `server/scripts/seed-sample-year.js` (`--dry-run`, `--reset`, `--csv`). It reproduces Python's random numbers, so it makes the same journal as `legacy/seed_sample_year.py`: 259 entries, 619 lines.
3. **Parity check.** Node and Python gave identical `/api/summary` and `/api/tax/suggest` for all 12 months and the same 619 journal lines. Only difference: CSV amounts are written `120000000` (Node) vs `120000000.0` (Python); Excel reads both the same. After refreshing Excel against the Node server, the Checks sheet reads ALL CHECKS PASS (10 of 10).
4. **Excel PDF downloads (backend side).**
   - API: `GET /api/reports` (list with `exported_at`, `stale`), `POST /api/reports/refresh` (needs the API key when one is set; one run at a time; 120 s limit), `GET /api/reports/<slug>.pdf` (slug whitelist; refreshes first if the PDF is missing or out of date; no API key needed for GET).
   - Slugs: `all-statements`, `financial-position`, `income-statement`, `net-income`, `cash-flows`, `owners-equity`, `notes`, `trial-balance`, `tax`, `checks`, `journal`.
   - `excel/setup-print.ps1` was run once (page setup saved by Excel; backup in `excel/backup/`).
   - `server/scripts/export-excel.ps1` works: 11 PDFs in about 24 s through the API (a fresh PDF is served instantly).
   - `EXCEL_EXPORT_MODE=static` serves existing PDFs without Excel (hosting fallback).
   - `npm test` in `server/`: 37 tests pass.
5. **README** documents the seeder, parity steps, PDF reports and first-run steps.

## What is NOT done

- **Task 5, the React front end (this prompt).** `client/` is empty. Nothing in the repo serves a page yet, so `http://127.0.0.1:5000/` shows "Cannot GET /".
- **Open item, owner action.** The Trial Balance and Journal PDFs (and those sheets in Excel) show `#######` where a column is too narrow for numbers such as `(120,000,000.00)`. `excel/fix-column-widths.ps1` was written to widen those columns. Ask me whether I have run it; if the PDFs still show `#######`, it has not been run yet (not part of this task, just remind me).
- **Excel restyle** to match the website colours: separate prompt, `docs/prompts/02-excel-redesign.md`. Do it AFTER this task, because it reuses the colours you extract here.
- **Power BI** work: a separate task, not part of this.
- Hosting/deployment is not planned yet. `legacy/` stays (AGENTS.md says to delete it after parity; I chose to keep it for now).

## Hard rules

- Never change the journal schema or the API field names (snake_case), and never change Excel formulas.
- Money is integer cents inside the server; the API speaks decimals (e.g. `118188087`, `1211100.5`).
- Never open and re-save `CIC_Financial_Model_v2.xlsx` with openpyxl, pandas, exceljs or similar (it deletes the Power Query connection). Only Excel itself may save it. Not needed in this task.
- Do not add dependencies beyond `react`, `react-dom`, `vite` (+ the Vite React plugin it needs) and `concurrently` without asking me. No UI library.

## Task 5: React front end (`client/`)

Vite + React, plain CSS with design tokens in ONE file (`client/src/tokens.css`), no UI library. Dev proxy for `/api` and `/journal.csv` to `127.0.0.1:5000`. The production build goes to `server/public` (Vite `outDir: '../server/public'`, `emptyOutDir: true`). The root `npm start` already runs `npm --prefix client run dev`, so `client/package.json` needs a `dev` script.

**Design source of truth:** Figma file `TABJwJmuvkNYfJUhodeS2H`, frame "Frame 1" (node `1:2`). Use the Figma tools (`get_design_context`, `get_screenshot`) per node and copy exact colours, spacing, fonts and radii. Do not invent styling. Before anything else, check you can call the Figma tools; if you cannot, stop and tell me. Nodes:

- the "New entry" form card is the frame named "Entries" (`23:4`, misnamed)
- "Entry Log" is rectangle `21:221` with its header texts and list area `21:231`
- the Dashboard group is `11:2` with cards Cash Position `11:31`, Accounting Equation `11:4`, Profit & Loss `11:47` and the Print Reports panel `13:4`

Write the extracted colours, fonts, spacing and radii into `design/NOTES.md` as well as `tokens.css` (the Excel redesign reuses them).

### Behaviour

- **New entry form:** copy the logic of `legacy/static/index.html`. Template select fills suggested accounts; Amount fills a simple two-line entry; faculty (BA/BT/CS) required on accounts 4010, 4050, 5010, 5090; live "Debits / Credits / Difference" bar (red style when not balanced, green when balanced); Post entry disabled until balanced, 2+ lines, date set and every line has an account; Add line; remove line (X); Suggest tax entry (calls `/api/tax/suggest` and fills the lines); Clear. If a write returns 401, ask for the API key with a prompt and store it in localStorage.
- **Entry Log:** list from `/api/entries` with columns #, Date, Type, Lines, Amount (id shown like E0001). Add small Edit and Delete buttons per row in the same outlined style as the form buttons. Edit loads the entry into the form ("Save changes", PUT); Delete asks for confirmation. Scrollable area.
- **Dashboard cards** each have their OWN "Report through" dropdown (the 12 months of the financial year, from `financial_year_start` in `/api/health`). Not synced. Each card fetches `/api/summary?through=YYYY-MM` for its own month and shows only its fields:
  - Cash Position: `cash` (as at the end of that month)
  - Accounting Equation: `assets`, `liabilities`, `equity` (as at the end of that month) plus the green "Balanced" pill, or a red "Off by X" pill when `balanced` is false
  - Profit & Loss: `profit_before_tax`, `income_tax`, `net_income` (year to date through that month)
  - Default month: the latest month that has entries, else the last month. Refresh all cards after any post, edit or delete.
- **Print Reports** buttons call `GET /api/reports/<slug>.pdf` (the slugs above, one button per report). Show "Preparing..." on the clicked button and an inline message if it fails.
  - Fetch the PDF as a blob and save it as `<slug>.pdf`. A stale or missing PDF takes about 25 s because Excel makes it; a fresh one is instant. No API key is needed for GET.
  - Failures come back as JSON `{ "errors": ["..."] }` with status 500 (export failed), 504 (timed out) or 404 (unknown slug, or static mode with no PDF yet). Show the first message inline next to the button.
  - Posts, edits and deletes make the PDFs stale automatically; the UI never has to call refresh.
- Format numbers with thousands separators and two decimals (118,188,087.00).

### API reference

Exact shapes are in `server/src/app.js` and `server/src/core.js`; read them rather than guessing. Endpoints: `GET /api/health`, `/api/accounts`, `/api/templates`, `/api/entries`, `/api/summary?through=YYYY-MM`, `/api/tax/suggest?month=YYYY-MM`, `POST/PUT/DELETE /api/entries[/:id]` (writes need header `X-API-Key` when the server has `CIC_API_KEY`), `GET /journal.csv`, and the three `/api/reports` endpoints.

### Parts (stop after each)

- **5A: scaffold and design.** Confirm Figma access. For each node run `get_design_context` and `get_screenshot`. Create `client/` (Vite + React, proxy, build output, `dev` script), `tokens.css`, `design/NOTES.md`, and the static layout of all panels (no data yet). STOP: I run `npm install` in `client/`, then `npm run dev`, and compare with Figma.
- **5B: New entry form** with all the behaviour above. STOP: I enter the lecture example from AGENTS.md through the form.
- **5C: Entry Log, Dashboard cards, Print Reports.** STOP: I run `npm run build` and `npm start`, and check the list below.

## Done means

- `npm test` passes (37 tests today; do not break them).
- `npm start` serves the API and the page; `npm run build` puts the page in `server/public` and `http://127.0.0.1:5000/` shows it.
- The lecture example (see AGENTS.md) entered through the form gives cash 5,200, assets 10,200, equity 10,200.
- Each dashboard card follows its own month.
- Every Print Reports button downloads a working PDF (with the API running and Excel installed), and shows a clear message when it fails.
- Finish with a clear list of the manual steps I still have to run.
