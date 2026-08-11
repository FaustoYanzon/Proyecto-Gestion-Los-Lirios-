---
tags: [sistema, sesion]
---

# 2026-08-11 — Logging/Sentry, tests de idempotencia, test de routers, build offline

Sesión de cierre de los pendientes 2-4 del roadmap del 2026-08-10 (logging/Sentry, extender tests de idempotencia, test de registro de routers), más un hallazgo urgente sobre el pendiente 1 (cola offline) que se resolvió en la misma sesión porque el usuario iba a probarla al día siguiente en la finca.

## Hallazgo urgente: cola offline no estaba lista para la prueba de campo

Antes de tocar backend, se investigó si la cola offline (implementada el 2026-08-10) ya estaba lista para probarse. No lo estaba: `@react-native-community/netinfo` (v11.4.1, agregado en el commit `2356c5b` del 08-10) es un paquete con módulo nativo compilado, no JS puro — `offlineSync.ts` lo usa (`NetInfo.addEventListener`) para saber cuándo hay señal y sincronizar la cola. El build nativo publicado en Play Store (versionCode 3) se generó el 2026-08-06, **antes** de que netinfo se agregara al repo — confirmado con `git show b98d6cf:mobile/package.json` (sin netinfo) contra el commit real del build. El APK instalado en el dispositivo de la finca no tenía el módulo nativo enlazado; al abrir la app con el OTA aplicado, `initOfflineSync()` en `app/_layout.tsx` habría fallado en runtime.

**Resuelto en la sesión:** se disparó `eas build --profile production --platform android` (versionCode 3→4, autoincrementado). Build exitoso, `.aab` descargado (`C:\Users\faust\Downloads\los-lirios-v1.0.0-4.aab`, 38.7 MB). Subida a Play Console (Prueba interna) coordinada con Fausto — el archivo supera el límite de 10 MB de la automatización por Chrome, mismo límite que ya se había topado la sesión del 2026-07-29 con las capturas de pantalla y el primer `.aab`.

## Logging estructurado + exception handler genérico + Sentry (roadmap #2, cerrado)

Antes de esta sesión: cero logging en todo el backend, ningún exception handler genérico (`backend/app/main.py` solo tenía el handler de `RateLimitExceeded`), cero referencia a Sentry en el repo. Un 500 no manejado no dejaba ningún rastro propio.

**Implementado:**
- `backend/app/core/logging_config.py` (nuevo): `configure_logging()`, root logger a stdout (Railway lo captura tal cual, sin flags adicionales).
- `backend/app/core/config.py`: `LOG_LEVEL` (validado contra los 5 niveles estándar) y `SENTRY_DSN` (opcional, `None` desactiva Sentry).
- `backend/app/main.py`: `sentry_sdk.init(...)` condicional a que `SENTRY_DSN` esté seteado, más `@app.exception_handler(Exception)` que loguea el traceback completo y devuelve un 500 genérico sin filtrar detalles internos al cliente. Verificado que Starlette resuelve por la clase más específica del MRO — las rutas con `raise HTTPException(...)` explícito (patrón usado en todo el proyecto) siguen devolviendo su código/mensaje normal, no pasan por el handler nuevo.
- `backend/requirements.txt`: `sentry-sdk==2.67.1`.

**Decisión sobre Sentry:** el roadmap decía "evaluar, no decidido". Se le preguntó a Fausto en el momento — eligió instalarlo ya (no solo dejar el hook inerte). Fausto ya tenía la cuenta creada en sentry.io (trial 14 días) y la dejó abierta en Chrome; se completó el onboarding (proyecto FastAPI, "Error monitoring" activo) vía Claude in Chrome y se obtuvo el DSN del proyecto (`o4511894621585408.ingest.us.sentry.io`, proyecto `PYTHON-FASTAPI-1`).

**Verificado en vivo** (backend local contra Postgres local, `SENTRY_DSN` inyectado por variable de entorno sin tocar `.env`): endpoint de debug temporal (`1/0`, no commiteado) devolvió 500 genérico al cliente; el log mostró `2026-08-11 20:26:12,790 ERROR app: Unhandled exception on GET /__debug_smoke_test` con el formato esperado; el evento (`ZeroDivisionError`) apareció en el dashboard de Sentry. `/auth/login` con credenciales inválidas siguió devolviendo su 401 normal (`Incorrect username or password`), confirmando que el handler nuevo no interceptó lo que ya se manejaba antes.

**Pendiente que tiene que hacer Fausto:** agregar `SENTRY_DSN` como variable de entorno en Railway (dashboard, no vía Claude Code) para que se active en producción. Sin eso, el backend deployado sigue funcionando igual que antes (Sentry es no-op sin DSN), solo que sin reportar a Sentry.

## Tests de idempotencia riego/fitosanitarios/cosecha (roadmap #3, cerrado)

El backend ya soportaba idempotencia completa (columna `idempotency_key` + índice único parcial + pre-check en el endpoint) en los 4 modelos de producción desde el 2026-07-29 — solo faltaba el test para 3 de los 4 (`registros_trabajo` ya estaba cubierto).

**Causa raíz real del bug histórico "no such table: parcelas"** (documentado como misterio sin resolver desde el 07-29): cualquier intento anterior de fixture de `Parcela` debe haber usado el engine de producción (`app.core.database`) en vez de `TestSessionLocal` de `conftest.py` — el test engine usa SQLite in-memory + `StaticPool` y solo las conexiones de `TestSessionLocal` ven el `create_all()` que corre antes de cada test.

**Fix:** fixture `create_parcela` en `conftest.py` (mismo patrón que `create_user`, usa `TestSessionLocal`). 3 tests nuevos en `test_produccion_idempotency.py` (reintento con misma `idempotency_key` → mismo `id`, un solo registro en el listado), uno por modelo. Suite completa: 27/27 passing.

## Test de registro de routers (roadmap #4, cerrado)

Pensado para que el bug del router de clima (nunca registrado en `main.py`, resuelto el 08-10) no pueda repetirse en silencio. Primer intento (importar todos los módulos de `app/api/` con `importlib`) rompió contra `seed_cosecha.py`/`seed_parcelas.py`, que ejecutan código con efectos secundarios al importarse (`sys.exit(1)` si falta `openpyxl`, una dependencia opcional no instalada en este entorno). Corregido: descubrimiento estático vía `ast` (parsea el archivo, busca `router = APIRouter(...)` a nivel de módulo, sin ejecutar nada) y verificación contra `app.routes` ya cargadas por `app.main`. `backend/tests/test_router_registration.py` (nuevo).

## Deploy

Backend: commit `cafb3bc` (logging/Sentry/tests) + `e31e159` (versionCode mobile) pusheados a `main`. Railway auto-desplegó. Mobile: build versionCode 4 completo, publicación en Play Console (Prueba interna) en curso al cierre de esta nota — ver arriba.

## Ver también

- [[2026-08-10-clima-fix-inicio-layout-riego-alertas]]
- [[Sistema de Gestión Agrícola]]
- [[Bugs Conocidos]]
