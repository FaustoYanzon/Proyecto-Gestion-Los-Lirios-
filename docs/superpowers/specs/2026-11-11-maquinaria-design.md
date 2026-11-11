# Gestión de Maquinaria — Design

**Fecha:** 2026-11-11 · **Fuente:** `Los Lirios — Sistema de Gestión de Maquinaria.md` (especificación funcional) + decisiones del 2026-11-11.
**Estado:** borrador para aprobación. No hay código escrito.

## 1. Decisiones ya tomadas (Fausto, 2026-11-11)

| # | Decisión |
|---|---|
| 1 | Gerencia y Finanzas son las mismas personas → **no hay rol nuevo**. Aprobar presupuesto y pagar requieren `gerencial` o `super_admin`. |
| 2 | El módulo lo ven **encargado y superiores** (`require_encargado_estricto`). Regador/obrero no. Tractoristas se suman después. |
| 3 | Las máquinas **se mueven entre fincas**; el encargado ve solo las de **su finca**. Gerencial/super_admin ven todas. |
| 4 | Lista real de equipos al final. Ahora: una máquina de prueba (solo local). |
| 5 | Presupuestos y pagos solo en **ARS**. |
| 6 | Varias órdenes abiertas por máquina; el estado de la máquina es el peor entre ellas. |
| 7 | Cancelar solo hasta "Enviada al taller" (inclusive). |
| 8 | Sin tope: todo presupuesto pasa por aprobación. |
| 9 | El pago se registra en el módulo y genera un `Egreso` (mismo patrón que `trabajo_diario`). |
| 10 | El reporte de falla debe funcionar **sin señal**. |
| 11 | ~2 fotos livianas por reporte, con el mismo límite/compresión que el resto. |
| 12 | Delegar a agy las partes mecánicas (ver §8). |

## 2. Supuestos que declaro (corregir si no aplican)

- **A1. Estado de la máquina derivado, no almacenado.** Se calcula desde sus órdenes abiertas; así no se desincroniza. Regla (de más a menos prioritario):
  1. alguna orden en `enviada_taller | en_reparacion | lista_retirar` → **En taller** (azul)
  2. alguna orden abierta con gravedad `parada` → **Parada** (rojo)
  3. cualquier otra orden abierta (incluye `pendiente_validacion`, la máquina ya volvió) → **Operativa con observaciones** (amarillo)
  4. sin órdenes abiertas → **Operativa** (verde)
- **A2. La orden guarda `finca` (snapshot al reportar).** Así el historial y la visibilidad del encargado no cambian si la máquina se traslada después. La máquina tiene `finca` actual, editable por gerencial.
- **A3. Sin tabla `Notificación` en v1.** La línea de tiempo (`maquinaria_orden_eventos`) hace de bandeja; las push usan `core/push.py`. "Leída/no leída" pasa a etapa 2.
- **A4. Una orden = un presupuesto vigente.** Los rechazados quedan en historial; se carga uno nuevo. Un presupuesto `pendiente` a la vez.
- **A5. El pago solo se registra en `lista_retirar`** y una vez por orden. Anular el pago borra el `Egreso` (como en `produccion.py:700/736`).
- **A6. Reabrir** (encargado detecta que quedó mal): desde `pendiente_validacion` vuelve a `en_reparacion`, con motivo obligatorio.

## 3. Modelo de datos (tablas nuevas, IDs `String(36)`)

- `maquinas`: tipo (enum: tractor, cosechadora, enfardadora, implemento), marca, modelo, anio, patente_serie, horas_motor (nullable, etapa 2), `finca` (enum `finca` existente, `create_type=False`), tractor_id (self-FK nullable, implemento→tractor), is_active, timestamps. Foto principal opcional.
- `maquinaria_ordenes`: maquina_id, finca (snapshot), reportada_por (FK users), descripcion, gravedad (enum: `sigue_trabajando | parada`), estado (enum, ver §4), taller (texto), fecha_estimada_entrega, `idempotency_key` (unique, para el reporte offline), timestamps.
- `maquinaria_orden_fotos`: orden_id, url (Cloudinary), subida_por, created_at. Máx. 2 en el reporte (constante configurable; mismo patrón que `FotoRegistroFitosanitario`).
- `maquinaria_presupuestos`: orden_id, taller, monto `Numeric(15,2)` (ARS), detalle, adjunto_url, estado (`pendiente | aprobado | rechazado`), motivo_rechazo, resuelto_por, resuelto_at.
- `maquinaria_pagos`: orden_id (unique), monto_real, factura_url, fecha, registrado_por, `egreso_id`.
- `maquinaria_orden_eventos`: orden_id, estado_desde, estado_hasta, usuario_id, nota, created_at. Base de la línea de tiempo y de "días fuera de servicio".

Migración nueva (skill `nueva-migracion`). Los enums nuevos de Postgres se crean en esa migración. **No** se toca el enum `userrole`. Al aplicar en producción se confirma antes.

## 4. Máquina de estados (servicio puro `app/services/maquinaria.py`)

Estados: `reportada → diagnosticada → presupuesto_pendiente → presupuesto_aprobado → enviada_taller → en_reparacion → lista_retirar → pendiente_validacion → cerrada`. Alternativas: `cancelada`.

| Transición | Quién | Precondición |
|---|---|---|
| (crear) → reportada | encargado+ | máquina de su finca (encargado) |
| reportada → diagnosticada | gerencial+ | taller elegido |
| diagnosticada → presupuesto_pendiente | gerencial+ | se carga presupuesto |
| presupuesto_pendiente → presupuesto_aprobado | gerencial+ | presupuesto `aprobado` |
| presupuesto_pendiente → diagnosticada | gerencial+ | presupuesto `rechazado` con motivo |
| presupuesto_aprobado → enviada_taller | gerencial+ | — |
| enviada_taller → en_reparacion | gerencial+ | — |
| en_reparacion → lista_retirar | gerencial+ | — |
| lista_retirar → pendiente_validacion | gerencial+ | pago registrado |
| pendiente_validacion → cerrada | encargado+ (de la finca) | confirma que funciona |
| pendiente_validacion → en_reparacion | encargado+ | reabrir, motivo obligatorio |
| cualquiera hasta enviada_taller → cancelada | gerencial+ | motivo |

El servicio expone `transicionar(orden, a_estado, usuario, nota)` y una tabla `TRANSICIONES` declarativa. El router solo llama al servicio; el servicio escribe el evento y dispara el aviso. Esto hace testeable la matriz transición × rol.

## 5. API (`backend/app/api/maquinaria.py`, prefijo `/maquinaria`)

Rutas estáticas antes que parametrizadas. CRUD de máquinas (alta/edición solo gerencial+), listado con filtro por finca/tipo/estado derivado, `POST /ordenes` (con `Idempotency-Key`), `GET /ordenes` (encargado: solo su finca), `POST /ordenes/{id}/transicion`, `POST /ordenes/{id}/presupuestos`, `POST /presupuestos/{id}/resolver`, `POST /ordenes/{id}/pago`, `DELETE /ordenes/{id}/pago`, `POST /ordenes/{id}/fotos` (multipart), `GET /maquinas/{id}/historial`. PATCH con `exclude_unset=True`. Sin commit en routers.

## 6. Notificaciones push

Reusar `core/push.py` (`notificar_tokens`, `lanzar_aviso`). Destinatarios: gerencial/super_admin reciben falla reportada, máquina lista para retirar y presupuesto pendiente (son la misma persona que finanzas); el encargado de la finca de la orden recibe cada cambio de estado.

## 7. Web y mobile

- **Web:** pestaña "Maquinaria" en `frontend/lib/navigation.ts` (agrupada como las de Finanzas). Lista con semáforo y filtros, ficha con historial y costos, tablero de órdenes por estado, detalle con línea de tiempo, presupuestos y pago. ABM de máquinas para que Fausto cargue la lista real desde la web.
- **Mobile:** pantallas "Reportar falla", "Mis órdenes" y "Validar recepción". Reporte **offline** con `offlineQueue.ts` (solo JSON, ya soporta `endpoint` + `payload` + idempotencia). Las fotos no viajan en la cola: se guardan por URI local y se suben a `POST /ordenes/{id}/fotos` cuando el reporte sincroniza. **Hay que diseñarlo con cuidado en la implementación.**
- **Riesgo conocido de mobile:** `expo-image-picker` no está en los builds nativos instalados (`mobile/lib/imagePicker.ts`) y el helper actual solo abre la galería. Para fotos desde cámara hace falta permiso de cámara en `app.json` y un build nuevo. Lo que no necesite módulo nativo sale por OTA (con `--environment`, ver `mobile/AGENTS.md`). **A verificar antes de la etapa mobile:** si el último build de Play/TestFlight ya incluye el módulo.

## 8. Etapas y delegación

| Etapa | Qué | Quién |
|---|---|---|
| 1 | Modelo + migración + servicio de estados + router + push | Claude Code (`backend-fastapi`), en rama `feat/maquinaria-backend` |
| 1b | Tests de la matriz transición × rol y de visibilidad por finca | **agy** (mecánico, criterios verificables), tras fijar el servicio |
| 2 | Pantallas web: lista, ficha, tablero, detalle | Claude Code (`frontend-nextjs`); lista y ficha **candidatas a agy** copiando un patrón existente |
| 3 | Mobile: reportar (offline), mis órdenes, validar | Claude Code (`mobile-expo`) |
| 4 | Revisión (`revisar-antes-de-commit`), prueba local con click real, PR, CI, deploy | Claude Code + `release-manager`; Fausto confirma migración en producción |
| 5 | Carga de la lista real de equipos | Fausto, desde el ABM web (con una máquina de prueba solo en local mientras tanto) |

Reglas de agy aplican tal cual (`delegar-a-agy`): worktree aislado, sin shell, diff revisado por mí, commit del humano. No se delega: modelo, migración, servicio de estados, permisos, mobile offline.

## 9. Fuera de alcance (etapa 2 del producto)

Preventivo por horas de motor, combustible/repuestos, indicadores (costo por hora, MTTR), bandeja de notificaciones con leída/no leída, multimoneda.

## 10. Pendiente de confirmar

1. A1–A6 (supuestos de §2).
2. Si el build nativo instalado ya incluye `expo-image-picker` (afecta cuándo salen las fotos en mobile).
3. Dónde guardar este documento final: bóveda `docs/sistema/Decisiones/` una vez aprobado.
