---
name: nueva-migracion
description: Flujo para un cambio de esquema de base de datos en Los Lirios (modelo → Alembic autogenerate → revisión → upgrade → regenerar docs). Usar al agregar/cambiar columnas, tablas o enums.
---

# Nueva migración de esquema

1. Editar el modelo en `backend/app/models/` (IDs `String(36)` UUID, `Decimal` para plata).
2. `cd backend && ./venv/Scripts/python.exe -m alembic revision --autogenerate -m "descripcion"`.
3. **Revisar** el archivo generado en `app/core/migrations/versions/`: que no dropee nada inesperado, enums y defaults correctos, `downgrade` coherente. Las migraciones ya aplicadas no se editan: el arreglo va en una nueva.
4. `alembic heads` → debe haber un solo head (o el par conocido de `PROJECT_MAP.md`). Si hay dos nuevos, mergear.
5. `alembic upgrade head` en la DB local y correr `pytest`.
6. Regenerar docs: `python scripts/generate_modelo_datos.py` y `python scripts/generate_project_map.py` (o delegar a `docs-sync`).
7. Producción: NO correr sin confirmación explícita del usuario; antes, dump de respaldo (`scripts/backup_postgres.ps1`). Deploy: ver skill `deploy-lirios`.
