# PostgreSQL Backup — Los Lirios

Daily `pg_dump` (custom format) of the production database, with offsite copy via OneDrive and 14-day retention.

## Components

| File | Purpose |
|---|---|
| `backup_postgres.ps1` | Performs the dump, offsite copy, retention cleanup, logging |
| `install_backup_task.ps1` | Registers the Windows Scheduled Task (daily 21:00 ART) |

## How it works

1. Reads `DATABASE_URL` from `backend/.env` at runtime — no credentials stored in scripts or task definitions.
2. Runs `pg_dump -Fc` → `C:\backups\los-lirios\los_lirios_YYYYMMDD_HHmm.dump`.
3. Fails hard (exit 1, logged) if `pg_dump` errors or the dump is under 10 KB.
4. Copies the dump to `%OneDrive%\Backups\los-lirios` (OneDrive sync = offsite copy).
5. Deletes dumps older than 14 days in both locations.
6. Appends result to `C:\backups\los-lirios\backup.log`.

## Setup (one time)

```powershell
cd C:\claude-projects\los-lirios\scripts
powershell -ExecutionPolicy Bypass -File .\install_backup_task.ps1
# Immediate test run:
Start-ScheduledTask -TaskName 'LosLirios-PG-Backup'
Get-Content C:\backups\los-lirios\backup.log -Tail 5
```

## Restore test (REQUIRED before considering backups verified)

A backup is not verified until a restore has succeeded at least once:

```powershell
# 1. Create a throwaway database
psql -U postgres -c "CREATE DATABASE los_lirios_restore_test;"

# 2. Restore the latest dump into it
pg_restore -U postgres -d los_lirios_restore_test --no-owner `
    (Get-ChildItem C:\backups\los-lirios\los_lirios_*.dump | Sort-Object Name -Descending | Select-Object -First 1).FullName

# 3. Sanity-check row counts
psql -U postgres -d los_lirios_restore_test -c "SELECT count(*) FROM users; SELECT count(*) FROM parcelas;"

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
