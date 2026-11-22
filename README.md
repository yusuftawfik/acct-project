# CIC Journal (Node port)

Port of the Python backend in `project_1` to Node. The Python version stays in `project_1` as the reference until the numbers match.

```
journal-project/
  server/       Node API, business logic, database, tests
    src/core.js   business rules (money as whole cents)
    src/db.js     SQLite (better-sqlite3)
    src/app.js    Express API (same endpoints as the Python app)
    src/reports.js  PDF reports made by Excel: list, refresh, download
    src/index.js  starts the server
    test/         core + API tests
    public/       front end build goes here (optional for now)
```

## Run

```
cd server
npm install
npm test        # all tests must pass
npm start       # http://127.0.0.1:5000
```

Settings (environment variables): `CIC_API_KEY`, `CIC_DATABASE` (default `server/data/cic.db`), `CIC_FY_START` (default `2026-07-01`), `CIC_TAX_RATE` (default `0.225`), `PORT` (default `5000`), `EXCEL_PATH` (default `excel/CIC_Financial_Model_v2.xlsx`), `EXCEL_EXPORT_MODE` (`live` or `static`, default `live`; see PDF reports below).

To try the old web page against the Node API, copy `project_1\static\index.html` to `server\public\index.html` (create the `public` folder first).

## Sample data (one synthetic financial year)

The seeder builds an invented year (259 entries, 619 journal lines) and posts it through the API. Run it from `server/`:

```
node scripts/seed-sample-year.js --dry-run     # build and check the year, post nothing (no server needed)
node scripts/seed-sample-year.js               # post to http://127.0.0.1:5000 (server must be running)
node scripts/seed-sample-year.js --reset       # delete existing entries first (asks you to type YES)
node scripts/seed-sample-year.js --dry-run --csv sample_journal.csv
```

If the server has `CIC_API_KEY` set, pass `--api-key KEY` or set the same environment variable. The numbers are meant to be identical to the old Python seeder (the script reproduces Python's random number generator, fixed seed 2026); the parity check confirms it.

## PDF reports (made by Excel)

Every PDF is produced by Excel itself, never by the server. The server only decides when to run the export script (`server/scripts/export-excel.ps1`) and then streams the file from `excel/exports/`.

| Endpoint | What it does |
|---|---|
| `GET /api/reports` | Lists the 11 reports: `slug`, `title`, `available`, `exported_at`, `stale`, plus `mode`, `running`, `last_run` |
| `POST /api/reports/refresh` | Runs the Excel export (one at a time, 120 s limit). Needs the API key when one is set. `409` if an export is already running or the mode is `static` |
| `GET /api/reports/<slug>.pdf` | Downloads one PDF. In `live` mode it first runs the export if the PDF is missing or out of date |

Slugs: `all-statements`, `financial-position`, `income-statement`, `net-income`, `cash-flows`, `owners-equity`, `notes`, `trial-balance`, `tax`, `checks`, `journal`. Any other name gets a 404 and nothing is read from disk.

A PDF is out of date when it is missing, when a journal entry was added, edited or deleted after the last export, or (after a server restart) when it is older than the database file.

- `EXCEL_EXPORT_MODE=live` (default): runs Excel when needed. Needs Windows with desktop Excel.
- `EXCEL_EXPORT_MODE=static`: never runs Excel and serves whatever is already in `excel/exports/` (for hosting without Excel). Copy the PDFs there yourself.

### What you need for live exports

- **Windows with desktop Excel** (not Excel on the web, not Mac/Linux). The server cannot make PDFs on a host without Excel: use `static` mode there.
- **The API server running on port 5000.** The workbook's Power Query (JournalFeed) reads `http://127.0.0.1:5000/journal.csv`, and the export script refuses to run if the server is not reachable.
- **A default printer installed** (for example "Microsoft Print to PDF"). Excel needs one to change page setup.

### First-run steps (once)

1. Close Excel completely. From the `journal-project` folder run the one-time page setup. It backs up the workbook to `excel\backup\`, sets the print layout on the ten report sheets (print area, fit to one page wide, landscape or portrait, repeating header rows, header and footer) and saves through Excel:
   ```
   powershell -ExecutionPolicy Bypass -File excel\setup-print.ps1
   ```
2. Start the server and leave it running: `cd server`, then `npm start`.
3. Try the export by hand in a second window (takes 10 to 20 seconds, Excel stays hidden):
   ```
   powershell -ExecutionPolicy Bypass -File server\scripts\export-excel.ps1 -WorkbookPath "$PWD\excel\CIC_Financial_Model_v2.xlsx" -OutDir "$PWD\excel\exports"
   ```
   It writes 11 PDFs to `excel\exports\` and does not change your workbook (it opens it read-only and closes without saving).
4. Try the API: `Invoke-RestMethod -Method Post http://127.0.0.1:5000/api/reports/refresh` (add `-Headers @{ 'X-API-Key' = 'yourkey' }` if you set `CIC_API_KEY`), then open `http://127.0.0.1:5000/api/reports/trial-balance.pdf` in the browser.

After that, a PDF download refreshes itself whenever the journal changed since the last export. The Journal PDF always covers every entry, not the 2,000 empty template rows.

If an export fails, the message says why. The common ones: the API server is not running, the page setup was not done yet (run `setup-print.ps1`), or Excel loaded fewer journal lines than the server holds (the refresh did not finish: check that the query points at `127.0.0.1:5000`). If `setup-print.ps1` ever goes wrong, the original workbook is in `excel\backup\`.

If a PDF or a sheet shows `#######`, a column is too narrow for its numbers (amounts reach `(553,134,537.00)`). Run `powershell -ExecutionPolicy Bypass -File excel\fix-column-widths.ps1` once with Excel closed (it widens the Journal, Trial Balance, Tax and JournalFeed number columns and makes its own backup), then make the PDFs again.

The next steps for the project (front end, then the Excel restyle) are written as prompts in `docs/prompts/`.

## Money rule

Every amount in `core.js` and the database is a whole number of cents. Convert only at the edges (`toCents` in, `toMoney` out). The tax uses exact integer math and rounds half-up like Excel's ROUND.

## Parity check (do this before deleting the Python version)

1. Python: `python seed_sample_year.py --dry-run` and note the summary figures it prints.
2. Load the same sample year into the Node API, then compare `/api/summary` for every month (`?through=2026-07` ... `?through=2027-06`) with the Python app: all fields must be identical.
3. Compare `/api/tax/suggest?month=...` for every month.
4. Compare the row count and totals of `/journal.csv` from both apps.
5. Refresh the Excel workbook against the Node server and confirm all 10 checks on the Checks sheet pass.

### How to run steps 1 to 4

Use throwaway databases so your real data is not touched. Stop any other server on port 5000 first. Open three PowerShell windows.

Window 1, Node API on port 5000:

```
New-Item -ItemType Directory -Force "$env:TEMP\cic-parity"
cd C:\Users\HP\Desktop\journal-project\server
$env:CIC_DATABASE="$env:TEMP\cic-parity\node.db"; $env:PORT="5000"; npm start
```

Window 2, Python API on port 5001:

```
cd C:\Users\HP\Desktop\journal-project\legacy
$env:CIC_DATABASE="$env:TEMP\cic-parity\py.db"; $env:PORT="5001"; python app.py
```

Window 3, load the sample year into each app with its own seeder, then compare:

```
cd C:\Users\HP\Desktop\journal-project\server
node scripts/seed-sample-year.js
cd ..\legacy
python seed_sample_year.py --url http://127.0.0.1:5001
cd ..\server
node scripts/parity-check.js
```

The script prints OK or the exact differences for the summary, the tax suggestion (all 12 months) and `/journal.csv`. When finished, press Ctrl+C in windows 1 and 2 and delete the temporary databases: `Remove-Item "$env:TEMP\cic-parity" -Recurse`.

Result (7 Nov 2026): steps 1 to 4 passed. The summary and tax suggestion are identical for all 12 months, and all 619 journal lines match. The only difference is number formatting in the CSV (Python writes `120000000.0`, Node writes `120000000`), which Excel reads the same. Step 5 (Excel) is still to be confirmed.
