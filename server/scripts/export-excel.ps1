<#
.SYNOPSIS
  Makes the PDF reports with Excel itself. Started by the API (POST /api/reports/refresh or a PDF download),
  but it can also be run by hand.

.DESCRIPTION
  1. Checks the API server is running and reads how many journal lines it holds.
  2. Opens the workbook HIDDEN and READ-ONLY with Excel (COM). The workbook is never saved, so nothing in
     your Excel file changes, and the refreshed data only lives in memory.
  3. RefreshAll, waits until the Power Query refresh has finished, and checks that Excel loaded exactly
     the journal lines the server holds (otherwise the PDFs would show old numbers, so it fails instead).
  4. Recalculates, then exports each report with ExportAsFixedFormat (PDF):
       all-statements   = Financial Position, Income Statement, Net Income, Cash Flows, Owners Equity, Notes
                          (one PDF, in that order)
       financial-position, income-statement, net-income, cash-flows, owners-equity, notes,
       trial-balance, tax, checks, journal = that sheet alone
  5. Writes the PDFs to a staging folder first and moves them into -OutDir only when all of them worked,
     so a failed run never leaves a half-finished set.
  6. Closes the workbook WITHOUT saving, quits Excel and releases every COM object.

  Exit codes: 0 done | 1 failed (message on stderr) | 2 bad setup (workbook or sheet missing)
              3 page setup not done yet (run excel\setup-print.ps1) | 4 API server not reachable or the
              Power Query refresh did not load the latest journal.

  The script prints "EXCEL_PID=<number>" right after it starts Excel. If the API has to stop a stuck export
  (120 s limit) it uses that number to end this hidden Excel too.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File server\scripts\export-excel.ps1 `
    -WorkbookPath C:\Users\HP\Desktop\journal-project\excel\CIC_Financial_Model_v2.xlsx `
    -OutDir C:\Users\HP\Desktop\journal-project\excel\exports
#>
param(
    [Parameter(Mandatory = $true)][string]$WorkbookPath,
    [Parameter(Mandatory = $true)][string]$OutDir,
    # The feed the workbook's Power Query reads (the API must be running on this address).
    [string]$FeedUrl = 'http://127.0.0.1:5000/journal.csv',
    [int]$RefreshTimeoutSec = 90
)

$ErrorActionPreference = 'Stop'
$script:ExitCode = 1

# Cumulative seconds at each stage, printed as one TIMING line (the API logs it) to show where the time goes.
$script:Clock = [System.Diagnostics.Stopwatch]::StartNew()
$script:Marks = @()
function Mark([string]$Name) { $script:Marks += ('{0}={1:N1}s' -f $Name, $script:Clock.Elapsed.TotalSeconds) }

function Stop-Export([int]$Code, [string]$Message) {
    $script:ExitCode = $Code
    throw $Message
}

function Release-Com($obj) {
    if ($null -ne $obj) {
        try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($obj) } catch { }
    }
}

# slug -> sheets (exact sheet names). all-statements is exported as ONE pdf with the six sheets selected together.
$AllStatements = @('Financial Position', 'Income Statement', 'Net Income', 'Cash Flows', 'Owners Equity', 'Notes')
$Reports = [ordered]@{
    'all-statements'     = $AllStatements
    'financial-position' = @('Financial Position')
    'income-statement'   = @('Income Statement')
    'net-income'         = @('Net Income')
    'cash-flows'         = @('Cash Flows')
    'owners-equity'      = @('Owners Equity')
    'notes'              = @('Notes')
    'trial-balance'      = @('Trial Balance')
    'tax'                = @('Tax')
    'checks'             = @('Checks')
    'journal'            = @('Journal')
}
$NeededSheets = @('Financial Position', 'Income Statement', 'Net Income', 'Cash Flows', 'Owners Equity', 'Notes',
                  'Trial Balance', 'Tax', 'Checks', 'Journal', 'JournalFeed')

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class CicWin32 {
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

# Last row of the Journal sheet that holds an entry (data rows are 5 to 2004; empty template rows show "").
function Get-JournalLastRow($ws) {
    $values = $ws.Range('A5:A2004').Value2
    $last = 0
    for ($i = 2000; $i -ge 1; $i--) {
        $v = $values[$i, 1]
        if ($null -ne $v -and "$v" -ne '') { $last = $i; break }
    }
    if ($last -lt 1) { $last = 1 }
    return (4 + $last)
}

$excel = $null
$wb = $null
$excelPid = 0
$stage = $null
$sheets = @{}
$ok = $false

try {
    if (-not (Test-Path -LiteralPath $WorkbookPath)) { Stop-Export 2 "Workbook not found: $WorkbookPath" }
    $WorkbookPath = (Resolve-Path -LiteralPath $WorkbookPath).Path
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $OutDir = (Resolve-Path -LiteralPath $OutDir).Path

    # 1. The API server must be running: Excel's Power Query reads the journal from it.
    try {
        $response = Invoke-WebRequest -Uri $FeedUrl -UseBasicParsing -TimeoutSec 15
    } catch {
        Stop-Export 4 "The API server is not reachable at $FeedUrl. Start it (npm start in the server folder) and try again."
    }
    $serverLines = @(ConvertFrom-Csv -InputObject ([string]$response.Content)).Count
    if ($serverLines -gt 2000) { Stop-Export 4 "The journal has $serverLines lines but the Excel Journal sheet holds 2,000." }

    # 2. Start Excel hidden. Report its process id so a timeout can end it.
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.AskToUpdateLinks = $false
    $excel.ScreenUpdating = $false
    [uint32]$procId = 0
    [void][CicWin32]::GetWindowThreadProcessId([IntPtr][int]$excel.Hwnd, [ref]$procId)
    $excelPid = [int]$procId
    [Console]::Out.WriteLine("EXCEL_PID=$excelPid")
    [Console]::Out.Flush()

    # Read-only: this script can never change or save your workbook.
    $wb = $excel.Workbooks.Open($WorkbookPath, 0, $true)
    $wb.Activate()
    Mark 'open'

    $present = @()
    foreach ($s in $wb.Worksheets) { $present += $s.Name }
    foreach ($name in $NeededSheets) {
        if ($present -notcontains $name) { Stop-Export 2 "Sheet '$name' was not found in the workbook." }
    }
    foreach ($name in $NeededSheets) { $sheets[$name] = $wb.Worksheets.Item($name) }

    # 3. The page setup (fit to 1 page wide, landscape, headers) must have been done once.
    foreach ($name in ($NeededSheets | Where-Object { $_ -ne 'JournalFeed' })) {
        try {
            $ps = $sheets[$name].PageSetup
            $fitted = (($ps.Zoom -eq $false) -and ($ps.FitToPagesWide -eq 1))
        } catch {
            Stop-Export 3 "Cannot read the page setup of '$name' (Excel may need a default printer). Run excel\setup-print.ps1 once, then try again."
        }
        if (-not $fitted) { Stop-Export 3 "Page setup is not done yet (sheet '$name'). Close Excel and run excel\setup-print.ps1 once, then try again." }
    }

    # 4. Refresh the Power Query feed and WAIT for it. Background refresh is turned off so RefreshAll
    #    returns only when the data has arrived.
    $excel.Calculation = -4105   # automatic, in memory only
    foreach ($c in $wb.Connections) {
        try { $c.OLEDBConnection.BackgroundQuery = $false } catch { }
    }
    $wb.RefreshAll()
    $excel.CalculateUntilAsyncQueriesDone()
    $deadline = (Get-Date).AddSeconds($RefreshTimeoutSec)
    while ($true) {
        $busy = $false
        foreach ($c in $wb.Connections) {
            try { if ($c.OLEDBConnection.Refreshing) { $busy = $true } } catch { }
        }
        if ((-not $busy) -and ($excel.CalculationState -eq 0)) { break }   # 0 = xlDone
        if ((Get-Date) -gt $deadline) { Stop-Export 1 "The Power Query refresh did not finish within $RefreshTimeoutSec seconds." }
        Start-Sleep -Milliseconds 500
    }

    # Refresh failures can be silent, so check Excel really holds the server's journal.
    $excelLines = [int]$excel.WorksheetFunction.CountA($sheets['JournalFeed'].Range('A2:A2001'))
    if ($excelLines -ne $serverLines) {
        Stop-Export 4 "Excel loaded $excelLines journal lines but the server holds $serverLines. The Power Query refresh did not bring in the latest journal (is the query pointed at $FeedUrl?)."
    }
    Mark 'refresh'
    $excel.CalculateFull()
    $excel.CalculateUntilAsyncQueriesDone()
    Mark 'calc'

    # The Journal sheet has 2,000 template rows. Print only the rows that contain entries (in memory only).
    $journal = $sheets['Journal']
    $lastRow = Get-JournalLastRow $journal
    $lastCol = $journal.UsedRange.Column + $journal.UsedRange.Columns.Count - 1
    $journal.PageSetup.PrintArea = $journal.Range($journal.Cells.Item(1, 1), $journal.Cells.Item($lastRow, $lastCol)).Address()

    # 5. Export every report into a staging folder.
    $stage = Join-Path $OutDir ('_staging_' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    foreach ($slug in $Reports.Keys) {
        $names = $Reports[$slug]
        $target = Join-Path $stage "$slug.pdf"
        # Select the sheet(s): the first replaces the selection, the others are added to it.
        $sheets[$names[0]].Select($true)
        for ($i = 1; $i -lt $names.Count; $i++) { $sheets[$names[$i]].Select($false) }
        # With several sheets selected, exporting the active sheet exports all of them into one PDF.
        $excel.ActiveSheet.ExportAsFixedFormat(0, $target)   # 0 = xlTypePDF
        if (-not (Test-Path -LiteralPath $target) -or ((Get-Item -LiteralPath $target).Length -eq 0)) {
            Stop-Export 1 "Excel did not produce $slug.pdf."
        }
    }

    # 6. All 11 worked: move them into place.
    Mark 'pdfs'
    foreach ($slug in $Reports.Keys) {
        Move-Item -LiteralPath (Join-Path $stage "$slug.pdf") -Destination (Join-Path $OutDir "$slug.pdf") -Force
    }
    Write-Host "Exported $($Reports.Count) PDFs to $OutDir ($serverLines journal lines)."
    Write-Host ("TIMING " + ($script:Marks -join ' '))
    $ok = $true
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
}
finally {
    # Close WITHOUT saving, quit Excel, release every COM object.
    if ($null -ne $wb) { try { $wb.Close($false) } catch { } }
    if ($null -ne $excel) { try { $excel.Quit() } catch { } }
    foreach ($k in @($sheets.Keys)) { Release-Com $sheets[$k] }
    Release-Com $wb
    Release-Com $excel
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    # If our own hidden Excel is somehow still running, end it (never any other Excel).
    if ($excelPid -gt 0) {
        $deadline = (Get-Date).AddSeconds(5)
        while ((Get-Date) -lt $deadline -and (Get-Process -Id $excelPid -ErrorAction SilentlyContinue)) { Start-Sleep -Milliseconds 250 }
        $left = Get-Process -Id $excelPid -ErrorAction SilentlyContinue
        if ($left -and $left.ProcessName -eq 'EXCEL') { Stop-Process -Id $excelPid -Force -ErrorAction SilentlyContinue }
    }
    if ($stage -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}

if (-not $ok) { exit $script:ExitCode }
