-- reset_datos_prueba.sql — Wipe TEST transactional data before the Excel migration.
--
-- DELETES: cosechas, trabajos, riegos, fitosanitarios, ciclos de campaña,
--          ingresos, egresos, presupuestos, metas de producción.
-- KEEPS:   users, parcelas, trabajadores, push_tokens (master data),
--          alembic_version (migration history).
--
-- The KPI views (vw_*) are untouched — they read these tables and will simply
-- return empty until the migration loads real data.
--
-- HOW TO RUN (PowerShell, from anywhere):
--   1. Take a manual backup FIRST:
--        powershell -ExecutionPolicy Bypass -File C:\claude-projects\los-lirios\scripts\backup_postgres.ps1
--   2. Run this script (replace user/db if different):
--        psql -U postgres -d los_lirios -f C:\claude-projects\los-lirios\scripts\reset_datos_prueba.sql
--   3. It prints row counts BEFORE deleting and asks nothing — the whole thing
--      runs in a single transaction; if anything fails, nothing is deleted.

BEGIN;

-- Show what is about to be deleted (visible in psql output)
SELECT 'registros_cosecha'        AS tabla, COUNT(*) FROM registros_cosecha
UNION ALL SELECT 'registros_trabajo',        COUNT(*) FROM registros_trabajo
UNION ALL SELECT 'registros_riego',          COUNT(*) FROM registros_riego
UNION ALL SELECT 'registros_fitosanitarios', COUNT(*) FROM registros_fitosanitarios
UNION ALL SELECT 'ciclos_campana',           COUNT(*) FROM ciclos_campana
UNION ALL SELECT 'ingresos',                 COUNT(*) FROM ingresos
UNION ALL SELECT 'egresos',                  COUNT(*) FROM egresos
UNION ALL SELECT 'presupuestos',             COUNT(*) FROM presupuestos
UNION ALL SELECT 'metas_produccion',         COUNT(*) FROM metas_produccion;

TRUNCATE TABLE
    registros_cosecha,
    registros_trabajo,
    registros_riego,
    registros_fitosanitarios,
    ciclos_campana,
    ingresos,
    egresos,
    presupuestos,
    metas_produccion;

COMMIT;

-- Verify: every count should now be 0
SELECT 'registros_cosecha'        AS tabla, COUNT(*) FROM registros_cosecha
UNION ALL SELECT 'registros_trabajo',        COUNT(*) FROM registros_trabajo
UNION ALL SELECT 'ingresos',                 COUNT(*) FROM ingresos
UNION ALL SELECT 'egresos',                  COUNT(*) FROM egresos
UNION ALL SELECT 'presupuestos',             COUNT(*) FROM presupuestos
UNION ALL SELECT 'metas_produccion',         COUNT(*) FROM metas_produccion;
