---
tags: [sistema, deploy, sesion]
---

# Deploy de Prueba Piloto — Completado (2026-07-10/11)

> Sesión de ejecución de los 5 bloqueantes documentados en [[Checklist Deploy de Prueba (Semana Piloto)]]. Resultado: sistema web (backend + frontend) y app mobile en producción, listos para la semana de prueba piloto.

## Resumen

Los 5 bloqueantes del checklist eran correctos pero incompletos — al ejecutarlos aparecieron **7 problemas adicionales** no anticipados, todos reales (no falsos positivos), la mayoría específicos de la infraestructura elegida (Railway + Vercel + EAS) y no visibles sin intentar el deploy real. Ninguno requirió repensar arquitectura; todos se resolvieron el mismo día.

## URLs en producción

| Servicio | URL |
|---|---|
| Backend (Railway) | `https://proyecto-gestion-los-lirios-production.up.railway.app` |
| Frontend (Vercel) | `https://frontend-six-jade-79.vercel.app` |
| Mobile (EAS build) | `https://expo.dev/accounts/faustoyanzon2411/projects/los-lirios/builds/7f068a01-a80a-44d7-ad09-8170aedc06bb` |

Backend: proyecto Railway `adequate-cooperation`, servicio `Proyecto-Gestion-Los-Lirios-`, Postgres con TCP proxy en `nozomi.proxy.rlwy.net:52538`. Super admin `administracion@losliriossa.com` y 36 parcelas cargadas en la DB de producción. Backup manual pre-piloto en `pg_backups/loslirios_railway_20260710_pilot.dump` (carpeta gitignoreada, no vive en el repo).

---

## Los 5 bloqueantes originales — todos resueltos

1. **`railway.json`/`runtime.txt` sin commitear** → commiteados y pusheados (`eec8924`).
2. **Tests nunca corridos contra Python 3.12** → venv 3.12 local, 11/11 passing (Python 3.12.10, coincide con `runtime.txt`).
3. **`.env` sin verificar** → revisado manualmente por el usuario; `SECRET_KEY` y `SUPER_ADMIN_PASSWORD` nuevos generados para producción (64 y 24 bytes urlsafe respectivamente), nunca escritos al `.env` local.
4. **`NEXT_PUBLIC_API_URL` sin fijar** → seteada en Vercel, deploy `vercel --prod` exitoso.
5. **Mobile con IP de LAN hardcodeada** → `EXPO_PUBLIC_API_URL` fijada vía `eas.json`, build EAS distribuido.

---

## Problemas adicionales encontrados durante la ejecución

### 1. `DATABASE_URL` de Railway es sync, la app necesita async
**Dónde:** variables de entorno del servicio backend en Railway.
`backend/app/core/database.py:14` usa `create_async_engine(settings.DATABASE_URL)` sin fallback — requiere el driver `asyncpg` explícito en el scheme (`postgresql+asyncpg://`). El `DATABASE_URL` que Railway genera automáticamente para el plugin de Postgres es `postgresql://` plano (pensado para clientes sync). Sin corregirlo, `alembic upgrade head` falla apenas arranca el contenedor.
**Fix:** variable manual con sintaxis de referencia de Railway: `postgresql+asyncpg://${{Postgres.PGUSER}}:${{Postgres.PGPASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}`.

### 2. Monorepo sin Root Directory explícito
Railway (y en teoría Vercel) necesitan que se les diga el subdirectorio del servicio (`backend`) — si no, el auto-detector de Nixpacks busca `railway.json` en la raíz del repo y no lo encuentra. Se configuró en Settings → General → Root Directory.

### 3. Puerto del proxy de Railway desalineado
Al generar el dominio público (Settings → Networking → Generate Domain) se puso el puerto `8000` por error de tipeo/confusión, pero uvicorn escucha en `8080` (el puerto que Railway inyecta vía `$PORT`, correctamente reflejado en `railway.json`). Resultado: `502 Application failed to respond` a pesar de que los logs mostraban la app arrancando bien. Fix: corregir el puerto del proxy a `8080` en Networking.

### 4. `railway variables --set` no dispara redeploy automático
A diferencia de guardar una variable desde el dashboard web (que sí redeploya solo), cambiar una variable vía CLI (`railway variables --set KEY=value`) la actualiza pero no reinicia el servicio. Hubo que forzar `railway redeploy` explícito después de corregir `ALLOWED_ORIGINS` con el dominio real de Vercel (el checklist ya anticipaba esta corrección circular, pero no el paso manual de redeploy).

### 5. `app/models/__init__.py` no registraba `Trabajador` — bug real, no de infra
El agregador "importar todos los modelos" (`backend/app/models/__init__.py`) nunca incluyó `Trabajador`/`RolTrabajador`, a pesar de que sí está en `backend/app/core/migrations/env.py` (inconsistencia entre los dos lugares que deberían tener la misma lista). Cualquier script standalone que dependiera del agregador (`seed.py`, `seed_parcelas.py`) crasheaba con `InvalidRequestError` al intentar resolver la relación `RegistroTrabajo.trabajador` la primera vez que SQLAlchemy configuraba los mappers. La app viva no se veía afectada porque `main.py` importa el router `trabajadores` directamente, que arrastra el modelo como efecto secundario — por eso nunca se notó en desarrollo normal.
**Fix:** agregado el import faltante en `app/models/__init__.py` (commit `a8dea55`). Bug de código real, no relacionado al deploy en sí — vale la pena revisar si hay otros scripts standalone con el mismo riesgo.

### 6. EAS Build no puede empaquetar los symlinks de Obsidian en Windows
`eas build` sube el monorepo completo desde la raíz de git por default. Los symlinks `docs/proyectos` y `docs/sistema` (que apuntan a esta bóveda, fuera del repo) hacen que el archivador falle con `EPERM: operation not permitted, symlink...` porque Windows no permite recrear symlinks sin privilegios elevados o modo desarrollador. Se agregó `.easignore` en la raíz del repo excluyendo `docs/`.

### 7. Archivo de build de 1.3GB por un venv no gitignoreado
`backend/venv312/` (el venv creado para validar contra Python 3.12) no coincide con los patrones `.venv/`/`venv/` del `.gitignore`, así que se colaba entero en el paquete que sube EAS. Se agregó explícitamente a `.easignore`, bajando el archivo de 1.3GB a 31.4MB.

### 8. Variables de shell local no viajan a los builds en la nube de EAS
`EXPO_PUBLIC_API_URL="..." eas build ...` no tiene efecto — `eas build` sube el proyecto y compila en máquinas de Expo, que no heredan el entorno de shell de quien lo invoca. Hay que declarar la variable en el campo `env` del profile correspondiente dentro de `eas.json` (o como EAS Environment Variable en el dashboard/CLI `eas env:create`). Se optó por `eas.json` por ser declarativo y versionado.

### 9. `mobile/package-lock.json` desincronizado
El lockfile no tenía `react-dom` ni `scheduler`, presentes en `package.json`. `npm ci` (usado por EAS Build, estricto) fallaba; `npm install` (usado en desarrollo local) los resolvía en silencio con solo un warning. Regenerado con `npm install` + commit.

### 10. Conflicto de peer dependency: `react-dom` vs `react`
Al resolver el punto anterior, `npm install` resolvió `react-dom` a la versión `19.2.7` (la más nueva, arrastrada como peer opcional de `expo-router` para soporte web), que exige `react@^19.2.7` — pero el proyecto fija `react@19.1.0`. `npm install` lo resuelve con un warning ignorable; `npm ci` en el servidor de EAS lo rechaza en seco (`ERESOLVE could not resolve`). Fix real: `"overrides": {"react-dom": "19.1.0"}` en `mobile/package.json`, validado localmente con `rm -rf node_modules && npm ci` antes de volver a subir.

---

## Cola de build EAS — nota operativa, no bug

El build de Android tardó ~1 hora en total repartida en 3 intentos (2 fallidos por los puntos 9 y 10, uno exitoso). La cola gratuita de EAS no tiene garantía de tiempo de espera — para futuros deploys, conviene lanzar el build con margen de tiempo, o evaluar el tier pago si la cadencia de builds va a ser frecuente.

---

## Commits de la sesión (orden cronológico)

| Commit | Descripción |
|---|---|
| `eec8924` | `railway.json` + `runtime.txt` |
| `fb6c08c` | fix IP LAN mobile (fallback dev) |
| `a8dea55` | fix import faltante de `Trabajador` en agregador de modelos |
| `f1c1fa2` | `.easignore` + `EXPO_PUBLIC_API_URL` en `eas.json` |
| `7219cf0` | gitignore `pg_backups/` |
| `f47c213` | sync `package-lock.json` |
| `2844b35` | override `react-dom@19.1.0` |

## Ver también

- [[Checklist Deploy de Prueba (Semana Piloto)]]
- [[Bugs Conocidos]]
- [[Arquitectura]]
- [[Stack Técnico]]
- [[Sistema de Gestión Agrícola]]
