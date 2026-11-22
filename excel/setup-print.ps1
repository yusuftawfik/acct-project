<#
.SYNOPSIS
  One-time page setup for the ten report sheets of CIC_Financial_Model_v2.xlsx (run with Excel CLOSED).

.DESCRIPTION
  1. Makes a timestamped backup of the workbook in excel\backup\.
  2. Opens the workbook with Excel itself (COM) and sets the page setup on these sheets:
       Financial Position, Income Statement, Net Income, Cash Flows, Owners Equity, Notes,
       Trial Balance, Tax, Checks, Journal
       - print area = the sheet's used range (Journal: only the rows that contain data)
       - fit to 1 page wide, as many pages tall as needed
       - landscape for Trial Balance, Journal and any sheet wider than 8 columns, otherwise portrait
       - header row(s) repeat on every page
       - header: "CIC Journal" left, sheet name centre, "Page X of Y" right; footer: the date on the right
  3. Saves the workbook through Excel (never through a library: that would delete the Power Query
     connection JournalFeed).

  Formulas, sheet names and the journal columns are not touched.
  The Journal print area is also recalculated by export-excel.ps1 every time it makes the PDFs, so it
  always covers all current entries. The area set here only matters if you print from Excel yourself.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File excel\setup-print.ps1
#>
param(
    [string]$WorkbookPath = (Join-Path $PSScriptRoot 'CIC_Financial_Model_v2.xlsx')
)

$ErrorActionPreference = 'Stop'
$script:ExitCode = 1

function Stop-Setup([int]$Code, [string]$Message) {
    $script:ExitCode = $Code
    throw $Message
}

# Sheet name, rows that repeat on every page ('' = none), and whether it is always landscape.
# Header rows come from the workbook: row 4 is the header on every sheet except Trial Balance and Tax (rows 4 and 5).
$SheetSettings = @(
    @{ Name = 'Financial Position'; Titles = '$4:$4'; AlwaysLandscape = $false },
    @{ Name = 'Income Statement';   Titles = '$4:$4'; AlwaysLandscape = $false },
    @{ Name = 'Net Income';         Titles = '$4:$4'; AlwaysLandscape = $false },
    @{ Name = 'Cash Flows';         Titles = '$4:$4'; AlwaysLandscape = $false },
    @{ Name = 'Owners Equity';      Titles = '$4:$4'; AlwaysLandscape = $false },
    @{ Name = 'Notes';              Titles = '';      AlwaysLandscape = $false },
    @{ Name = 'Trial Balance';      Titles = '$4:$5'; AlwaysLandscape = $true  },
    @{ Name = 'Tax';                Titles = '$4:$5'; AlwaysLandscape = $false },
    @{ Name = 'Checks';             Titles = '$4:$4'; AlwaysLandscape = $false },
    @{ Name = 'Journal';            Titles = '$4:$4'; AlwaysLandscape = $true  }
)

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

function Release-Com($obj) {
    if ($null -ne $obj) {
        try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($obj) } catch { }
    }
}

$excel = $null
$wb = $null
$plan = @()
$backup = $null
$ok = $false

try {
    if (-not (Test-Path -LiteralPath $WorkbookPath)) { Stop-Setup 2 "Workbook not found: $WorkbookPath" }
    $WorkbookPath = (Resolve-Path -LiteralPath $WorkbookPath).Path

    if (Get-Process -Name EXCEL -ErrorAction SilentlyContinue) {
        Stop-Setup 2 'Excel is open. Close every Excel window (also check Task Manager for EXCEL.EXE) and run this script again.'
    }
    $lockFile = Join-Path (Split-Path -Parent $WorkbookPath) ('~$' + (Split-Path -Leaf $WorkbookPath))
    if (Test-Path -LiteralPath $lockFile) {
        Stop-Setup 2 "The workbook looks open (lock file $lockFile exists). Close Excel; if it is closed, delete that file and run again."
    }

    # Backup first, before anything can change the file.
    $backupDir = Join-Path (Split-Path -Parent $WorkbookPath) 'backup'
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($WorkbookPath)
    $backup = Join-Path $backupDir ('{0}_{1}.xlsx' -f $baseName, $stamp)
    Copy-Item -LiteralPath $WorkbookPath -Destination $backup
    Write-Host "Backup saved: $backup"

    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.AskToUpdateLinks = $false

    $wb = $excel.Workbooks.Open($WorkbookPath, 0)
    if ($wb.ReadOnly) { Stop-Setup 2 'Excel opened the workbook read-only, so it cannot be saved. Check that the file is not read-only or in use.' }
    $connectionsBefore = $wb.Connections.Count

    $present = @()
    foreach ($s in $wb.Worksheets) { $present += $s.Name }
    foreach ($cfg in $SheetSettings) {
        if ($present -notcontains $cfg.Name) { Stop-Setup 2 "Sheet '$($cfg.Name)' was not found in the workbook." }
    }

    # Work out the settings for every sheet first.
    foreach ($cfg in $SheetSettings) {
        $ws = $wb.Worksheets.Item($cfg.Name)
        $used = $ws.UsedRange
        $columns = $used.Columns.Count
        if ($cfg.Name -eq 'Journal') {
            $lastRow = Get-JournalLastRow $ws
            $lastCol = $used.Column + $columns - 1
            $area = $ws.Range($ws.Cells.Item(1, 1), $ws.Cells.Item($lastRow, $lastCol)).Address()
        } else {
            $area = $used.Address()
        }
        $landscape = ($cfg.AlwaysLandscape -or $columns -gt 8)
        $plan += [pscustomobject]@{
            Sheet     = $ws
            Name      = $cfg.Name
            Area      = $area
            Columns   = $columns
            Landscape = $landscape
            Titles    = $cfg.Titles
        }
        Release-Com $used
    }

    # Setting many page properties is slow while Excel talks to the printer driver after every change.
    # PrintCommunication = $false batches the changes.
    $batched = $true
    try { $excel.PrintCommunication = $false } catch { $batched = $false }
    try {
        foreach ($p in $plan) {
            $ps = $p.Sheet.PageSetup
            $ps.PrintArea = $p.Area
            $ps.Orientation = $(if ($p.Landscape) { 2 } else { 1 })   # 2 = landscape, 1 = portrait
            $ps.Zoom = $false                                         # use the fit-to-pages settings below
            $ps.FitToPagesWide = 1
            $ps.FitToPagesTall = $false                               # as many pages tall as needed
            $ps.PrintTitleRows = $p.Titles
            $ps.PrintTitleColumns = ''
            $ps.LeftHeader = 'CIC Journal'
            $ps.CenterHeader = '&A'                                   # sheet name
            $ps.RightHeader = 'Page &P of &N'
            $ps.LeftFooter = ''
            $ps.CenterFooter = ''
            $ps.RightFooter = '&D'                                    # date
        }
    } finally {
        if ($batched) { $excel.PrintCommunication = $true }
    }

    # Read the settings back before saving.
    foreach ($p in $plan) {
        $ps = $p.Sheet.PageSetup
        $wantOrientation = $(if ($p.Landscape) { 2 } else { 1 })
        if (($ps.Zoom -ne $false) -or ($ps.FitToPagesWide -ne 1) -or ($ps.Orientation -ne $wantOrientation) -or [string]::IsNullOrEmpty($ps.PrintArea)) {
            Stop-Setup 1 "The page setup on sheet '$($p.Name)' did not take effect. Nothing was saved."
        }
    }

    if ($wb.Connections.Count -ne $connectionsBefore) {
        Stop-Setup 1 'The Power Query connection count changed unexpectedly. Nothing was saved.'
    }

    $wb.Save()   # saved by Excel itself, so the Power Query connection (JournalFeed) is kept
    Write-Host ''
    Write-Host 'Page setup applied and saved:'
    foreach ($p in $plan) {
        $orientation = $(if ($p.Landscape) { 'landscape' } else { 'portrait ' })
        $titles = $(if ($p.Titles) { $p.Titles } else { '-' })
        Write-Host ('  {0,-20} {1}  area {2,-16} repeat rows {3}' -f $p.Name, $orientation, $p.Area, $titles)
    }
    Write-Host ''
    Write-Host "Done. If anything looks wrong, the original is in $backup"
    $ok = $true
}
catch {
    $message = $_.Exception.Message
    [Console]::Error.WriteLine("ERROR: $message")
    if ($message -match 'PageSetup|Orientation|PrintArea|PrintCommunication') {
        [Console]::Error.WriteLine('Excel needs a default printer to change page setup. Open Windows Settings > Printers, make sure one is installed (for example "Microsoft Print to PDF"), set it as default, and run this script again.')
    }
    if ($backup) { [Console]::Error.WriteLine("The original workbook is backed up at: $backup") }
}
finally {
    if ($null -ne $wb) { try { $wb.Close($false) } catch { } }
    if ($null -ne $excel) { try { $excel.Quit() } catch { } }
    foreach ($p in $plan) { Release-Com $p.Sheet }
    Release-Com $wb
    Release-Com $excel
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

if (-not $ok) { exit $script:ExitCode }
