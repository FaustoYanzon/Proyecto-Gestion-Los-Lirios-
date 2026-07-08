# run_sql.ps1 — Run a SQL file against the app database using backend/.env credentials.
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\run_sql.ps1 -SqlFile .\reset_datos_prueba.sql

param(
    [Parameter(Mandatory = $true)][string]$SqlFile,
    [string]$EnvFile = ''
)

$ErrorActionPreference = 'Stop'

# $PSScriptRoot is not reliable inside param defaults on all invocation modes,
# so resolve the repo-relative .env path here instead.
if (-not $EnvFile) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $EnvFile = Join-Path $scriptDir '..\backend\.env'
}

if (-not (Test-Path $SqlFile)) { throw "SQL file not found: $SqlFile" }
if (-not (Test-Path $EnvFile)) { throw ".env not found at $EnvFile" }

# --- Parse DATABASE_URL (same logic as backup_postgres.ps1) ------------------
$urlLine = (Get-Content $EnvFile | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1)
if (-not $urlLine) { throw 'DATABASE_URL not found in .env' }
$url = ($urlLine -split '=', 2)[1].Trim().Trim('"').Trim("'")

if ($url -notmatch '^postgresql(\+\w+)?://(?<user>[^:]+):(?<pass>[^@]+)@(?<host>[^:/]+)(:(?<port>\d+))?/(?<db>[^?\s]+)') {
    throw 'DATABASE_URL has unexpected format'
}
$dbUser = [uri]::UnescapeDataString($Matches['user'])
$dbPass = [uri]::UnescapeDataString($Matches['pass'])
$dbHost = $Matches['host']
$dbPort = if ($Matches['port']) { $Matches['port'] } else { '5432' }
$dbName = $Matches['db']

# --- Locate psql --------------------------------------------------------------
$psql = (Get-Command psql -ErrorAction SilentlyContinue).Source
if (-not $psql) {
    $psql = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $psql) { throw 'psql.exe not found (install PostgreSQL client tools or add to PATH)' }

Write-Output "Running $SqlFile against db '$dbName' on ${dbHost}:${dbPort} as '$dbUser'..."

$env:PGPASSWORD = $dbPass
try {
    # ON_ERROR_STOP: abort on first error so the transaction rolls back cleanly
    & $psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -v ON_ERROR_STOP=1 -f $SqlFile
    if ($LASTEXITCODE -ne 0) { throw "psql exited with code $LASTEXITCODE" }
}
finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
Write-Output 'Done.'
