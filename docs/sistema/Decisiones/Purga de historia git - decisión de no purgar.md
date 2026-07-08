---
fecha: 2026-07-03
tags: [sistema, decision, seguridad]
estado: resuelta
---

# Decisión: Purgar o no la historia de git con los .env viejos

## Contexto

Durante el hardening de seguridad de julio 2026 se descubrió que `backend/.env` y `mobile/.env`
estuvieron versionados en git desde hace tiempo (5 commits los tocan). Contenían `SECRET_KEY`
débil, la contraseña de PostgreSQL y (en mobile) una URL de API local. Se dejaron de trackear
y se agregó `.gitignore`, pero esos valores siguen en la historia del repo en GitHub
(`FaustoYanzon/Proyecto-Gestion-Los-Lirios-`) aunque ya no estén en el working tree.

## Opciones consideradas

### Opción A — Purgar la historia con `git-filter-repo` + force-push

**Pros:**
- Elimina físicamente los secretos viejos de todos los commits.

**Contras:**
- Reescribe todos los hashes de commit — rompe cualquier clon local existente.
- Requiere `force-push`, operación destructiva y difícil de revertir.
- Beneficio marginal: los secretos ya fueron rotados (ver más abajo), así que no sirven para nada aunque sigan visibles en la historia.

### Opción B — Dejar la historia como está

**Pros:**
- Cero riesgo operativo (no se reescribe nada, no hace falta coordinar un force-push).
- Los secretos expuestos ya no son válidos: `SECRET_KEY` nueva, password de Postgres rotada vía `ALTER USER`, password del super_admin rotada dos veces.

**Contras:**
- Un atacante con acceso al historial del repo puede ver *que hubo* una password de Postgres y un patrón de `SECRET_KEY`, aunque los valores ya no sirvan.

## Decisión

**Se elige:** Opción B — no purgar.
**Razón:** con los tres secretos ya rotados (`SECRET_KEY`, password de Postgres, password del super_admin), el valor expuesto en la historia vieja es inerte. Reescribir hashes y forzar push es una operación de alto riesgo operativo para un beneficio de seguridad marginal en un repo de un solo desarrollador.

## Consecuencias

- No se ejecuta `git-filter-repo` / BFG por ahora.
- Si en el futuro el repo pasa a tener más colaboradores o se vuelve público, revisar esta decisión de nuevo.
- Los `.env` reales quedan siempre fuera de git de acá en adelante (`.gitignore` ya cubre `**/.env`).

## Ver también

- [[Arquitectura]]
- [[Stack Técnico]]
