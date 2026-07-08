# install_backup_task.ps1 — Registers the daily backup as a Windows Scheduled Task.
# Run once from an elevated or normal PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\install_backup_task.ps1

param(
    [string]$Time = '21:00'  # daily run time (after work hours)
)

$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'backup_postgres.ps1'
if (-not (Test-Path $scriptPath)) { throw "backup_postgres.ps1 not found next to this installer" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger -Daily -At $Time

# StartWhenAvailable: if the PC was off at $Time, run as soon as it's back on
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName 'LosLirios-PG-Backup' `
    -Action $action -Trigger $trigger -Settings $settings -Force

Write-Output "Task 'LosLirios-PG-Backup' registered - runs daily at $Time."
Write-Output "Test it now with: Start-ScheduledTask -TaskName 'LosLirios-PG-Backup'"
