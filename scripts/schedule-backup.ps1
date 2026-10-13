<#
.SYNOPSIS
  Registers a daily Windows Task Scheduler job that backs up the SHMS
  database and keeps the newest 14 dumps (NFR-11, DR-09).

.DESCRIPTION
  The task runs scripts\backup.ps1 -Keep <Keep> once a day at -At, as the
  current user, only while that user is signed in (Docker Desktop runs in the
  user's session, so the container is not reachable otherwise). A run missed
  because the machine was off or asleep starts as soon as it can. Each run
  appends its output to <OutDir>\backup-task.log.

  This only takes backups. It never restores anything, and restore.ps1
  refuses any target that does not end in _scratch or _restore, so shms_dev
  is never restored into.

  Re-running the script replaces the task with the new settings.

.EXAMPLE
  .\scripts\schedule-backup.ps1                       # daily at 02:00, keep 14
  .\scripts\schedule-backup.ps1 -At 23:30 -Keep 30
  .\scripts\schedule-backup.ps1 -RunNow               # register, then run once to check
  .\scripts\schedule-backup.ps1 -Unregister           # remove the task
  Get-ScheduledTaskInfo -TaskName 'SHMS daily backup' # last run time and result
#>
param(
  [string]$TaskName = 'SHMS daily backup',
  # Time of day (local) for the daily run.
  [string]$At = '02:00',
  [ValidateRange(1, 3650)][int]$Keep = 14,
  [string]$Database = 'shms_dev',
  [string]$OutDir = (Join-Path (Split-Path $PSScriptRoot -Parent) 'backups'),
  [switch]$RunNow,
  [switch]$Unregister
)

$ErrorActionPreference = 'Stop'

if ($Database -match '_(scratch|restore)$') {
  throw "'$Database' looks like a restore target; schedule backups of the live database instead."
}

if ($Unregister) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "Removed scheduled task '$TaskName'."
  } else {
    Write-Output "No scheduled task named '$TaskName'."
  }
  return
}

$backupScript = Join-Path $PSScriptRoot 'backup.ps1'
if (-not (Test-Path $backupScript)) { throw "Not found: $backupScript" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$log = Join-Path $OutDir 'backup-task.log'

# Single quotes inside the -Command string are doubled for PowerShell.
$q = { param($s) "'" + ($s -replace "'", "''") + "'" }
$command = "& $(& $q $backupScript) -Database $(& $q $Database) -OutDir $(& $q $OutDir) -Keep $Keep *>> $(& $q $log)"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command `"$command`"" `
  -WorkingDirectory (Split-Path $PSScriptRoot -Parent)

$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($At, 'HH:mm', $null))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description "SHMS: pg_dump of $Database daily at $At, keeping the newest $Keep dumps in $OutDir (scripts\schedule-backup.ps1)." `
  -Force | Out-Null

$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Output "Registered '$TaskName': daily at $At, keeps the newest $Keep dumps of $Database in $OutDir."
Write-Output ("Next run: {0}" -f $info.NextRunTime)
Write-Output "Log: $log"

if ($RunNow) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Output "Started one run now. Check the log, or run: Get-ScheduledTaskInfo -TaskName '$TaskName'"
}
