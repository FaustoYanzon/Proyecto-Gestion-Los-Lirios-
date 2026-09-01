---
tags: [sistema, sesion, deploy, playstore, ios, bug]
---

# 2026-08-28 — Camino a producción en Play Store, arranque de iOS, fix de permisos de parcelas

Continuación de la sesión del rediseño estético (ver [[2026-08-28-estetica-v1-rediseno-web-mobile]]). Fausto pidió avanzar hacia sacar la app de "Internal testing" y publicarla en Producción de Play Store (para que los regadores la descarguen sin necesitar el link de opt-in), y arrancar en paralelo la publicación en iOS.

## Play Store — requisito real de Google, verificado en vivo en Play Console

Antes de armar un plan se entró a Play Console (Claude in Chrome) a confirmar el requisito real en vez de asumirlo de memoria. Confirmado: **Producción está inactiva**, y Google exige a las cuentas de desarrollador personales (la de Fausto lo es) desde 2023:

1. Publicar una versión en **Prueba cerrada** (Closed testing).
2. Tener al menos **12 verificadores** que acepten participar — al arrancar la sesión: 0 (la lista de Prueba interna solo tenía 3 emails).
3. Correr la prueba cerrada con esos 12+ durante **mínimo 14 días corridos**.

Fausto confirmó que puede juntar 12 personas (familia/amigos/trabajadores, cada uno con su Gmail) sin problema.

### Trabajo hecho en Play Console

- Activado el segmento "Prueba cerrada - Alpha" (existía, creado por Google por default, nunca usado).
- Argentina agregada como país disponible.
- Lista de verificadores nueva ("Verificadores prueba cerrada") con los 3 emails que ya se conocían de Prueba interna, como punto de partida.
- Build ya existente (versión 4, 1.0.0 — el mismo publicado en Internal testing desde agosto) promovido al segmento sin necesitar compilar de nuevo, para arrancar el reloj de 14 días el mismo día.
- Enviado a revisión de Google (revisión de prueba cerrada es rápida, horas — no confundir con la revisión larga de Producción).

**Link de opt-in real, para que Fausto se lo mande a sus 12 personas:** `https://play.google.com/apps/testing/com.loslirios.app`

### Pendiente real

1. Fausto manda el link a 12 personas reales, esperan a que todas acepten.
2. Pasan 14 días corridos con los 12+ aceptados.
3. Se solicita "Acceso a producción" en Play Console (botón que hoy está bloqueado, se habilita solo).
4. **Antes de pedir producción, conviene ya tener el build nuevo con `react-native-svg`** (íconos de la Fase 2 del rediseño, ver [[2026-08-28-estetica-v1-rediseno-web-mobile]]) — buen momento para juntar el build de iconos con el paso a producción, evita publicar dos veces seguidas.

## iOS — arranque

Fausto ya tiene Apple ID propio (no hace falta crearlo de cero). Decisión tomada: cuenta de **Apple Developer Individual** (no Organization) — mucho más rápida (sin D-U-N-S ni verificación de empresa, que puede tardar 1-2 semanas), aparece "Fausto Yanzon" como developer en vez de "Los Lirios SA". EAS Build puede compilar el binario iOS en la nube sin necesitar una Mac.

**Pendiente real, explícitamente pospuesto por Fausto:** inscribirse en developer.apple.com/programs/enroll (USD 99/año, tarjeta propia — no es algo que se pueda hacer por él). Cuando esté activa, retomar con la configuración de EAS credentials + App Store Connect (la ficha va a poder reusar gran parte del contenido ya escrito para Play Store).

## Bug real encontrado y arreglado: selector de "Ubicación" vacío para encargado/regador (web)

Fausto reportó, con captura: el encargado, al cargar una tarea nueva desde la web, solo veía "General (sin parcela)" en el selector de Ubicación — ninguna parcela real aparecía. En la tabla de tareas, una fila mostraba un UUID crudo en vez de un nombre de parcela. Reportó también que varias tareas del 26/8 habían caído en "General".

### Causa raíz, confirmada en el backend

`GET /parcelas/` (el endpoint que llena ese selector) exigía `require_gerencial_up` — solo gerencial/super_admin podían leerlo. Encargado y regador sacaban un 403 silencioso, así que `TareaForm.tsx` (que recibe `parcelas` como prop, ya vacío por el 403) solo podía mostrar la opción por defecto. El mismo patrón rompe también Cosecha, Fitosanitarios y Riego web (los 5 usan la misma función `getParcelas()`), aunque el reporte llegó solo por Tareas.

**Por qué no protegía nada real:** el endpoint hermano `/parcelas/mapa` ya expone los mismos datos (y más — incluye `coordenadas`) a **cualquier** rol autenticado. Era una inconsistencia de una sesión anterior, no una decisión de seguridad.

**Fix:** el permiso bajó a `require_encargado_up` (encargado, regador, gerencial, super_admin) — el mismo grupo que ya puede crear tareas/riego/fito/cosecha (`require_encargado_up` en esos 5 endpoints de creación, confirmado en código). Los endpoints de administrar parcelas (crear/editar/desactivar) siguen exclusivos de gerencial+, no se tocaron.

**Verificado en local, no solo leído:** se creó un usuario de prueba con rol `encargado` (`qa-encargado-temp`), se confirmó 403→200 con 36 parcelas reales después del fix, se confirmó que `super_admin` sigue funcionando igual (sin regresión), y se borró el usuario de prueba sin dejar rastro. De paso se encontró (y se mató) el mismo bug de procesos zombie de `uvicorn --reload` en Windows ya documentado — ver [[Bugs Conocidos]].

**Sobre el historial del 26/8 en mobile:** mobile usa `/parcelas/mapa` (nunca tuvo este problema de permisos), así que ese bug puntual no explicaría el mismo síntoma en mobile — sospecha de que fue simplemente el encargado dejando "General" sin elegir mientras cargaba rápido, no el mismo bug. **Decisión de Fausto: no reasignar esos registros históricos, alcanza con que funcione bien de acá en adelante.**

## Incidente real de Railway, no nuestro — deploy del fix trabado

Al pushear el fix (`ce971a6`), el deploy quedó trabado en Railway: primero en "Building" con `stopped:true`, después un segundo intento manual (`railway up`) también trabado en "Initializing". Se probó `redeploy` (rechazado, "no se puede redesplegar mientras está building") y `railway up` (mismo resultado). `status.railway.com` decía "Fully Operational" en el resumen general, pero Fausto entró directo a la página de status y encontró el incidente real, activo, no reflejado todavía en el resumen: **"Investigating — deployments taking longer than normal to initialize"**, las 4 regiones (US East, US West, EU West, Southeast Asia) — mismo patrón que el incidente del 18/8 ([[2026-08-18-fix-totales-egresos-tareas-dashboards-por-rango]]), que en su momento tampoco aparecía de entrada en el resumen del status page.

**Importante: no hubo caída.** La versión anterior (sin este fix) siguió online y sirviendo todo el tiempo — el único efecto es que el encargado sigue viendo el bug de Ubicación hasta que el deploy se destrabe solo cuando Railway resuelva su incidente.

## Ver también

- [[2026-08-28-estetica-v1-rediseno-web-mobile]]
- [[Sistema de Gestión Agrícola]]
- [[Bugs Conocidos]]
- [[Play Store — checklist de publicación]]
- [[2026-08-18-fix-totales-egresos-tareas-dashboards-por-rango]] (incidente de Railway anterior, mismo patrón)
