# PostgreSQL Backup — Los Lirios

Daily `pg_dump` (custom format) of the **production database on Railway**, with offsite copy via OneDrive and 14-day retention.

## Components

| File | Purpose |
|---|---|
| `backup_postgres.ps1` | Performs the dump, offsite copy, retention cleanup, logging |
| `install_backup_task.ps1` | Registers the Windows Scheduled Task (daily 21:00 ART) |

## How it works

1. Reads `DATABASE_PUBLIC_URL` from `backend/.env` at runtime — no credentials stored in scripts or task definitions.
   - `DATABASE_PUBLIC_URL` is the Railway Postgres public URL (`nozomi.proxy.rlwy.net:52538`). The `DATABASE_URL` Railway injects into the backend service is an **internal** hostname and does not resolve from outside Railway.
2. Runs `pg_dump -Fc` → `C:\backups\los-lirios\los_lirios_prod_YYYYMMDD_HHmm.dump`.
3. Fails hard (exit 1, logged) if `pg_dump` errors or the dump is under 10 KB.
4. Copies the dump to `%OneDrive%\Backups\los-lirios` (OneDrive sync = offsite copy).
5. Deletes dumps older than 14 days in both locations.
6. Appends result to `C:\backups\los-lirios\backup.log`.

To back up the **local dev** database instead:

```powershell
.\backup_postgres.ps1 -UrlKey DATABASE_URL -Label local
```

## Setup (one time)

```powershell
# 0. Add the Railway public URL to backend/.env (copy the value from
#    Railway -> Postgres service -> Variables -> DATABASE_PUBLIC_URL):
#    DATABASE_PUBLIC_URL=postgresql://postgres:<pass>@nozomi.proxy.rlwy.net:52538/railway

cd C:\claude-projects\los-lirios\scripts
powershell -ExecutionPolicy Bypass -File .\install_backup_task.ps1

# Immediate test run:
Start-ScheduledTask -TaskName 'LosLirios-PG-Backup'
Get-Content C:\backups\los-lirios\backup.log -Tail 5
```

**pg_dump version:** must be >= the Railway server version, or pg_dump aborts
with "server version mismatch". Check with `pg_dump -V` vs
`psql "<DATABASE_PUBLIC_URL>" -c "SHOW server_version;"` and install newer
client tools if needed.

## Restore test (REQUIRED before considering backups verified)

A backup is not verified until a restore has succeeded at least once.
Restore into the LOCAL Postgres (never against Railway):

```powershell
# 1. Create a throwaway database
psql -U postgres -c "CREATE DATABASE los_lirios_restore_test;"

# 2. Restore the latest prod dump into it
pg_restore -U postgres -d los_lirios_restore_test --no-owner --no-privileges `
    (Get-ChildItem C:\backups\los-lirios\los_lirios_prod_*.dump | Sort-Object Name -Descending | Select-Object -First 1).FullName

# 3. Sanity-check row counts against known production totals
#    (post-migración 2026-07-14: 591 registros_cosecha, 144 egresos, 370 presupuestos)
psql -U postgres -d los_lirios_restore_test -c "SELECT count(*) FROM users; SELECT count(*) FROM parcelas; SELECT count(*) FROM registros_cosecha; SELECT count(*) FROM egresos; SELECT count(*) FROM presupuestos;"

# 4. Drop the test database
psql -U postgres -c "DROP DATABASE los_lirios_restore_test;"
```

## Monitoring

- Check `backup.log` weekly — every line should start with `OK`.
- Task Scheduler → `LosLirios-PG-Backup` → History shows non-zero exit codes on failure.

## Known limitations

- Runs only if the PC is on (`StartWhenAvailable` catches up after boot the same day).
- OneDrive must be signed in and syncing for the offsite copy to actually leave the machine.
- Retention is time-based (14 days); no monthly archival yet — add if needed post-v1.
- Backing up production from a home PC depends on that PC. If the pilot becomes
  permanent, move this to a Railway cron or GitHub Actions with a secret.
