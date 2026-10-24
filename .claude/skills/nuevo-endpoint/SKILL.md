---
name: nuevo-endpoint
description: Flujo para agregar o cambiar un endpoint del backend de Los Lirios (router, schema, test, registro, docs). Usar cuando se pida una ruta nueva, un campo nuevo en la API o un recurso nuevo.
---

# Nuevo endpoint

Delegar la implementación a `backend-fastapi` si es más que un cambio mínimo.

1. Si hace falta tabla o columna: primero skill `nueva-migracion`.
2. Schema Pydantic v2 en `backend/app/schemas/<recurso>.py` (`Create`, `Update` con campos opcionales, `Response`). Plata y cantidades `Decimal`.
3. Router en `backend/app/api/<recurso>.py` con `router = APIRouter(prefix=..., tags=[...])`. Ver `precios_tarea.py` como modelo.
   - Rutas estáticas antes de las parametrizadas.
   - Permisos con `require_encargado_up` / `require_gerencial_up` de `app/api/deps.py`; elegir el rol mínimo correcto.
   - Escritura: `await db.flush()` + `await db.refresh(obj)`; nunca `commit` en el router.
   - PATCH: `model_dump(exclude_unset=True)`.
4. Registrar con `app.include_router(...)` en `backend/app/main.py`. `tests/test_router_registration.py` falla si falta.
5. Test en `backend/tests/test_<recurso>.py` (SQLite en memoria): caso feliz, permiso denegado y validación.
6. `./venv/Scripts/python.exe -m pytest -q` verde.
7. Si el front o mobile lo consumen: recordar `Number()` sobre los `Decimal` que llegan como string.
8. Regenerar docs (`generate_project_map.py`, `generate_modelo_datos.py`) o delegar a `docs-sync`.
