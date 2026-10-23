# Fito por válvula — runbook de despliegue

Rama: `feat/fito-por-valvula` (código completo, 274 tests backend, probado en local con click real).
Estado al 2026-10-23: **nada desplegado**. Se pausó por el incidente de Railway (status.railway.com:
dashboard colgado, builds lentos) y porque la clave de Postgres se rotó ese día.
Plan y spec: ver los archivos hermanos `2026-10-23-fito-confirmacion-por-valvula*.md`.

## 0. Antes de empezar
- [ ] status.railway.com en verde y el dashboard responde.
- [ ] `backend/.env` → línea `DATABASE_PUBLIC_URL=` con el valor NUEVO (dashboard de Railway → servicio
      Postgres → Variables → `DATABASE_PUBLIC_URL`). Pegarlo a mano en el archivo, no en el chat.
      (La clave vieja da `InvalidPasswordError`; afecta también al backup de prod y a `generate_modelo_datos.py`.)
- [ ] `main` limpio: si el worktree `C:\claude-projects\ll-ci-fix` todavía tiene `1fab2ca` + `e85ad91` sin
      pushear (arreglo del test de cheques por zona horaria), pushearlos primero. El cambio de
      `backend/tests/test_cheques_aviso.py` que trae esta rama es idéntico a `e85ad91`: no da conflicto.

## 1. Revisar las hectáreas (solo lectura)
```
! cd /c/claude-projects/los-lirios && backend/venv/Scripts/python.exe scripts/cargar_superficie_valvulas.py --db prod
```
Mirar: líneas `!!` (válvulas sin cuadrante / cuadrantes sin válvula) y marcas `<-- REVISAR` (> 5 % de desvío contra
`Parcela.superficie_ha`). Sospecha abierta: los cuadrantes `211`–`214` quizá no matcheen la válvula `21`.
**Si hay desvíos o válvulas sin cuadrante, resolverlos antes de seguir** (una válvula con superficie NULL no se puede confirmar: 422).

## 2. Backup y merge (backend)
- [ ] `scripts/backup_postgres.ps1` (dump de prod).
- [ ] Merge de la rama a `main` y `git push origin main` (lo corre Fausto con `!`; Railway despliega solo y
      corre las migraciones `b5210a4d05af` y `33a3c708b565`).
- [ ] Verificar: `npx @railway/cli logs` → buscar `alembic` y `Application startup complete`.

## 3. Cargar superficies (inmediatamente después del paso 2)
```
! cd /c/claude-projects/los-lirios && backend/venv/Scripts/python.exe scripts/cargar_superficie_valvulas.py --db prod --aplicar
```
Hace su propio backup antes de escribir. **No crear órdenes nuevas entre el paso 2 y este**: saldrían con válvulas
sin hectáreas y no se podrían confirmar.

## 4. Web
```
! cd /c/claude-projects/los-lirios/frontend && npx vercel --prod
```

## 5. Mobile (recién con el backend en verde)
```
! cd /c/claude-projects/los-lirios/mobile && npx eas update --branch production --environment production -m "Confirmar fito por válvula" --non-interactive
```
Antes: `npx eas-cli fingerprint:compare --build-id <id>` contra el build instalado (no tocar `eas.json`).
El OTA se aplica en la **segunda** apertura de la app (abrir con señal, esperar ~10 s, cerrar del todo, reabrir).

## 6. Prueba real
Orden chica en Parral 2: confirmar 21, 22 y 23 (una con observación), verificar el push al celular, "A revisar"
en la web, y el repaso. Verificar stock del insumo.

## Avisos para los operarios
- Builds Android 5/6 (nunca reciben OTA) quedan **sin poder confirmar parcelas que tengan válvulas** (409):
  reinstalar desde el link de Prueba cerrada (versionCode 8).
- Un toque equivocado en una válvula no se puede deshacer desde la UI (pendiente).

## Pendientes conocidos
- Regenerar `docs/sistema/Modelo de Datos.md` (`python scripts/generate_modelo_datos.py`) con la clave nueva.
- Menores: push sale antes del commit; un token de push por usuario; unidad de dosis en el repaso; sin "deshacer".
- Los push reales de la prueba local (4 llamadas a Expo con textos "QA Azufre") ya ocurrieron; la DB local no tiene datos QA.
