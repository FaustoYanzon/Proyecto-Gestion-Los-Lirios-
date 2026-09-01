---
tags: [sistema, sesion]
---

# 2026-08-26 — Costo por kg, perfil con avatar + cumpleaños, notificación automática

Sesión de 3 pedidos: cerrar el punto 1a del roadmap (rotar la contraseña de producción), construir "costo por kg" en el dashboard de Finanzas (roadmap sin fecha), y una feature nueva pedida por Fausto — perfil de usuario personalizable (foto + cumpleaños) en web y mobile, con notificación automática al equipo. Modo plan formal: 3 agentes Explore en paralelo (usuarios/avatar/perfil, dashboard finanzas/cosecha, notificaciones/cron) antes de diseñar, 4 preguntas de diseño resueltas con Fausto (fórmula de costo/kg, storage de fotos, audiencia de la notificación, alcance de campos extra) antes de escribir código.

## 1. Contraseña de producción — sin código

El backend ya tenía todo lo necesario: `POST /auth/change-password` (self-service, invalida `token_version`) y el form de Admin > Usuarios en web (password opcional, no invalida sesiones del usuario editado). Se le explicó a Fausto que la cambie él mismo desde la app — nunca se le pidió pasarla por el chat, y se le aclaró explícitamente que no lo haga. **No confirmado si Fausto ya la rotó** — sigue como punto abierto del roadmap hasta que lo confirme.

## 2. Costo por kg (dashboard de Finanzas)

**Hallazgo real antes de diseñar:** ya existía `GET /finanzas/dashboard/costo-por-kg` desde el commit `f4a6c12` (21/05, "Avance Fase 4"), **nunca conectado a ningún frontend** y no documentado en memoria ni bóveda. Calculaba mal para lo que se necesita hoy: sumaba **todos** los egresos ARS de la campaña completa (sin filtrar tipo) y estimaba los kg vía `CicloCampana.rendimiento_kg_ha × Parcela.superficie_ha` (el sistema viejo de fenología, rendimiento *esperado* por hectárea) en vez de la cosecha real cargada en `RegistroCosecha`.

**Decisión con Fausto:** numerador = solo costos de producción directos (`materia_prima` + `produccion` + `insumos_varios` + `repuestos_reparacion` — excluye Sueldos, que ya tiene su propio KPI "Costo MO" en Mano de Obra; excluye Impuestos/Servicios y Financiero, administrativos). Denominador = kg reales de `RegistroCosecha` con `cultivo=vid` (excluye chacra/alfalfa, cultivos secundarios que comparten la misma tabla).

**Cambio:** el mismo endpoint (mismo path, se reescribió) ahora recibe `fecha_desde`/`fecha_hasta`/`moneda`/`finca` (antes solo `anio`, campaña completa) — para que la tarjeta nueva respete el mismo rango de meses que ya usan las demás tarjetas del dashboard desde el fix del 08-18. `RegistroCosecha` no tiene columna `finca` propia (ni `Parcela`), así que el filtro de finca solo aplica al lado de egresos — documentado como limitación conocida en el código, no bloqueante hoy porque casi todo está cargado bajo Media Agua.

**Verificación:** con Claude in Chrome contra `localhost:3000`, campaña 2025/2026 real: **$45/kg**, coherente con el cálculo manual (backend dio $44.76/kg exacto). Sin errores de consola.

## 3. Perfil personalizable: avatar + cumpleaños + notificación automática

### Hallazgo real antes de diseñar
Mobile ya tenía un selector de foto (`pickAvatar()` en `perfil.tsx`) pero **100% local al dispositivo** (`expo-secure-store`, nunca llegaba al backend) — no sincronizaba entre dispositivos, no aparecía en web. El drawer lateral que pedía Fausto ("click en el círculo → panel → elegir foto") **ya existía** en mobile (`UserBadge.tsx`, con vista "Mi perfil"/finca/notificaciones/preferencias) — no hubo que construirlo de cero, solo conectar el picker a un backend real.

### Decisiones tomadas con Fausto
Storage de fotos: **Cloudinary** (cuenta free ya tenía Fausto). Notificación de cumpleaños: al equipo completo, no solo al cumpleañero (más apropiado para una empresa familiar chica). Cumpleaños en 3 columnas separadas (día/mes/año opcional) en vez de un `date` único — muchos empleados de campo no saben el año con certeza, y nunca hace falta para decidir si hoy es el cumpleaños de alguien. Sin campos extra de personalización por ahora (se descartó explícitamente teléfono/apodo/color de acento) — cerrar avatar+cumpleaños primero.

### Backend
5 columnas nuevas en `User` (`avatar_url`, `birth_day`, `birth_month`, `birth_year`, `last_birthday_notified_year` — este último evita re-notificar el mismo cumpleaños si el proceso reinicia), migración 100% aditiva. `POST /users/me/avatar` (self-service, sin rol mínimo — mismo espíritu que `/auth/change-password`) sube a Cloudinary vía su API REST firmada con `httpx` (no el SDK oficial, que es síncrono y bloquearía el event loop) — `public_id` fijo por usuario + `overwrite=true`, cada subida pisa la anterior. `PATCH /auth/me/cumpleanos` self-service.

**Cron — no existía ninguno en el proyecto** (confirmado por exploración: Railway corre un solo proceso `uvicorn`, sin worker separado, sin APScheduler/Celery). Se agregó `APScheduler` (`AsyncIOScheduler`) vía `lifespan` de FastAPI, job diario a las 8am hora finca — camino sin infraestructura nueva, coherente con el criterio que ya usa el proyecto (mismo espíritu que la decisión de no usar Google Drive para ARCA). `_send_expo_push` de `notificaciones.py` se movió a `app/core/push.py` compartido. Endpoint manual de respaldo `POST /notificaciones/cumpleanos/ejecutar` (`require_gerencial_up`) para testear y como red de seguridad si el scheduler in-process no resultara confiable a futuro (mismo código serviría detrás de un Railway Cron Job sin reescribir nada).

### Frontend web
`UserBadge.tsx` (antes un botón sin `onClick`) ahora abre `PerfilModal.tsx` (nuevo, reusa `BuzonModal` compartido — el mismo chrome ya usado por Alertas/Riegos en curso, con `z-[2000]` para no quedar detrás del mapa Leaflet). Avatar con preview + upload inmediato al elegir archivo; cumpleaños con 2 `<select>` (día/mes) + input numérico opcional (año) — no `<input type="date">`, que fuerza un año.

### Mobile
`pickAvatar()` en `perfil.tsx` reemplazado: ya no guarda en `expo-secure-store`, sube de verdad a `POST /users/me/avatar` y actualiza el `authStore` global — el avatar se lee de `user.avatar_url`, igual que `full_name`/`email`. `UserBadge.tsx` (círculo chico + `bigBadge` del drawer) muestra la foto real si existe.

**Corrección de diseño real, encontrada después del primer intento:** para el selector de día/mes de cumpleaños se había instalado `@react-native-picker/picker` — es un **módulo nativo**, no JS puro. Publicar eso solo con `eas update` (OTA) habría roto la pantalla en los celulares ya instalados (exactamente el mismo bug que ya pasó con `@react-native-community/netinfo` en agosto, documentado en [[2026-08-11-logging-sentry-tests-idempotencia-router-build-offline]]) — sin un `eas build` nuevo, el JS llama a un módulo que no está enlazado en el binario nativo instalado. Se revirtió la dependencia y se reemplazó por un selector propio en JS puro (día: `TextInput` numérico; mes: chips presionables, mismo patrón de listas ya usado en `FincaView` del propio `UserBadge.tsx`) — así se pudo publicar por OTA sin build nuevo ni resubir nada a Play Store.

### Verificación end-to-end
Local primero (metodología ya establecida): 98/98 tests backend, `tsc --noEmit` limpio en frontend y mobile. Con Claude in Chrome: cumpleaños guardado y precargado correctamente en el modal; subida de avatar probada con `file_upload` (no clickeando el botón directo — clickear un `<input type="file">` abre un diálogo nativo de Windows que la automatización del navegador no puede ver ni cerrar, y dejó una pestaña colgada una vez hasta cerrarla a mano). Notificación de cumpleaños probada por API: primera corrida notifica, segunda corrida el mismo día da 0 (idempotencia por año funciona).

**Cloudinary — probado con las credenciales reales de Fausto** (cargadas solo como variables de entorno del proceso local, nunca escritas a `backend/.env`, que está en la lista de archivos prohibidos de `CLAUDE.md`). Primer intento falló (`Invalid cloud_name FaustoYanzon` — el cloud name de Cloudinary no es necesariamente el nombre de la cuenta, hay que confirmarlo en el dashboard); con el cloud name real (`swj5zkyq`) la subida funcionó, URL devuelta y accesible públicamente, avatar visible en el círculo del header en vivo.

## Hallazgo de proceso — procesos zombie de uvicorn en Windows

Reiniciar el backend local varias veces dejó procesos huérfanos: `Stop-Process -Id <PID>` sobre el proceso *reloader* de `uvicorn --reload` no mata al proceso *worker* hijo que WatchFiles spawnea — el worker viejo se queda vivo y sigue sirviendo código desactualizado en el puerto 8000, aunque el proceso nuevo loguee "Application startup complete" sin errores. Causó ~30 minutos de confusión (el endpoint nuevo devolvía siempre el error viejo pese a que el archivo en disco y una importación directa por Python confirmaban el código correcto). **Solución real:** `taskkill /F /IM python.exe /T` (mata el árbol completo, no un PID suelto) antes de cualquier reinicio del backend local en Windows. Vale la pena tenerlo presente para la próxima vez que haga falta reiniciar `uvicorn --reload` en este entorno.

## Deploy

2 commits separados (`78d6fe6` costo/kg, `395cc10` avatar+cumpleaños), pusheados a `main`, autorizado por Fausto de antemano ("pusheamos los tres cuando termines de probar"). Variables `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET` cargadas en Railway vía `railway variables --set` (mismo patrón que `SENTRY_DSN` en su momento). Railway corrió la migración sola (confirmado en logs, scheduler arrancó sin errores). `vercel --prod` corrido, build limpio. `eas update --branch production --environment production` — verificado contra el bundle real descargado (URL de Railway presente, sin IP LAN), sin necesidad de build nativo nuevo gracias a la corrección del picker.

## Pendiente real

1. Confirmar con Fausto si ya rotó la contraseña de producción (sigue siendo el único punto del roadmap sin cerrar de esta sesión).
2. Fausto todavía no cargó su propia foto/cumpleaños reales en producción (se probó con datos de prueba en local, no en producción).

## Ver también

- [[Sistema de Gestión Agrícola]]
- [[2026-08-25-tipo-egreso-repuestos-reparacion]]
- [[2026-08-19-clima-termografo-pronostico-extendido]] (rotación de credenciales pendiente, origen del punto 1)
- [[2026-08-11-logging-sentry-tests-idempotencia-router-build-offline]] (incidente original de módulo nativo sin enlazar vía OTA)
