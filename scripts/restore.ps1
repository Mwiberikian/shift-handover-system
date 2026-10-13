<#
.SYNOPSIS
  Restores an SHMS backup into a scratch database and prints the elapsed time (NFR-11).

.DESCRIPTION
  Copies the dump into the Postgres container, drops and recreates the scratch
  database, runs pg_restore and prints row counts of the main tables so the
  restore can be checked against the source. The live database is never
  touched: the target name must end in _scratch or _restore.

.EXAMPLE
  .\scripts\restore.ps1                          # newest file in .\backups
  .\scripts\restore.ps1 -BackupFile .\backups\shms_dev-20261013-201500.dump -TargetDatabase shms_restore
#>
param(
  [string]$BackupFile = '',
  [string]$TargetDatabase = 'shms_scratch',
  [string]$User = 'shms_user',
  # Container id or name; defaults to the docker compose 'postgres' service.
  [string]$Container = ''
)

$ErrorActionPreference = 'Stop'

function Invoke-Checked([string]$What, [scriptblock]$Command) {
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)" }
}

if ($TargetDatabase -notmatch '_(scratch|restore)$') {
  throw "Refusing to restore into '$TargetDatabase': the target name must end in _scratch or _restore."
}

$root = Split-Path $PSScriptRoot -Parent
if (-not $BackupFile) {
  $latest = Get-ChildItem (Join-Path $root 'backups') -Filter '*.dump' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $latest) { throw 'No backup given and none found in .\backups. Run scripts\backup.ps1 first.' }
  $BackupFile = $latest.FullName
}
$BackupFile = (Resolve-Path $BackupFile).Path

if (-not $Container) {
  $Container = (docker compose -f (Join-Path $root 'docker-compose.yml') ps -q postgres | Select-Object -First 1)
  if (-not $Container) { throw 'Postgres container is not running. Start it with: docker compose up -d' }
}

$inContainer = '/tmp/' + [System.IO.Path]::GetFileName($BackupFile)
Write-Output "Restoring $BackupFile into '$TargetDatabase'"

$timer = [System.Diagnostics.Stopwatch]::StartNew()
try {
  Invoke-Checked 'docker cp' { docker cp $BackupFile "${Container}:$inContainer" }
  Invoke-Checked 'dropdb' { docker exec $Container dropdb -U $User --if-exists --force $TargetDatabase }
  Invoke-Checked 'createdb' { docker exec $Container createdb -U $User $TargetDatabase }
  Invoke-Checked 'pg_restore' { docker exec $Container pg_restore -U $User -d $TargetDatabase --no-owner --exit-on-error $inContainer }
} finally {
  docker exec $Container rm -f $inContainer | Out-Null
}
$timer.Stop()

$counts = docker exec $Container psql -U $User -d $TargetDatabase -At -F ' ' -c @"
SELECT 'app_user', count(*) FROM app_user
UNION ALL SELECT 'handover_record', count(*) FROM handover_record
UNION ALL SELECT 'task', count(*) FROM task
UNION ALL SELECT 'audit_log', count(*) FROM audit_log
UNION ALL SELECT 'notification', count(*) FROM notification
UNION ALL SELECT 'message', count(*) FROM message
"@
if ($LASTEXITCODE -ne 0) { throw 'Row count check failed' }

Write-Output 'Row counts in the restored database:'
$counts | ForEach-Object { Write-Output "  $_" }
Write-Output ("Restore elapsed: {0:N2} s" -f $timer.Elapsed.TotalSeconds)
