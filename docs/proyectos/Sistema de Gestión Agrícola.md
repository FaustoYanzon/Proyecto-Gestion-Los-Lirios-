---
tags: [proyecto, sistema, desarrollo]
---

# Sistema de Gestión Agrícola

## Objetivo

Reemplazar/complementar los workflows manuales de Excel y Power BI con un sistema web + mobile integrado para la gestión operativa de Los Lirios SA.

## Módulos

| Módulo | Backend | Frontend | Mobile |
|---|---|---|---|
| Auth / Usuarios | ✅ | ✅ | ✅ |
| Parcelas | ✅ | ✅ | parcial |
| Finanzas (ingresos/egresos) | ✅ | parcial | — |
| Producción (tareas/riego/fito) | ✅ | parcial | parcial |
| Dashboards analíticos | — | en curso | — |

## Estado actual (2026-07)

- Backend: sólido. Hardening de seguridad completado (ver [[Arquitectura]] § Seguridad): secretos rotados y fuera de git, JWT migrado a PyJWT, rate limiting por IP + por username, invalidación de sesión vía `token_version`, suite de tests de regresión (11 passed). Quedan los bugs conocidos previos a resolver (ver [[Bugs Conocidos]])
- Frontend: dashboard de finanzas y mano de obra funcionales con gaps; producción necesita rebuild
- Mobile: base con Expo 54 / React Native 0.81

## Próximos pasos

1. Corregir bugs críticos ([[Bugs Conocidos]])
2. Completar dashboards (ver [[Dashboards]])
3. Integrar API de clima real (reemplazar widget hardcodeado)
4. Módulo de notificaciones (base existe en `notificaciones.py`)
5. Backup de PostgreSQL: hecho puntualmente el 2026-07-03 (`pg_backups/loslirios_db_20260703_123804.dump`, fuera del repo). Falta definir una rutina periódica (no hay backup automático todavía).

## Ver también

- [[Arquitectura]]
- [[Stack Técnico]]
- [[Bugs Conocidos]]
- [[Dashboards]]
