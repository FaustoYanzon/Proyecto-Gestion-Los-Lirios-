# backup_postgres.ps1 - Daily PostgreSQL backup for Los Lirios
# Default target: PRODUCTION database on Railway, via DATABASE_PUBLIC_URL read
# from backend/.env (secrets never hardcoded here). Pass -UrlKey DATABASE_URL
# -Label local to back up the local dev database instead.
# Dumps with pg_dump -Fc, copies to an offsite dir (OneDrive), applies retention.
# Exit code 0 = success; non-zero = failure (visible in Task Scheduler history).

param(
    [string]$EnvFile = "$PSScriptRoot\..\backend\.env",
    [string]$UrlKey = 'DATABASE_PUBLIC_URL',   # Railway public URL (prod)
    [string]$Label = 'prod',                   # used in the dump filename
    [string]$BackupDir = "C:\backups\los-lirios",
    [string]$OffsiteDir = "$env:OneDrive\Backups\los-lirios",
    [int]$RetentionDays = 14
)

$ErrorActionPreference = 'Stop'
$logFile = Join-Path $BackupDir 'backup.log'

function Write-Log([string]$msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Write-Output $line
    Add-Content -Path $logFile -Value $line
}

try {
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
    New-Item -ItemType Directory -Force -Path $OffsiteDir | Out-Null

    # --- Parse the connection URL from .env ----------------------------------
    if (-not (Test-Path $EnvFile)) { throw ".env not found at $EnvFile" }
    $urlLine = (Get-Content $EnvFile | Where-Object { $_ -match "^\s*$UrlKey\s*=" } | Select-Object -First 1)
    if (-not $urlLine) {
        throw "$UrlKey not found in .env. For production, copy DATABASE_PUBLIC_URL from Railway -> Postgres service -> Variables into backend/.env (DATABASE_URL there is an internal Railway hostname and does not resolve from outside)."
    }
    $url = ($urlLine -split '=', 2)[1].Trim().Trim('"').Trim("'")

    # postgresql[+driver]://user:pass@host:port/dbname
    if ($url -notmatch '^postgresql(\+\w+)?://(?<user>[^:]+):(?<pass>[^@]+)@(?<host>[^:/]+)(:(?<port>\d+))?/(?<db>[^?\s]+)') {
        throw "$UrlKey has unexpected format"
    }
    $dbUser = [uri]::UnescapeDataString($Matches['user'])
    $dbPass = [uri]::UnescapeDataString($Matches['pass'])
    $dbHost = $Matches['host']
    $dbPort = if ($Matches['port']) { $Matches['port'] } else { '5432' }
    $dbName = $Matches['db']

    # --- Locate pg_dump ------------------------------------------------------
    $pgDump = (Get-Command pg_dump -ErrorAction SilentlyContinue).Source
    if (-not $pgDump) {
        # Fall back to newest installed PostgreSQL version
        $pgDump = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\pg_dump.exe' -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $pgDump) { throw 'pg_dump.exe not found (install PostgreSQL client tools or add to PATH)' }

    # --- Dump ----------------------------------------------------------------
    $stamp = Get-Date -Format 'yyyyMMdd_HHmm'
    $dumpFile = Join-Path $BackupDir "los_lirios_${Label}_$stamp.dump"

    $env:PGPASSWORD = $dbPass
    # Prefer TLS when the server offers it (Railway does); fall back otherwise.
    $env:PGSSLMODE = 'prefer'
    try {
        & $pgDump -Fc -h $dbHost -p $dbPort -U $dbUser -d $dbName -f $dumpFile
        if ($LASTEXITCODE -ne 0) { throw "pg_dump exited with code $LASTEXITCODE (a 'server version mismatch' means the local pg_dump is older than the Railway server - install matching client tools)" }
    }
    finally {
        Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
        Remove-Item Env:\PGSSLMODE  -ErrorAction SilentlyContinue
    }

    # Sanity check: a real dump of this schema should never be tiny
    $size = (Get-Item $dumpFile).Length
    if ($size -lt 10KB) { throw "Dump suspiciously small ($size bytes) - treating as failure" }

    # --- Offsite copy (OneDrive syncs it off the machine) --------------------
    Copy-Item $dumpFile -Destination $OffsiteDir -Force

    # --- Retention (covers old los_lirios_* and new los_lirios_<label>_* names)
    foreach ($dir in @($BackupDir, $OffsiteDir)) {
        Get-ChildItem (Join-Path $dir 'los_lirios_*.dump') -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } |
            Remove-Item -Force
    }

    Write-Log "OK  [$Label] $dumpFile ($([math]::Round($size/1MB,2)) MB) copied to $OffsiteDir"
    exit 0
}
catch {
    Write-Log "FAIL [$Label] $($_.Exception.Message)"
    exit 1
}
