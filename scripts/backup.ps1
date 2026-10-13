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
#>
param(
  [string]$Database = 'shms_dev',
  [string]$User = 'shms_user',
  [string]$OutDir = (Join-Path (Split-Path $PSScriptRoot -Parent) 'backups'),
  # Container id or name; defaults to the docker compose 'postgres' service.
  [string]$Container = ''
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
