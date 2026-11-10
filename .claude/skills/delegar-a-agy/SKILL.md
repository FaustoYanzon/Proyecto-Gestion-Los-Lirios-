---
name: delegar-a-agy
description: Delegar a Antigravity (agy) una tarea GRANDE, mecánica y bien acotada de Los Lirios (tests en lote, aplicar un patrón a muchos archivos, documentación masiva) en un worktree aislado. No usar para cambios chicos (menos de ~5 archivos o ~50 líneas), decisiones de arquitectura, migraciones de BD, deploy ni nada que toque secretos.
---

# Delegar a agy

## Cuándo sí y cuándo no
- **Sí:** tarea grande, repetitiva y con criterios de aceptación verificables (muchos archivos, patrón claro, sin decisiones de diseño).
- **No:** cambios chicos, arquitectura, migraciones de BD, deploy, finanzas/ARCA, cualquier cosa con secretos.
- Si dudás, hacelo vos. Medido el 2026-11-09: un cambio de ~10 líneas costó más delegado (traspaso, corrida, verificación) que hecho directo. El ahorro aparece solo en tareas grandes.

## Protocolo (PowerShell, desde `C:\claude-projects\los-lirios`, rama `main` limpia)
1. **Worktree por tarea:** `git worktree add ..\_agy-wt-<slug> -b agy/<slug>`. Copiar a mano `AGENTS.md` y la carpeta `.agents\` (están excluidos de git, el worktree no los trae).
2. **Traspaso:** escribir `.agents/handoff/TASK-<slug>.md` en el worktree a partir de `.agents/handoff/TASK_TEMPLATE.md`: objetivo, archivos permitidos, fuera de alcance, criterios de aceptación y "no shell".
3. **Correr (lo hace el usuario):**
   `agy --mode=accept-edits --print-timeout 180s -p "Read .agents/handoff/TASK-<slug>.md and do exactly what it says. Follow AGENTS.md. Do not commit. Do not run any shell command; use only your file read and edit tools." > out.txt 2>&1; Get-Content out.txt`
4. **Revisar el diff real.** Nunca confiar en el resumen de agy: ya reportó mal qué había tocado. Comparar archivos o `git diff --stat` y leer el diff completo; confirmar que solo cambiaron los archivos del alcance.
5. **Commit lo hace el humano** (agy no commitea). Después: rama `feat/...` en `los-lirios`, correr `pytest` / `npm run lint && npm run build` / `npx tsc --noEmit` según corresponda, probar en local, PR, CI verde, merge. El deploy es manual y se confirma antes.
6. **Limpiar:** `git worktree remove --force ..\_agy-wt-<slug>` y borrar la rama `agy/<slug>`.

## Reglas
- **agy solo trabaja en el worktree.** Ahí no hay `.env` ni `pg_backups`. Nunca correr agy dentro de `los-lirios/` (hay secretos: `backend/.env`, `mobile/.env`, `frontend/.env.local`, `scripts/migracion/.env.prod`).
- El modo `-p` no puede pedir permisos: sin shell. El worktree no tiene `venv` ni `node_modules`, así que los tests se corren en `los-lirios` después de traer la rama.
- No usar `--dangerously-skip-permissions`.
- Un solo agente por archivo: no editar lo mismo que agy mientras corre.
- No tocar `mobile/eas.json` ni migraciones ya aplicadas (el traspaso lo prohíbe).
