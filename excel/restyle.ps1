<#
.SYNOPSIS
  Restyles CIC_Financial_Model_v2.xlsx from blue to the website's red scheme and fixes the college name
  (run with Excel CLOSED).

.DESCRIPTION
  What it changes (colours and text only):
    1. Navy header fills (#1F3864)            -> burgundy   (website: table header rows)
    2. Light-blue subtotal bands (#D9E1F2)    -> warm tan   (website: Entry Log body colour)
    3. Navy title/section fonts (#1F3864)     -> burgundy
    4. Tab colours: README burgundy; statement sheets header red; Journal and Entry forest green
       (the website's form-button colour). Reference, calculation, Checks, Test Case tabs are left alone.
    5. The old college name ("Canada Innovation College" and similar spellings) -> "Canadian International College".
       It is typed in two cells only (README B1 and Assumptions C5); every statement title reads Assumptions C5.

  What it does NOT change: formulas, sheet names, named ranges, the Power Query connection, tables,
  data validation, cell positions, conditional-format rules (their pass/fail green and red stay),
  the blue input font and green link font (finance colour conventions), page setup, column widths.

  Like setup-print.ps1 it makes a timestamped backup in excel\backup\ first, checks the Power Query connection
  count did not change, and saves through Excel itself (never through a library, which would delete the
  connection JournalFeed). Safe to run twice.

  To tune colours, edit the PALETTE block below only.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File excel\restyle.ps1
#>
param(
    [string]$WorkbookPath = (Join-Path $PSScriptRoot 'CIC_Financial_Model_v2.xlsx')
)

$ErrorActionPreference = 'Stop'
$script:ExitCode = 1

# ---------------------------------------------------------------------------------------------
# PALETTE (hex RGB). Values come from client/src/tokens.css and design/NOTES.md.
# ---------------------------------------------------------------------------------------------
$Palette = @{
    Burgundy  = '#960002'   # header rows, titles                      (website --burgundy)
    HeaderRed = '#C31B1E'   # statement sheet tabs                     (website --header-red)
    Forest    = '#12331A'   # Journal and Entry tabs                   (website --forest)
    Band      = '#EBDCC5'   # subtotal / section bands (was light blue) (website Entry Log body, flattened on white)
}

# What to recolour. From = the old blue, To = a palette name.
$FillSwaps = @(
    @{ From = '#1F3864'; To = 'Burgundy' },   # navy header rows
    @{ From = '#D9E1F2'; To = 'Band'     }    # light-blue bands
)
$FontSwaps = @(
    @{ From = '#1F3864'; To = 'Burgundy' }    # navy titles and section labels
)
$TabColors = @(
    @{ Sheet = 'README';             To = 'Burgundy'  },
    @{ Sheet = 'Journal';            To = 'Forest'    },
    @{ Sheet = 'Entry';              To = 'Forest'    },
    @{ Sheet = 'Financial Position'; To = 'HeaderRed' },
    @{ Sheet = 'Income Statement';   To = 'HeaderRed' },
    @{ Sheet = 'Net Income';         To = 'HeaderRed' },
    @{ Sheet = 'Cash Flows';         To = 'HeaderRed' },
    @{ Sheet = 'Owners Equity';      To = 'HeaderRed' },
    @{ Sheet = 'Notes';              To = 'HeaderRed' },
    @{ Sheet = 'JournalFeed';        To = 'HeaderRed' }
)

# Old spellings of the college name, replaced everywhere in the workbook (not case sensitive).
$NewName = 'Canadian International College'
$OldNames = @(
    'Canada Innovation College',
    'Canadian Innovation College',
    'Canada Innovative College',
    'Canadian Innovative College',
    'Candian Innovative College',
    'Candian Innovation College'
)
# ---------------------------------------------------------------------------------------------

function Stop-Restyle([int]$Code, [string]$Message) {
    $script:ExitCode = $Code
    throw $Message
}

function Release-Com($obj) {
    if ($null -ne $obj) {
        try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($obj) } catch { }
    }
}

# Excel COM colours are BGR numbers, not RGB.
function Rgb([string]$hex) {
    $r = [Convert]::ToInt32($hex.Substring(1, 2), 16)
    $g = [Convert]::ToInt32($hex.Substring(3, 2), 16)
    $b = [Convert]::ToInt32($hex.Substring(5, 2), 16)
    return ($r + ($g * 256) + ($b * 65536))
}

$missing = [System.Reflection.Missing]::Value

# Sets the "find format" (and optionally the "replace format") on the Excel application.
function Set-FormatSearch($excel, [string]$kind, [int]$from, $to) {
    $excel.FindFormat.Clear()
    $excel.ReplaceFormat.Clear()
    if ($kind -eq 'fill') {
        $excel.FindFormat.Interior.Color = $from
        if ($null -ne $to) { $excel.ReplaceFormat.Interior.Color = [int]$to }
    } else {
        $excel.FindFormat.Font.Color = $from
        if ($null -ne $to) { $excel.ReplaceFormat.Font.Color = [int]$to }
    }
}

# Recolours every cell of a sheet that has the old colour (a format-only Find and Replace; values are untouched).
function Swap-Colour($excel, $ws, [string]$kind, [int]$from, [int]$to) {
    Set-FormatSearch $excel $kind $from $to
    # What, Replacement, LookAt=xlPart, SearchOrder=xlByRows, MatchCase, MatchByte, SearchFormat, ReplaceFormat
    [void]$ws.Cells.Replace('', '', 2, 1, $false, $missing, $true, $true)
}

# True when at least one cell still has the old colour.
function Has-Colour($excel, $ws, [string]$kind, [int]$from) {
    Set-FormatSearch $excel $kind $from $null
    # What, After, LookIn=xlFormulas, LookAt=xlPart, SearchOrder=xlByRows, SearchDirection=xlNext, MatchCase, MatchByte, SearchFormat
    $hit = $ws.Cells.Find('', $missing, -4123, 2, 1, 1, $false, $missing, $true)
    $found = ($null -ne $hit)
    Release-Com $hit
    return $found
}

$excel = $null
$wb = $null
$backup = $null
$sheets = @()
$report = @()
$ok = $false

try {
    if (-not (Test-Path -LiteralPath $WorkbookPath)) { Stop-Restyle 2 "Workbook not found: $WorkbookPath" }
    $WorkbookPath = (Resolve-Path -LiteralPath $WorkbookPath).Path

    if (Get-Process -Name EXCEL -ErrorAction SilentlyContinue) {
        Stop-Restyle 2 'Excel is open. Close every Excel window (also check Task Manager for EXCEL.EXE) and run this script again.'
    }
    $lockFile = Join-Path (Split-Path -Parent $WorkbookPath) ('~$' + (Split-Path -Leaf $WorkbookPath))
    if (Test-Path -LiteralPath $lockFile) {
        Stop-Restyle 2 "The workbook looks open (lock file $lockFile exists). Close Excel; if it is closed, delete that file and run again."
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
    if ($wb.ReadOnly) { Stop-Restyle 2 'Excel opened the workbook read-only, so it cannot be saved. Check that the file is not read-only or in use.' }
    $connectionsBefore = $wb.Connections.Count
    $sheetCountBefore = $wb.Worksheets.Count

    $present = @()
    foreach ($s in $wb.Worksheets) { $present += $s.Name }
    foreach ($t in $TabColors) {
        if ($present -notcontains $t.Sheet) { Stop-Restyle 2 "Sheet '$($t.Sheet)' was not found in the workbook." }
    }

    # 1. Fills and fonts, sheet by sheet.
    foreach ($name in $present) {
        $ws = $wb.Worksheets.Item($name)
        $sheets += $ws
        foreach ($f in $FillSwaps) {
            Swap-Colour $excel $ws 'fill' (Rgb $f.From) (Rgb $Palette[$f.To])
        }
        foreach ($f in $FontSwaps) {
            Swap-Colour $excel $ws 'font' (Rgb $f.From) (Rgb $Palette[$f.To])
        }
    }

    # 2. Tab colours.
    foreach ($t in $TabColors) {
        $ws = $wb.Worksheets.Item($t.Sheet)
        $ws.Tab.Color = (Rgb $Palette[$t.To])
        $report += ('  tab   {0,-20} -> {1} {2}' -f $t.Sheet, $t.To, $Palette[$t.To])
    }

    # 2b. Entity name at the top of each statement (A1, formula =Assumptions!$C$5): green link font -> burgundy.
    #      Only that one cell per sheet; the green used for other cross-sheet numbers is left alone.
    $titleSheets = @()
    foreach ($name in $present) {
        $ws = $wb.Worksheets.Item($name)
        if ($ws.Range('A1').Formula -eq '=Assumptions!$C$5') {
            $ws.Range('A1').Font.Color = (Rgb $Palette['Burgundy'])
            $titleSheets += $name
        }
    }
    $report += ('  title A1 on: {0} -> Burgundy' -f ($titleSheets -join ', '))

    # 3. College name (text only; formulas that read Assumptions!C5 follow automatically).
    $excel.FindFormat.Clear()
    $excel.ReplaceFormat.Clear()
    foreach ($name in $present) {
        $ws = $wb.Worksheets.Item($name)
        foreach ($old in $OldNames) {
            # LookAt xlPart, not case sensitive
            [void]$ws.UsedRange.Replace($old, $NewName, 2, 1, $false, $missing, $false, $false)
        }
    }
    $excel.Calculate()

    # 4. Verify before saving. Anything left over means nothing is saved.
    $problems = @()
    foreach ($ws in $sheets) {
        foreach ($f in $FillSwaps) {
            if (Has-Colour $excel $ws 'fill' (Rgb $f.From)) { $problems += "Sheet '$($ws.Name)' still has the old fill $($f.From)." }
        }
        foreach ($f in $FontSwaps) {
            if (Has-Colour $excel $ws 'font' (Rgb $f.From)) { $problems += "Sheet '$($ws.Name)' still has the old font colour $($f.From)." }
        }
        foreach ($old in $OldNames) {
            # SearchFormat must be $false here, because Excel remembers the format search from the colour checks above
            $hit = $ws.UsedRange.Find($old, $missing, -4123, 2, 1, 1, $false, $missing, $false)
            if ($null -ne $hit) { $problems += "Sheet '$($ws.Name)' still contains '$old' at $($hit.Address($false, $false))." }
            Release-Com $hit
        }
    }
    $excel.FindFormat.Clear()
    $excel.ReplaceFormat.Clear()
    if ($problems.Count -gt 0) {
        Stop-Restyle 1 ("Verification failed, nothing was saved:`n  " + ($problems -join "`n  "))
    }
    if ($wb.Connections.Count -ne $connectionsBefore) {
        Stop-Restyle 1 'The Power Query connection count changed unexpectedly. Nothing was saved.'
    }
    if ($wb.Worksheets.Count -ne $sheetCountBefore) {
        Stop-Restyle 1 'The number of sheets changed unexpectedly. Nothing was saved.'
    }

    $wb.Save()   # saved by Excel itself, so the Power Query connection (JournalFeed) is kept
    Write-Host ''
    Write-Host 'Restyle applied and saved:'
    Write-Host ('  fills  {0}' -f (($FillSwaps | ForEach-Object { "$($_.From) -> $($Palette[$_.To])" }) -join ', '))
    Write-Host ('  fonts  {0}' -f (($FontSwaps | ForEach-Object { "$($_.From) -> $($Palette[$_.To])" }) -join ', '))
    $report | ForEach-Object { Write-Host $_ }
    Write-Host ("  name   old spellings -> '$NewName' (README B1, Assumptions C5)")
    Write-Host ("  Power Query connections: $connectionsBefore (unchanged)")
    Write-Host ''
    Write-Host "Done. If anything looks wrong, the original is in $backup"
    $ok = $true
}
catch {
    [Console]::Error.WriteLine("ERROR: $($_.Exception.Message)")
    if ($backup) { [Console]::Error.WriteLine("The original workbook is backed up at: $backup") }
}
finally {
    if ($null -ne $wb) { try { $wb.Close($false) } catch { } }
    if ($null -ne $excel) { try { $excel.Quit() } catch { } }
    foreach ($s in $sheets) { Release-Com $s }
    Release-Com $wb
    Release-Com $excel
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

if (-not $ok) { exit $script:ExitCode }
