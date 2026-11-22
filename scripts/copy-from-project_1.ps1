# copy-from-project_1.ps1
# COPIES (never moves or deletes) files from the old project into the new layout.
# Safe to re-run: files that already exist at the destination are skipped, never overwritten.
#
# Run from the journal-project folder:
#   powershell -ExecutionPolicy Bypass -File scripts\copy-from-project_1.ps1

$ErrorActionPreference = 'Stop'

$Dest   = Split-Path -Parent $PSScriptRoot
$Source = Join-Path (Split-Path -Parent $Dest) 'project_1'

if (-not (Test-Path $Source)) { throw "Source folder not found: $Source" }

$copied  = 0
$skipped = 0
$missing = 0

function Copy-One {
    param([string]$From, [string]$To)
    if (-not (Test-Path -LiteralPath $From)) {
        Write-Host "MISSING  $From" -ForegroundColor Red
        $script:missing++
        return
    }
    if (Test-Path -LiteralPath $To) {
        Write-Host "skip     $To (already exists)" -ForegroundColor Yellow
        $script:skipped++
        return
    }
    $dir = Split-Path -Parent $To
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    Copy-Item -LiteralPath $From -Destination $To
    Write-Host "copied   $To" -ForegroundColor Green
    $script:copied++
}

function Copy-Folder {
    param([string]$FromDir, [string]$ToDir)
    if (-not (Test-Path -LiteralPath $FromDir)) {
        Write-Host "MISSING  $FromDir" -ForegroundColor Red
        $script:missing++
        return
    }
    $root = (Resolve-Path -LiteralPath $FromDir).Path
    Get-ChildItem -LiteralPath $root -Recurse -File |
        Where-Object { $_.FullName -notmatch '\\(__pycache__|venv|\.venv|node_modules)\\' -and $_.Extension -ne '.pyc' } |
        ForEach-Object {
            $rel = $_.FullName.Substring($root.Length).TrimStart('\')
            Copy-One $_.FullName (Join-Path $ToDir $rel)
        }
}

# Excel model (plain file copy: the file is not opened or re-saved, so the Power Query connection is untouched)
Copy-One (Join-Path $Source 'CIC_Financial_Model_v2.xlsx') (Join-Path $Dest 'excel\CIC_Financial_Model_v2.xlsx')

# Power BI folder
Copy-Folder (Join-Path $Source 'powerbi') (Join-Path $Dest 'powerbi')

# Docs
Copy-One (Join-Path $Source 'university_financial_model_plan.md') (Join-Path $Dest 'docs\university_financial_model_plan.md')
Copy-One (Join-Path $Source 'PROJECT_STATUS.md')                  (Join-Path $Dest 'docs\PROJECT_STATUS.md')

# Legacy Python version (reference only). No venv, __pycache__ or cic.db.
foreach ($f in 'app.py','core.py','db.py','seed_sample_year.py','test_api.py','requirements.txt') {
    Copy-One (Join-Path $Source $f) (Join-Path $Dest "legacy\$f")
}
Copy-Folder (Join-Path $Source 'static') (Join-Path $Dest 'legacy\static')

Write-Host ''
Write-Host "Done. copied=$copied skipped=$skipped missing=$missing"
if ($missing -gt 0) { exit 1 }
