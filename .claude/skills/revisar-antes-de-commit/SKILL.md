---
name: revisar-antes-de-commit
description: Revisión previa a commit o deploy en Los Lirios — corre code-reviewer y qa-tester en paralelo sobre el diff y da un veredicto. Usar cuando el usuario diga "revisá", "listo para commitear", "está listo?" o al terminar un cambio no trivial.
---

# Revisar antes de commit

1. `git status` y `git diff --stat` para saber qué cambió (backend, frontend, mobile).
2. Lanzar **en paralelo, en un mismo mensaje**:
   - agente `code-reviewer`: revisa el diff contra las convenciones de `CLAUDE.md`.
   - agente `qa-tester`: corre solo los chequeos de las partes tocadas (pytest / lint+build / tsc).
3. Si hubo cambio de modelo, router, migración o pantalla: confirmar que se corrió `docs-sync` (o los dos generadores).
4. Resumir en un veredicto: **LISTO**, **LISTO CON OBSERVACIONES** o **NO LISTO**, con los hallazgos graves primero y lo que no se pudo verificar.
5. No commitear ni pushear: eso lo decide el usuario. Si pide commitear, mensaje descriptivo en español, sin `git push` sin confirmación.
