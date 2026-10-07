---
name: deploy-lirios
description: Checklist para deployar Los Lirios (backend Railway, web Vercel, mobile EAS OTA/build). Usar cuando el usuario pida deployar, publicar, subir a producción, hacer un OTA o un build.
---

# Deploy Los Lirios

Confirmar con el usuario ANTES de cada push/deploy/`eas update`/`eas build`/migración en producción.

## 0. Pre-flight (siempre)
1. `git status` limpio y cambio ya probado en local (uvicorn + npm local, click real).
2. Delegar a `qa-tester`: pytest, `npm run lint && npm run build`, `npx tsc --noEmit` (mobile). Todo verde.
3. Si hay migración: revisar el archivo generado y avisar que corre contra producción.

## 1. Backend → Railway
- Auto-deploy al push a `main`. Después: `npx @railway/cli logs -n 100` y un request de salud.
- Migración en prod: `scripts/migracion/_alembic_prod.py` (con confirmación explícita).

## 2. Web → Vercel (NO auto-despliega)
- `npx vercel --prod` desde `frontend/`, después `npx vercel` estado / abrir la URL y verificar la pantalla tocada.

## 3. Mobile → EAS
Decidir OTA vs build nativo:
- Cambió `eas.json`, dependencias nativas o config nativa de `app.json` → cambia el fingerprint → **build nuevo** (Play interna/cerrada, TestFlight). El OTA no llega a los binarios existentes.
- Solo JS/TS/assets → OTA: `eas update --branch production --environment production -m "msg"` (ver `mobile/AGENTS.md`; siempre con `--environment`).
- Verificar el bundle publicado: contiene la URL de producción y NO `192.168.*`.
- Ante crash de Android: Play Console → Android vitals primero.

## 4. Cierre
Reportar qué se deployó, cómo se verificó y qué quedó sin verificar. Delegar bitácora a `docs-sync` si corresponde.
