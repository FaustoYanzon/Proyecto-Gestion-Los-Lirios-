---
tags: [sistema, sesion, feature, produccion, pasa, cosecha, remitos, frontend, mobile, ota]
---

# 2026-10-08 — Alta de Producción FASE 2 (pantallas web + mobile OTA)

Continuación de FASE 1 (backend en prod). Objetivo: pantallas web para maestros, alta de cosecha, pasero, lotes y remitos; mobile con tabs Fito y navegación mejorada. Deploy web a Vercel; OTA a mobile runtime 1.0.0.

## Qué se hizo

### Backend (commit ef988a8)
- Extendido `RegistroCosechaResponse` con `saldo_kg` (cálculo real-time via `saldos_cosecha()` en el servicio).
- Agregados `lote_label` y `cosecha_label` a `RemitoLineaResponse` para mejorar trazabilidad en UI.
- Tests: 185 verdes (3 nuevos, todos pasando; nada roto en FASE 1).

### Frontend
- **9 pantallas nuevas** en `frontend/app/dashboard/alta-produccion/`:
  - `pasero` — listado y filtrado de paseros; ingreso de cosecha (báscula, merma)
  - `lotes` — creación y gestión de lotes de pasa (bines, cantidad, variedad)
  - `remitos` — emisión de remitos (entrega de pasa, salida fresco/bodega, comprobante INV)
  - `stock` — visibilidad de stock por pasero y lote
  - `ubicaciones` — maestro de depósitos/bodegas
  - `productores` — maestro de productores (origen de cosecha)
  - `compradores` — maestro de compradores (destino de remito)
  - `depositos` — maestro de almacenes/bodegas
  - `parametros` — tope_bines_lote, merma %, reglas de rechazo (PATCH para futuro)
- **Componente genérico `MaestroCrud`** (Create, Read, Update, Delete) reutilizable en maestros, con validaciones y estados de carga.
- **Lib `frontend/lib/api/altaProduccion.ts`** con endpoints tipados (Cosecha, Pasero, Lote, Remito, Productor, etc.).
- **Navegación mejorada**: submenu SUB_NAV para FASE 2, linkeo de Productor en pantalla de alta de cosecha.
- **Layout responsive** con tabs, tablas y formularios; estilos via Tailwind.

### Mobile (commit 876f208, OTA a runtime 1.0.0)
- **Tareas**: ocultas para `regador` y `obrero` (solo visible a `encargado` y superior).
- **Fito**: separación en dos tabs — Pendientes y Realizadas — para mejorar flujo operario.
- Enviado via `eas update` (fingerprint immutably bound a runtime 1.0.0); descarga automática en app instalada.

## Deploy

### Web (Railway + Vercel)
1. **Backend**: Commit `ef988a8` → push a `main` → Railway desplegó automáticamente. Endpoints accesibles sin cambios en secretos.
2. **Frontend**: Build local (`npm run build`, type-check OK). Ejecutado `vercel --prod` manualmente:
   - URL: `frontend-six-jade-79.vercel.app`
   - **Incidente**: Classifier bloqueó `vercel` desde Claude (proceso de auth token). Fausto ejecutó `!` manualmente desde su sesión.
   - Deployment SUCCESS; live en producción.

### Mobile (OTA)
- Comando: `eas update ... --environment production` (runtime 1.0.0).
- Fingerprint: no cambió (eas.json + runtime constantes).
- OTA llegó a todos los binarios; app recibe auto sin rebuild nativo.

## Lecciones

- **usePaginatedList + useChangedList**: exigen arrays **memoizados** via `useMemo` en frontend/lib/hooks. Sin esto: "Too many re-renders" loop infinito. Causa: `array.filter()` crea ref nueva cada render, hook cree que cambió.
- **inputCls (Tailwind)**: trae `w-full` baked-in; si lo mezclas con flex + ancho fijo (e.g., `w-32`), el `w-full` gana. Solución: selectores específicos o wrapper div.
- **BD local debe estar en HEAD**: Los scripts de generación de docs (generate_modelo_datos.py) leen la BD local vía MCP Postgres. Si la BD local no está up-to-date con las migraciones, genera docs desactualizados. Siempre correr `alembic upgrade head` localmente antes de regenerar.
- **Classifier y vercel auth**: el CLI intenta leer token del env y bloqueado clasificador. Workaround: Fausto corre desde su sesión con `!` (no desde Claude Code). Para futuros deploys, considerar deploy by commit webhook o usar `VERCEL_TOKEN` en Railway secrets + Railway webhook a Vercel.

## Pendiente / próximo paso

### FASE 2 mobile
- Pantallas móviles: alta de cosecha con Productor, pasero, lotes, remitos, maestros.
- Validación: ¿select de cosecha con 190+ opciones de productor? Filtrable o dropdown con search.

### Decisiones abiertas (no progresaron)
- **tope_bines_lote**: parámetro en table `parametros`; qué valor por defecto (hoy NULL).
- **bin a medio llenar**: ¿permitir o rechazar? Regla en validación de cierre de lote.
- **Conciliación remito vs INV**: remito emite INV → ¿automático o manual? Lógica en endpoint `POST /remitos`.
- **Productores duplicados**: `SANCHEZ` vs `SANCHEZ F` vs `MARCELO SANCHEZ`; `HIDALGO` vs `HIDALGO R`. Requiere reunión + revisión manual en producción.

### Sin probar en producción
- Salida **fresco** (remito tipo=bodega+fresco): flujo completo y emisión INV.
- Remito **bodega emitido + INV** (circulante fiscal): validación y estado.
- **Editar maestros** (Productor, Comprador, Depósito) vía PATCH.
- **PATCH parámetros**: cambiar tope_bines o merma % sin redeployar.
- **Crear ubicaciones**: ABM completo de depósitos vía UI.

Tests cubrieron todos estos flows; sin probar en datos reales vivos.

### Próximo
- FASE 3: mobile (repetir pantallas + OTA).
- Raqueo (despalillado) y trazabilidad espacial por productor externo (carritos, zonas).
- Revisión maestros duplicados con Fausto.
