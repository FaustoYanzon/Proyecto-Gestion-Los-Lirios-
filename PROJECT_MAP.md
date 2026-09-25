# PROJECT MAP — Los Lirios Gestión Agrícola
> Auto-generado por `scripts/generate_project_map.py`. Correr de nuevo tras cualquier cambio estructural (modelo/router/migración/pantalla nueva). **No editar a mano.**
> Última generación: 2026-09-24

Para el esquema real de la base de datos (tablas/columnas/FKs/enums), ver `docs/sistema/Modelo de Datos.md` (`scripts/generate_modelo_datos.py`).

---

## System Architecture

```
repo/
├── backend/        FastAPI + PostgreSQL (Python 3.12)
├── frontend/       Next.js + React (TypeScript) — dashboard web
├── mobile/         Expo + React Native (TypeScript) — app de campo
├── scripts/        Scripts de mantenimiento, migración de datos, generadores de docs
└── docs/           Symlinks a la bóveda de Obsidian (C:\Boveda Los Lirios)
```

**Comunicación:** Frontend/Mobile → REST API (FastAPI) → PostgreSQL
**Auth:** JWT (python-jose) + bcrypt. Roles: `super_admin > gerencial > encargado > regador > obrero`
**Campaña:** mayo → abril (NO año calendario)
**Fincas:** `los_mimbres`, `media_agua`, `caucete`

---

## Backend (`backend/`)

**Modelos:** 16 archivos, 33 clases ORM

| Archivo | Clases |
|---|---|
| `alerta_descartada.py` | AlertaDescartada |
| `arca.py` | LoteImportacionArca, ComprobanteArcaImportado |
| `clima_cache.py` | ClimaCache |
| `finanzas.py` | Egreso, Ingreso |
| `insumo.py` | Insumo, MovimientoStock |
| `parcela.py` | Parcela |
| `precio_tarea.py` | PrecioTarea |
| `presupuesto.py` | Presupuesto, MetaProduccion |
| `produccion.py` | RegistroTrabajo, RegistroRiego, RegistroFitosanitario, PlanFitosanitario, OrdenAplicacion, OrdenAplicacionParcela, FotoRegistroFitosanitario, CicloCampana, EstadoVariedadCampana, RegistroCosecha |
| `push_token.py` | PushToken |
| `termografo.py` | LoteImportacionTermografo, LecturaTermografo |
| `trabajador.py` | Trabajador |
| `trazabilidad.py` | Foto, AnalisisCalidad, EnlacePublico |
| `user.py` | User |
| `valvula.py` | Valvula |
| `whatsapp.py` | TelefonoUsuarioWhatsapp, MensajeWhatsappPendiente |

**Routers:** 21

| Archivo | Prefix | Tags |
|---|---|---|
| `alertas.py` | `/alertas` | "alertas" |
| `arca.py` | `/finanzas/arca` | "Finanzas - ARCA" |
| `auth.py` | `/auth` | "Authentication" |
| `clima.py` | `/clima` | "clima" |
| `finanzas.py` | `/finanzas` | "Finanzas" |
| `insumos.py` | `/insumos` | "Insumos" |
| `kpis.py` | `/kpis` | "KPIs" |
| `notificaciones.py` | `/notificaciones` | "notificaciones" |
| `ordenes_aplicacion.py` | `/ordenes-aplicacion` | "Ordenes Aplicacion" |
| `parcelas.py` | `/parcelas` | "Parcelas" |
| `plan_fitosanitario.py` | `/plan-fitosanitario` | "Plan Fitosanitario" |
| `precios_tarea.py` | `/precios-tarea` | "Precios Tarea" |
| `presupuestos.py` | `/presupuestos` | "Presupuestos" |
| `produccion.py` | `/produccion` | "Produccion" |
| `telefonos_whatsapp.py` | `/admin/telefonos-whatsapp` | "Admin - Teléfonos WhatsApp" |
| `termografo.py` | `/produccion/termografo` | "Producción - Termógrafo" |
| `trabajadores.py` | `/trabajadores` | "Trabajadores" |
| `trazabilidad.py` | `/trazabilidad` | "Trazabilidad" |
| `users.py` | `/users` | "Users" |
| `whatsapp.py` | `/finanzas/whatsapp` | "Finanzas - WhatsApp" |
| `whatsapp_webhook.py` | `/whatsapp` | "WhatsApp Webhook" |

**Migraciones de Alembic:** 42 (head: `a106b068b59a_agregar_origen_y_proveedor_tercero_a_.py`)

**Reglas críticas:**
- Todos los IDs son UUID strings (`String(36)`), nunca int
- `await db.flush()` + `await db.refresh(obj)` tras escrituras — nunca commit en routers
- PATCH: `model_dump(exclude_unset=True)`
- Plata/cantidades: `Decimal`, nunca `float`
- Sub-rutas estáticas ANTES que parametrizadas (`/resumen/por-tipo` antes de `/{id}`)

---

## Frontend (`frontend/`)

**Rutas (39):**

- `/dashboard/admin/notificaciones`
- `/dashboard/admin/usuarios`
- `/dashboard/admin/whatsapp`
- `/dashboard/documentacion/empresa`
- `/dashboard/documentacion/fenologia`
- `/dashboard/documentacion/melgas`
- `/dashboard/documentacion/parcelas`
- `/dashboard/documentacion/precios`
- `/dashboard/documentacion/riego`
- `/dashboard/documentacion/trabajadores`
- `/dashboard/finanzas/a-pagar`
- `/dashboard/finanzas/cheques`
- `/dashboard/finanzas/dashboard`
- `/dashboard/finanzas/egresos`
- `/dashboard/finanzas/flujo/desglose/[tipo]`
- `/dashboard/finanzas/flujo`
- `/dashboard/finanzas/ingresos`
- `/dashboard/finanzas/mano-de-obra`
- `/dashboard/finanzas/presupuesto`
- `/dashboard/inventarios/insumos`
- `/dashboard/inventarios/producto-terminado`
- `/dashboard/mapa`
- `/dashboard`
- `/dashboard/produccion/campana`
- `/dashboard/produccion/clima`
- `/dashboard/produccion/cosecha`
- `/dashboard/produccion/cumplimiento-fitosanitario`
- `/dashboard/produccion/dashboard`
- `/dashboard/produccion/fitosanitarios`
- `/dashboard/produccion/metas`
- `/dashboard/produccion/ordenes-aplicacion`
- `/dashboard/produccion/plan-fitosanitario`
- `/dashboard/produccion/riego`
- `/dashboard/produccion/tareas`
- `/dashboard/trazabilidad`
- `/login`
- `/`
- `/privacy`
- `/trazabilidad/publica/[token]`

**Módulos de API client** (`frontend/lib/api/`, 25): `alertas.ts` · `arca.ts` · `clima.ts` · `cosecha.ts` · `egresos.ts` · `fitosanitarios.ts` · `flujo.ts` · `ingresos.ts` · `insumos.ts` · `kpis.ts` · `metas.ts` · `notificaciones.ts` · `ordenesAplicacion.ts` · `parcelas.ts` · `planFitosanitario.ts` · `preciosTarea.ts` · `presupuestos.ts` · `produccion.ts` · `riego.ts` · `telefonosWhatsapp.ts` · `termografo.ts` · `trabajadores.ts` · `trazabilidad.ts` · `usuarios.ts` · `whatsapp.ts`

**Componentes por carpeta:**

- `finanzas/`: ComprobantesArcaPanel.tsx · EgresoForm.tsx · EgresosTable.tsx · IngresoForm.tsx · IngresosTable.tsx · MensajesWhatsappTable.tsx · MesRangeQuickButtons.tsx
- `landing/`: Reveal.tsx · VarietyMap.tsx
- `map/`: FincaMap.tsx · FincaMapInner.tsx · LayerControl.tsx
- `produccion/`: FitosanitarioForm.tsx · FitosanitariosTable.tsx · IniciarRiegoForm.tsx · InsumoSelect.tsx · PronosticoExtendidoPanel.tsx · RiegoForm.tsx · RiegoTable.tsx · RiegosEnCurso.tsx · TareaForm.tsx · TareasTable.tsx · TermografoPanel.tsx · TrabajadorSelect.tsx
- `trazabilidad/`: AnalisisForm.tsx · AnalisisList.tsx · ComplianceBanner.tsx · DestinoResumen.tsx · EnlacesPublicos.tsx · FotoAlbum.tsx · FotoForm.tsx · ParcelaHeader.tsx · RiegoPorEstado.tsx · Timeline.tsx
- `ui/`: Badge.tsx · EmptyState.tsx · FormError.tsx

---

## Mobile (`mobile/`)

**Pantallas (11):**

- `(auth)/login.tsx`
- `(tabs)/campana.tsx`
- `(tabs)/cosecha.tsx`
- `(tabs)/fitosanitario.tsx`
- `(tabs)/index.tsx`
- `(tabs)/mapa.tsx`
- `(tabs)/perfil.tsx`
- `(tabs)/riego.tsx`
- `(tabs)/tareas.tsx`
- `estado-campana.tsx`
- `fito.tsx`

---

## Scripts de migración de datos (`scripts/migracion/`)

Ver `scripts/migracion/README.md` para el detalle de cada migración corrida (cobertura, decisiones, verificación). Scripts actuales:

- `_alembic_prod.py`
- `_audit_jornales_historicos.py`
- `backfill_egresos_abril.py`
- `backfill_egresos_mayo_agosto_2025.py`
- `cleanup_contaminacion_jornales_hist.py`
- `migrate_bd_cobros.py`
- `migrate_cosecha_2024_2026.py`
- `migrate_excels.py`
- `migrate_jornales.py`
- `migrate_jornales_gap_sep25_mar26.py`
- `migrate_jornales_historicos.py`

---

## Conocimiento del proyecto (bóveda de Obsidian)

Symlinkeada en `docs/` — leer el archivo relevante antes de trabajar en esa área:

- `docs/sistema/` → `01 - Sistema`: Arquitectura, Modelo de Datos, Bugs Conocidos, Stack Técnico, Bitácora, Decisiones
- `docs/finanzas/` → `02 - Finanzas`: Cuentas por Pagar, Flujo de Caja, Presupuesto Anual
- `docs/produccion/` → `03 - Producción`: Parcelas y Fincas, Tareas Clasificadas, Campañas
- `docs/proyectos/` → `05 - Proyectos`: Dashboards, Sistema de Gestión Agrícola, otros proyectos

---

## DO NOT TOUCH
- `backend/.env`, `mobile/.env`
- `backend/app/core/migrations/versions/` (salvo para crear una migración nueva)
- Migraciones de Alembic ya commiteadas
