---
tags: [sistema, sesion, backend, frontend, mobile, bugs]
---

# 2026-08-10 — Fix real del clima, cola offline mobile, backup, layout Inicio, riego y alertas

Sesión larga, varias tandas. Arrancó retomando los 2 pendientes del roadmap (cola offline + backup), pero el hallazgo grande del día fue que **el clima nunca había funcionado, ni antes ni después de la sesión del 08-05/06 que lo "enriqueció"**.

## 1. Backup: integridad real del dump

Agregado `pg_restore --list` a `scripts/backup_postgres.ps1` (después del chequeo de tamaño, antes de la copia offsite) — cierra el blindspot documentado el 2026-08-05 (dumps truncados de las corridas de catch-up que pasaban el chequeo de tamaño >10KB pero no eran restaurables). Probado contra producción (OK) y contra un dump truncado simulado (20KB, pasa el chequeo de tamaño, `pg_restore --list` lo rechaza con exit 1). No se implementó la tarea de salud diaria separada — decisión explícita, solo el fix de integridad + logging.

## 2. Cola de envíos offline (mobile)

Implementado el spec completo ([[Spec — Cola de envíos offline (mobile)]]) para los 3 wizards (tareas/riego/fito): `@react-native-community/netinfo` instalado, `mobile/lib/offlineQueue.ts` (cola en AsyncStorage, límite 7 días antes de marcar `failed`), `mobile/lib/offlineSync.ts` (listener NetInfo + AppState, procesa FIFO), banner "N pendientes" en las 3 listas. Los 3 `handleSubmit` ahora encolan en vez de mostrar error cuando falla sin respuesta del servidor.

**Pendiente sin confirmar:** `netinfo` trae módulo nativo Android. Se publicó por `eas update` (OTA, solo JS) — si el módulo nativo no estaba ya en el binario instalado (v3, `1.0.0-3`), la detección de conectividad puede no funcionar hasta el próximo `eas build`. No verificado en dispositivo real todavía.

## 3. Camilo no estaba como tester (a pesar de creerlo confirmado)

Verificado en Play Console con Claude in Chrome: la lista de "Testers internos" solo tenía a Fausto y Rafael. Agregado `camilotrabajofinca@gmail.com`. De paso confirmado: revisión de contenido de Google Play completa sin problemas, v3 activa.

## 4. El widget de clima nunca funcionó — root cause real

Fausto reportó que no se veía en ningún lado (ni web ni mobile) a pesar de que la sesión del 08-05/06 lo había "enriquecido" (viento, humedad, UV). Investigado a fondo, recorriendo *todo* el historial de git:

1. **`app.api.clima` nunca se registró en `main.py`** — ni una vez, en ningún commit desde que el archivo se creó (commit `1d3e0d2`, hace meses). `GET /clima/actual` daba 404 en producción, confirmado en vivo con `curl`.
2. **`ClimaCache` no estaba en `app/models/__init__.py`** (el agregador que usa Alembic autogenerate) — invisible para migraciones.
3. **No existía ninguna migración para la tabla `clima_cache`.** Aunque se arreglara el punto 1, el endpoint hubiera tirado 500.

Encontrados dos bugs más al probar de punta a punta contra Postgres local:
4. `clima_cache.py` tenía un carácter `\r` corrupto en medio de una línea de import (`from datetime import datetime\r, timezone`) — rompía hasta el `alembic revision --autogenerate`. Arreglado con `perl -pe 's/\r(?!\n)//g'`.
5. `fetched_at` era `DateTime` sin timezone mientras el código escribe `datetime.now(timezone.utc)` — asyncpg rechazaba el insert (`can't subtract offset-naive and offset-aware datetimes`). Cambiado a `DateTime(timezone=True)`.

**Fix:** los 3 archivos corregidos + migración `cfb6c28f988d` (tabla `clima_cache`, columna tz-aware). Probado de punta a punta contra Postgres local (servicio real, cache funcionando, datos reales de Open-Meteo) antes de pushear. 23/23 tests backend. Deployado — Railway corrió la migración sola, confirmado con `curl` (404→401 en `/clima/actual`).

**Lección:** el "enriquecimiento" del 08-05/06 solo tocó `services/clima.py` (la lógica), nadie verificó que el endpoint respondiera de verdad. Ningún test cubre el árbol de endpoints registrados en `main.py` — sería una buena red de seguridad futura (ej. un test que compare los routers importados contra los efectivamente incluidos).

## 5. Layout del Inicio + widget de clima mobile ampliado

- Grid mapa+sidebar: `1.6fr 1fr` → `1fr 1fr` (mapa más angosto).
- `ClimateCard` (web) tenía `w-full sm:w-72` — el `sm:w-72` lo capaba a ancho fijo aunque el sidebar fuera más ancho. Sacado.
- Widget de clima mobile (`ClimateCardMini`) ampliado para espejar el de web: ícono grande, sensación térmica, máx/mín del día, fila de viento/humedad/UV con íconos (mismos umbrales y colores de UV que la versión web).

## 6. Riego: error falso al confirmar (web)

Mismo patrón que el bug de "terminar riego" del 2026-07-27: `RiegoForm.tsx` (formulario de riego completo, con inicio y fin) tenía un catch genérico que no distinguía error real de "la escritura llegó pero se perdió la respuesta". El riego se guardaba igual, pero el usuario veía error. Fix: si falla sin `response`, reintenta una vez más antes de mostrar error — seguro porque las creaciones llevan `idempotency_key` (el backend deduplica) y las ediciones son un PUT de reemplazo completo (idempotente por naturaleza).

## 7. "Iniciar riego en curso" en web — ya existía, estaba sin descubrir

Fausto pensaba que faltaba. En realidad está desde el commit `1f832b3` (sesión del 07-17): botón "Iniciar riego" en `/dashboard/produccion/riego` (`IniciarRiegoForm.tsx`) y panel `RiegosEnCurso` ya en el Inicio (solo lectura, sin "Terminar", igual que mobile). El problema real: el panel devolvía `null` si no había ningún riego activo — sin ninguna pista de que la función existía. Agregado un CTA de estado vacío ("Sin riegos en curso — Iniciar uno →") que linkea a la página de Riego.

## 8. Panel de Alertas tipo "buzón"

Las alertas del Inicio se calculan **en vivo** (riego atrasado, carencia fitosanitaria, sin fenología) — no eran filas persistidas, sin forma de "completarlas". Decisiones tomadas con Fausto: persistencia en backend (compartida entre usuarios, no por-dispositivo) y expiración a 48h (para que un descarte accidental no silencie para siempre una alerta real como "riego atrasado").

**Backend:** tabla `alertas_descartadas` (`alerta_id` + `tipo` completada/cancelada + `expira_at`), endpoints `GET /alertas/descartadas` y `POST /alertas/descartar`. Migración `e53cf61acb03`.

**Frontend:** el widget de Alertas es ahora un botón que abre un modal (`BuzonModal.tsx`, componente compartido) con todas las alertas, cada una con ✓ (verde, completada) y ✕ (gris, cancelada) — ambos botones tienen el mismo efecto técnico (ocultar 48h), la distinción es solo de intención para el usuario.

## 9. Riegos en curso — mismo patrón que Alertas + fixes de layout

Con varios riegos en curso a la vez, la lista completa en el Inicio ocupaba demasiado. `RiegosEnCurso.tsx` ganó un prop `collapsed` (solo usado en Inicio): muestra el primero + "N más — ver todos", click abre el mismo `BuzonModal`. La página de Riego sigue mostrando la lista completa siempre (`collapsed=false`, default).

Pedido explícito de Fausto: los dos modales (Alertas y Riegos en curso) el doble de grandes. `BuzonModal` pasó de `max-w-md` (448px) a `max-w-[56rem]` (896px, 2x exacto) y de `max-h-[70vh]` a `max-h-[85vh]` (el máximo práctico — 2x literal de vh se saldría de la pantalla).

**Dos bugs de layout encontrados y corregidos en la misma tanda:**
- El grid mapa+sidebar tenía `minHeight`/`maxHeight` (320/380) sin altura fija — con el widget de clima más grande y el resumen de alertas, el contenido del sidebar superaba 380px y, por `overflow: visible` default de CSS, se desbordaba encima de "Tareas recomendadas" en vez de recortarse. Cambiado a `height: 460` fija.
- Los modales (`BuzonModal`, `z-50`) quedaban **detrás** del mapa de Leaflet — Leaflet usa z-index internos de hasta 1000 (`.leaflet-top`/`.leaflet-bottom` para controles). Subido a `z-[2000]`.

**Bonus:** el mapa compacto del Inicio ahora es un link a `/dashboard/mapa` — ya era 100% inerte en modo `compact` (dragging/zoom/click de parcelas deshabilitados ahí, confirmado en `FincaMapInner.tsx`), así que no hay conflicto de eventos con la navegación.

## Commits de la sesión (orden cronológico)

`0c96337` `2356c5b` `5c38bd2` `83070ad` `2364f20` `ce7b567` `37ccfea` `31343ed` — todos en `main`, todos deployados (Railway auto + `vercel --prod` x5 + `eas update` x1).

## Pendiente real para la próxima sesión

1. **Confirmar en dispositivo real** que la cola offline funciona (especialmente si `netinfo` necesita un `eas build` nuevo — no confirmado).
2. Logging estructurado + exception handler genérico en el backend (arrastrado desde el 08-05, no decidido todavía).
3. Extender `test_produccion_idempotency.py` a riego/fito/cosecha (fixture de `Parcela` pendiente, menor).
4. Considerar un test que valide que todos los routers de `app/api/` están registrados en `main.py` — hubiera evitado el bug de clima.

## Ver también

- [[Bugs Conocidos]]
- [[Sistema de Gestión Agrícola]]
- [[Spec — Cola de envíos offline (mobile)]]
- [[2026-08-05-login-username-biometria-clima]]
- [[2026-07-27-duplicados-web-mapa-mobile-y-cumplimiento-riego]] (bug original de "terminar riego" falso, mismo patrón que el punto 6 de hoy)
