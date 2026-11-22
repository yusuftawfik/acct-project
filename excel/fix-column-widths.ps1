<#
.SYNOPSIS
  Widens the number columns that show ####### (run with Excel CLOSED).

.DESCRIPTION
  A column shows ####### when a number does not fit. The sample year has amounts such as 120,000,000.00 and
  negatives such as (120,000,000.00), which need about 16 characters. These columns were too narrow:
     Journal        E:F  (Debit, Credit)        14 -> 18
     Journal        N:P  (Net, Entry Net Cash, Cash Allocated; negatives in brackets)   14 -> 18
     Trial Balance  F:U  (monthly columns and totals)  13 -> 18
     Tax            C:N  (monthly columns)       14 -> 18
     JournalFeed    E:F  (Debit, Credit as loaded from the API)  -> 16
  18 is the width the statement sheets already use.

  Only column widths change. No formulas, sheet names, journal columns or data are touched.
  Like setup-print.ps1 it makes a timestamped backup in excel\backup\ first and saves through Excel itself
  (never through a library, which would delete the Power Query connection JournalFeed).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File excel\fix-column-widths.ps1
#>
param(
    [string]$WorkbookPath = (Join-Path $PSScriptRoot 'CIC_Financial_Model_v2.xlsx')
)

$ErrorActionPreference = 'Stop'
$script:ExitCode = 1

function Stop-Fix([int]$Code, [string]$Message) {
    $script:ExitCode = $Code
    throw $Message
}

function Release-Com($obj) {
    if ($null -ne $obj) {
        try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($obj) } catch { }
    }
}

$Widths = @(
    @{ Sheet = 'Journal';       Columns = 'E:F'; Width = 18 },
    @{ Sheet = 'Journal';       Columns = 'N:P'; Width = 18 },
    @{ Sheet = 'Trial Balance'; Columns = 'F:U'; Width = 18 },
    @{ Sheet = 'Tax';           Columns = 'C:N'; Width = 18 },
    @{ Sheet = 'JournalFeed';   Columns = 'E:F'; Width = 16 }
)

$excel = $null
$wb = $null
$backup = $null
$sheets = @{}
$report = @()
$ok = $false

try {
    if (-not (Test-Path -LiteralPath $WorkbookPath)) { Stop-Fix 2 "Workbook not found: $WorkbookPath" }
    $WorkbookPath = (Resolve-Path -LiteralPath $WorkbookPath).Path

    if (Get-Process -Name EXCEL -ErrorAction SilentlyContinue) {
        Stop-Fix 2 'Excel is open. Close every Excel window (also check Task Manager for EXCEL.EXE) and run this script again.'
    }
    $lockFile = Join-Path (Split-Path -Parent $WorkbookPath) ('~$' + (Split-Path -Leaf $WorkbookPath))
    if (Test-Path -LiteralPath $lockFile) {
        Stop-Fix 2 "The workbook looks open (lock file $lockFile exists). Close Excel; if it is closed, delete that file and run again."
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
    if ($wb.ReadOnly) { Stop-Fix 2 'Excel opened the workbook read-only, so it cannot be saved. Check that the file is not read-only or in use.' }
    $connectionsBefore = $wb.Connections.Count

    $present = @()
    foreach ($s in $wb.Worksheets) { $present += $s.Name }
    foreach ($w in $Widths) {
        if ($present -notcontains $w.Sheet) { Stop-Fix 2 "Sheet '$($w.Sheet)' was not found in the workbook." }
    }

    foreach ($w in $Widths) {
        if (-not $sheets.ContainsKey($w.Sheet)) { $sheets[$w.Sheet] = $wb.Worksheets.Item($w.Sheet) }
        $range = $sheets[$w.Sheet].Range($w.Columns)
        $before = $range.ColumnWidth          # empty when the columns currently differ
        $range.ColumnWidth = $w.Width         # widths only; never narrower than before
        $beforeText = $(if ($null -eq $before -or $before -is [System.DBNull]) { 'mixed' } else { [string][math]::Round([double]$before, 1) })
        if (($beforeText -ne 'mixed') -and ([double]$before -gt $w.Width)) { $range.ColumnWidth = [double]$before }
        $report += ('  {0,-14} columns {1,-4} {2,6} -> {3}' -f $w.Sheet, $w.Columns, $beforeText, [math]::Max([double]$w.Width, $(if ($beforeText -eq 'mixed') { 0 } else { [double]$before })))
        Release-Com $range
    }

    if ($wb.Connections.Count -ne $connectionsBefore) {
        Stop-Fix 1 'The Power Query connection count changed unexpectedly. Nothing was saved.'
    }

    $wb.Save()   # saved by Excel itself, so the Power Query connection (JournalFeed) is kept
    Write-Host ''
    Write-Host 'Column widths updated and saved:'
    $report | ForEach-Object { Write-Host $_ }
    Write-Host ''
    Write-Host "Done. Make the PDFs again and check them. If anything looks wrong, the original is in $backup"
    $ok = $true
}
catch {
    [Console]::Error.WriteLine("ERROR: $($_.Exception.Message)")
    if ($backup) { [Console]::Error.WriteLine("The original workbook is backed up at: $backup") }
}
finally {
    if ($null -ne $wb) { try { $wb.Close($false) } catch { } }
    if ($null -ne $excel) { try { $excel.Quit() } catch { } }
    foreach ($k in @($sheets.Keys)) { Release-Com $sheets[$k] }
    Release-Com $wb
    Release-Com $excel
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

if (-not $ok) { exit $script:ExitCode }
