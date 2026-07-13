---
fecha: 2026-07-10
tags: [sistema, deploy, checklist]
estado: resuelto — piloto en producción desde 2026-07-11
---

# Checklist Deploy de Prueba (Semana Piloto)

> ✅ **Resuelto.** Los 5 bloqueantes de abajo se ejecutaron el 2026-07-10/11. Aparecieron 7 problemas adicionales no anticipados por este checklist — detalle completo, URLs de producción y lista de commits en [[2026-07-11-deploy-piloto-completado]]. Este documento se conserva como registro histórico del análisis original.

## Veredicto original

**Todavía no.** Pero no falta código — falta "último kilómetro" de deploy: config sin pushear, variables de entorno sin fijar, una versión de Python sin validar. Son ~5 acciones puntuales, estimo medio día de trabajo, no semanas. El backend está sólido (seguridad auditada línea por línea, tests pasando, bugs viejos corregidos). El frontend compila limpio y las funcionalidades core andan. Con los 5 bloqueantes de abajo resueltos, se puede lanzar.

---

## 🔴 Bloqueantes reales (resolver antes de arrancar la prueba) — ✅ todos resueltos

### 1. `railway.json` y `runtime.txt` nunca se commitearon
Están **untracked** en git desde que se crearon (sin historial). Si conectás el repo de GitHub a Railway para deployar, Railway no los va a ver — corre auto-detección de Nixpacks sin el `startCommand` que corre `alembic upgrade head` antes de levantar uvicorn. El deploy puede fallar o arrancar con la DB desactualizada.
**Acción:** `git add backend/railway.json backend/runtime.txt` + commit + push, antes de disparar el deploy.

### 2. Nadie validó los tests contra la versión de Python que se va a desplegar
`runtime.txt` fija `python-3.12`, pero el venv local donde corrieron los 11 tests es Python 3.14.3. Nunca se corrió la suite en 3.12.
**Acción:** recrear un venv local con 3.12 (`py -3.12 -m venv venv312`) y correr `pytest` ahí. Si algo falla por diferencias de versión, mejor descubrirlo ahora que en producción.

### 3. Contenido real de `backend/.env` sin verificar
No se leyó el archivo (por instrucción explícita del proyecto de no tocarlo), así que no se confirmó que `ALLOWED_ORIGINS` apunte al dominio real del frontend de producción (no `localhost`, no `"*"`) ni que `SECRET_KEY` sea lo bastante fuerte. La validación de arranque en `config.py` va a **rechazar el arranque** en `ENVIRONMENT=production` si `SECRET_KEY` es débil o si `ALLOWED_ORIGINS` tiene `"*"` — así que si falta, el error va a ser ruidoso y temprano, pero mejor confirmarlo a mano antes.
**Acción:** revisar manualmente `backend/.env` antes de fijar `ENVIRONMENT=production` en Railway.

### 4. `NEXT_PUBLIC_API_URL` sin fijar en el hosting del frontend
`lib/api.ts` cae a `http://localhost:8000` si no está seteada. Sin esto, el frontend deployado va a intentar pegarle a `localhost:8000` del navegador de cada usuario — falla silenciosa, sin error visible más allá de requests que no llegan a ningún lado.
**Acción:** fijar `NEXT_PUBLIC_API_URL` = URL pública del backend en Railway, como variable de entorno en la plataforma de hosting del frontend (Vercel u otra).

### 5. Mobile apunta a una IP de LAN, no al backend público
`mobile/lib/api.ts` tiene de fallback una IP local (`192.168.0.111:8000`, cambiada recién sin commitear). Sirve solo dentro de la misma red WiFi. Si encargados/regadores/obreros van a probar la app fuera de esa red durante la semana, hace falta apuntar a Railway y **generar un build EAS nuevo** — las variables `EXPO_PUBLIC_*` se hornean en build time, cambiar el `.env` no alcanza sin rebuildear.
**Acción:** si mobile participa de la prueba, fijar `EXPO_PUBLIC_API_URL` al dominio de Railway, commitear, `eas build`, distribuir a testers. Si mobile NO participa esta semana (solo se prueba la web), este punto no bloquea — decidilo explícitamente.

---

## 🟠 Antes de arrancar, aunque no sea "bloqueante de código" — ✅ hecho

### 6. No hay backup automático de la base de datos
✅ Backup manual pre-piloto hecho el 2026-07-10 (`pg_backups/loslirios_railway_20260710_pilot.dump`, gitignoreado). Sigue sin existir una rutina automática — queda como pendiente futuro, ver [[Sistema de Gestión Agrícola]].

### 7. Revisar logs de Railway a diario
No hay logging estructurado ni exception handler genérico en el backend — los errores 500 no dejan rastro propio, solo lo que capture la plataforma de hosting. Durante la semana, revisar el log de Railway a mano (`railway logs --follow`) es la única forma de enterarse de errores que los usuarios no reporten. Pendiente de hacer día a día durante la prueba piloto.

---

## 🟡 Riesgos conocidos, aceptables para una prueba de 1 semana (no bloquean, pero avisar a los testers)

- Rate limiting en memoria (single-worker) — está bien mientras el deploy no escale a más de 1 worker.
- Sin error boundaries en el frontend (`error.tsx`/`loading.tsx` no existen) — una excepción no controlada cae en la pantalla de error genérica de Next sin poder reintentar. Pedirle a los testers que avisen si ven una pantalla en blanco/error.
- Sin refresh token — el usuario es deslogueado abruptamente al expirar el JWT, sin aviso previo.
- Responsividad mobile del frontend web limitada (solo 11/43 componentes con breakpoints, layout desktop-first) — si alguien prueba desde el navegador del celular en vez de la app nativa, la experiencia va a ser mala. Recomendar usar la app mobile o una PC/tablet para el rol web.
- TareaForm sin campo `finca` ni selector de `Trabajador` — los registros de tarea diaria de esta semana no van a quedar vinculados al modelo `Trabajador` nuevo ni con `finca` propia (solo el egreso derivado la tiene). Aceptable si el foco de la prueba no es ese flujo específico.

---

## Orden de ejecución seguido (real, 2026-07-10/11)

1. ✅ Commitear y pushear `railway.json` + `runtime.txt`.
2. ✅ Revisar `backend/.env` a mano (`SECRET_KEY`, `ALLOWED_ORIGINS`, `ENVIRONMENT`); valores nuevos generados para producción.
3. ✅ Venv 3.12 local, `pytest` 11/11 verde.
4. ✅ Deploy backend en Railway. `/docs` devuelve 404, `ENVIRONMENT=production` confirmado. (Problemas no anticipados: `DATABASE_URL` async, Root Directory del monorepo, puerto del proxy, redeploy manual tras cambiar `ALLOWED_ORIGINS` vía CLI — ver [[2026-07-11-deploy-piloto-completado]]).
5. ✅ Deploy frontend en Vercel con `NEXT_PUBLIC_API_URL` apuntando al dominio de Railway. CORS confirmado.
6. ✅ Mobile participó esta semana: `EXPO_PUBLIC_API_URL` vía `eas.json` + build EAS + APK distribuido. (Problemas no anticipados: symlinks de Obsidian rompiendo el archivador en Windows, venv no gitignoreado inflando el paquete a 1.3GB, variables de shell no viajan al build en la nube, lockfile desincronizado, conflicto de peer dependency `react-dom`/`react` — ver [[2026-07-11-deploy-piloto-completado]]).
7. ✅ Backup manual de la DB antes de la primera sesión de uso real.
8. ⏳ Durante la semana: revisar logs de Railway a diario — pendiente, es tarea recurrente no de una sola vez.

## Ver también

- [[2026-07-11-deploy-piloto-completado]] — detalle completo de ejecución, URLs reales, problemas encontrados
- [[Arquitectura]]
- [[Bugs Conocidos]]
- [[Stack Técnico]]
- [[Sistema de Gestión Agrícola]]
