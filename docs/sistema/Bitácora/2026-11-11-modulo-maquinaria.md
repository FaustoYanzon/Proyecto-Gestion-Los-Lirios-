---
fecha: 2026-11-11
tags: [sistema, bitacora, maquinaria, finanzas, mobile, deploy]
---

# Bitácora 2026-11-11: módulo de Maquinaria (rama `feat/maquinaria-backend`)

Módulo nuevo de gestión de maquinaria: alta de equipos, reporte de falla desde el campo (también sin señal), presupuestos con aprobación, pago que genera un `Egreso` y cierre validado por el encargado. Spec: `docs/superpowers/specs/2026-11-11-maquinaria-design.md`. Decisión: [[2026-11-11-modulo-maquinaria]]. Proyecto: `docs/proyectos/Sistema de Gestión de Maquinaria.md`.

**Nada desplegado.** La migración `60332c8268d5` no está aplicada en producción. El orden de deploy está al final.

## Qué se construyó

- **Backend** (commit `92a04c2` y siguientes):
  - Modelos en `backend/app/models/maquinaria.py`: `Maquina`, `OrdenMaquinaria`, `FotoOrdenMaquinaria`, `PresupuestoMaquinaria`, `PagoMaquinaria`, `EventoOrdenMaquinaria`.
  - Máquina de estados como servicio puro en `backend/app/services/maquinaria.py` (tabla `TRANSICIONES` declarativa). El router solo llama al servicio.
  - API en `backend/app/api/maquinaria.py`, prefijo `/maquinaria`.
  - Push por `core/push.py`.
- **Web** (commit `7ddeba1` como última pasada: montos con centavos, año separado y drawers con portal a body): lista de máquinas, tablero de órdenes y detalle con línea de tiempo, presupuestos y pago (`frontend/app/dashboard/maquinaria/`, `frontend/components/maquinaria/`).
- **Mobile** (commits `3240596`, `d1095f3`, `8237360`):
  - Cliente de API espejo reducido del web.
  - Flota por finca, reporte de falla con cola offline, detalle de orden.
  - Pin en el header que abre la hoja «Finca y módulos» (el selector de finca se movió ahí desde el drawer de perfil).
  - Aviso en Inicio.
  - Tap en la push abre la orden; doble envío y reintento ante errores transitorios de la pasarela de red (408/429/502/503/504, p. ej. un reinicio de Railway) cubiertos para los reportes de maquinaria.

## Qué se verificó

- **Backend:** pytest completo en verde (592 tests en la última corrida completa, que incluye el módulo con 51 tests propios). Aparte, 27 casos de la matriz transición × rol (escritos por agy, corridos por separado) y 1 test posterior de nombres en eventos, corrido solo con el módulo (52 passed).
- **Web:** `npm run lint` y `npm run build` OK.
- **Web, click real en local:** flujo completo de punta a punta (reporte, diagnóstico, presupuesto, aprobación, taller, pago, validación). Vistas por rol comprobadas por API. Egreso creado al registrar el pago.
- **Mobile:** solo `npx tsc --noEmit`. **No se probó en dispositivo.**

## Qué NO está hecho o no está verificado

- **Fotos:** la subida no se probó en el navegador. Mobile solo permite galería.
- **Cámara:** no soportada todavía. `expo-image-picker` no tiene config plugin en `app.json`, así que la cámara necesita build nativo nuevo (Play y TestFlight). Lo que no sea nativo sale por OTA.
- **Ficha de máquina, edición y baja:** diferidas hasta que el encargado entregue la ficha técnica.
- **Carga de la flota real:** pendiente. Hoy solo hay una máquina de prueba, y solo en local.
- **Cola offline (limitación preexistente):** los items fallidos de `offlineQueue` no se pueden reintentar ni descartar desde la app.
- **Drawer con z-index/portal:** resuelto en maquinaria (portal a body, `7ddeba1`). El `Sheet` de `frontend/app/dashboard/finanzas/ingresos/page.tsx` tiene el mismo problema y sigue sin corregir.
- **Asignación de finca en teléfonos compartidos (preexistente):** `loadFinca` puede pisar la finca asignada a un encargado si el teléfono lo usa más de uno.
- **Caucete:** no se ofrece como finca para registros nuevos (decisión de Fausto).

## Docs

- `PROJECT_MAP.md` regenerado (17 modelos, 26 routers, 64 migraciones, 54 rutas frontend, 18 pantallas mobile).
- `Modelo de Datos.md` **no se regeneró**, a propósito: `generate_modelo_datos.py` lee el esquema de **producción**, y la migración de maquinaria todavía no está allí. Regenerar después del deploy de la migración.
- `Arquitectura.md`: fila nueva en la tabla de rutas API y sección corta de Maquinaria.
- `docs/superpowers/specs/2026-11-11-maquinaria-design.md`: el estado decía «borrador, no hay código escrito»; se actualizó para apuntar a la decisión y a la rama.
- Ningún doc de `Decisiones/` ni `Bugs Conocidos.md` queda contradicho por esta sesión. No se agregaron entradas a `Bugs Conocidos.md`: los puntos preexistentes quedan listados arriba.

## Orden de deploy (pendiente, no ejecutado)

1. Mergear la rama `feat/maquinaria-backend` (HEAD `7ddeba1`) a `main`.
2. **Migración `60332c8268d5` en producción:** requiere confirmación explícita de Fausto. Backup previo con `pg_dump`.
3. Backend a Railway (auto-deploy al push a `main`). Verificar logs con `npx @railway/cli logs`.
4. Web a Vercel: deploy manual con `npx vercel --prod` tras verificar.
5. Mobile por OTA (runtime `1.0.0`): correr `fingerprint:compare` primero; si el fingerprint no coincide con los builds vigentes, el OTA no sirve y hace falta build nuevo. Después `npx eas update --branch production --environment production`, y verificar el bundle publicado según `mobile/AGENTS.md` (URL de Railway de producción presente, sin `192.168.x.x`).
6. Regenerar `docs/sistema/Modelo de Datos.md` contra producción después de aplicar la migración.
7. Cargar la lista real de equipos desde el ABM web.

## Abiertos

- Probar en dispositivo la hoja «Finca y módulos», el reporte sin señal y el tap de la push.
- Decidir cuándo se suman los tractoristas como reportantes (`require_encargado_estricto` hoy).
- Ficha de máquina y edición/baja, cuando llegue la ficha técnica.
- Cámara en mobile (build nativo con `expo-image-picker`).

## Actualización 2026-11-12: numeración, iconos, historial y filtro por finca

- **Órdenes con número:** `maquinaria_ordenes.numero` (secuencia Postgres `maquinaria_orden_numero_seq`, se muestra `OM-0012`). Migración `07acdb0d401f` (backfill por `created_at, id`, luego NOT NULL + UNIQUE). Filtro `GET /maquinaria/ordenes?numero=`.
- **Icono de máquina:** `maquinas.icono` (tractor / carro / implemento), se elige al alta; si es null se deriva del `tipo` (cosechadora y enfardadora → carro). Web y mobile.
- **Historial por temporada:** `GET /maquinaria/maquinas/{id}/historial?temporada=`. Campaña mayo→abril con corte a medianoche de Argentina (UTC-3, sin horario de verano). El costo solo lo ve gerencial+.
- **Web:** pestaña Órdenes como lista vertical con estado, 9 pasos de avance, filtro Pendientes/Terminadas y detalle desplegable; historial en la ficha de la máquina.
- **Mobile (UX):** selector de finca y campaña fija en el header, racimo abre el menú de módulos (drawer desde la izquierda), perfil desde la derecha, formularios de tareas/riego como los de cosecha (`FormModal`), sin "(tabs)" en el botón de volver. Gerencial ve todas las máquinas con etiqueta de finca.
- **Filtro por finca (mobile):** estricto. Todas las parcelas son de Media Agua (Los Mimbres sin parcelas cargadas; Caucete ya no es finca, solo queda el valor en el enum por datos históricos). Script `scripts/migracion/asignar_finca_parcelas.py`: aplicado en local; en producción ya estaban las 37 parcelas con finca (dry run 2026-11-12), nada que aplicar.
- **Deploy:** ahora son dos migraciones pendientes en producción: `60332c8268d5` y luego `07acdb0d401f`. Cargar la flota real sigue pospuesto.
