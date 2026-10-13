<#
.SYNOPSIS
  Backs up the SHMS database (NFR-11) with pg_dump inside the Postgres container.

.DESCRIPTION
  Runs pg_dump (custom format, -Fc) through `docker exec`, copies the dump out
  of the container into -OutDir and prints its path, size and the elapsed time.
  The dump is written inside the container first and then copied with
  `docker cp`, because piping binary output through Windows PowerShell 5.1
  corrupts it.

.EXAMPLE
  .\scripts\backup.ps1
  .\scripts\backup.ps1 -Database shms_dev -OutDir D:\shms-backups
  .\scripts\backup.ps1 -Keep 14     # then delete all but the newest 14 dumps of this database

.NOTES
  scripts\schedule-backup.ps1 registers a daily Windows Task Scheduler job that
  runs this script with -Keep 14 (NFR-11, DR-09).
#>
param(
  [string]$Database = 'shms_dev',
  [string]$User = 'shms_user',
  [string]$OutDir = (Join-Path (Split-Path $PSScriptRoot -Parent) 'backups'),
  # Container id or name; defaults to the docker compose 'postgres' service.
  [string]$Container = '',
  # After a successful backup keep only the newest N dumps of this database
  # in -OutDir (0 = keep everything). Other files are never touched.
  [ValidateRange(0, 3650)][int]$Keep = 0
)

$ErrorActionPreference = 'Stop'

function Invoke-Checked([string]$What, [scriptblock]$Command) {
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)" }
}

if (-not $Container) {
  $compose = Join-Path (Split-Path $PSScriptRoot -Parent) 'docker-compose.yml'
  $Container = (docker compose -f $compose ps -q postgres | Select-Object -First 1)
  if (-not $Container) { throw 'Postgres container is not running. Start it with: docker compose up -d' }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$fileName = "$Database-$stamp.dump"
$inContainer = "/tmp/$fileName"
$target = Join-Path $OutDir $fileName

$timer = [System.Diagnostics.Stopwatch]::StartNew()
try {
  Invoke-Checked 'pg_dump' { docker exec $Container pg_dump -U $User -d $Database -Fc -f $inContainer }
  Invoke-Checked 'docker cp' { docker cp "${Container}:$inContainer" $target }
} finally {
  docker exec $Container rm -f $inContainer | Out-Null
}
$timer.Stop()

$size = (Get-Item $target).Length
Write-Output ("Backup written: {0}" -f $target)
Write-Output ("Size: {0:N1} KB" -f ($size / 1KB))
Write-Output ("Elapsed: {0:N2} s" -f $timer.Elapsed.TotalSeconds)

# Retention: only files named <Database>-yyyyMMdd-HHmmss.dump, newest first by
# the timestamp in the name. Runs only after this backup succeeded.
if ($Keep -gt 0) {
  $pattern = '^' + [regex]::Escape($Database) + '-\d{8}-\d{6}\.dump$'
  $old = Get-ChildItem -Path $OutDir -Filter "$Database-*.dump" -File |
    Where-Object { $_.Name -match $pattern } |
    Sort-Object Name -Descending |
    Select-Object -Skip $Keep
  foreach ($f in $old) {
    Remove-Item -LiteralPath $f.FullName
    Write-Output ("Removed old backup: {0}" -f $f.Name)
  }
  Write-Output ("Kept the newest {0} backup(s) of {1}." -f $Keep, $Database)
}
