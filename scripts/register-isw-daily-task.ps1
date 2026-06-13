# Register a Windows Scheduled Task for daily ISW ingestion (local machine).
# Run from an elevated PowerShell if Register-ScheduledTask fails with access denied.
#
# Usage:
#   .\scripts\register-isw-daily-task.ps1
#   .\scripts\register-isw-daily-task.ps1 -Time "21:00" -Unregister

param(
  [string]$Time = "21:00",
  [switch]$Unregister
)

$ErrorActionPreference = "Stop"
$TaskName = "UkraineInvestigator-ISW-Daily"
$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Node = (Get-Command node -ErrorAction Stop).Source
$Script = Join-Path $RepoRoot "isw-daily-extract.js"
$LogDir = Join-Path $RepoRoot "logs"
$LogFile = Join-Path $LogDir "isw-daily-extract.log"

if (-not (Test-Path $Script)) {
  throw "Missing script: $Script"
}

if ($Unregister) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed scheduled task: $TaskName"
  exit 0
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$Wrapper = Join-Path $LogDir "run-isw-daily-extract.cmd"
@"
@echo off
cd /d "$RepoRoot"
set ONLY_MISSING=1
echo === ISW daily extract %DATE% %TIME% ===>> "$LogFile"
"$Node" "$Script" >> "$LogFile" 2>&1
"@ | Set-Content -Path $Wrapper -Encoding ASCII

$Action = New-ScheduledTaskAction -Execute $Wrapper -WorkingDirectory $RepoRoot
$Trigger = New-ScheduledTaskTrigger -Daily -At $Time
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -AllowStartIfOnBatteries

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Description "Daily ISW ArcGIS territory snapshot for ukraine-investigator (private archive)." `
  -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName"
Write-Host "  Runs daily at: $Time (local time)"
Write-Host "  Script: $Script"
Write-Host "  Log:    $LogFile"
Write-Host ""
Write-Host "Test now: Start-ScheduledTask -TaskName '$TaskName'"
