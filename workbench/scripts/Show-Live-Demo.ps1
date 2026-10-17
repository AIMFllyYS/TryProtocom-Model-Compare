param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'Bench Live Demo - PREPARATION ONLY'
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUNBUFFERED = '1'
$liveRepo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $liveRepo
Write-Host 'MODEL COMPARE / LIVE DISPLAY TEST' -ForegroundColor Cyan
Write-Host 'This is preparation. The formal overnight queue remains stopped.' -ForegroundColor Yellow
& python -u (Join-Path $PSScriptRoot 'live_console_demo.py') --out $OutputDirectory
Write-Host "Display task exit code: $LASTEXITCODE" -ForegroundColor Green
Write-Host 'The window remains open for livestream layout inspection.' -ForegroundColor Cyan
