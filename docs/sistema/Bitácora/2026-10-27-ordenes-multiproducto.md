---
fecha: 2026-10-27
tags: [sistema, bitacora, produccion, fitosanitarios, ordenes-aplicacion, plan]
---

# Bitácora 2026-10-27: órdenes de aplicación multiproducto y multivariedad, con descuento contra el plan

Una orden de aplicación ahora puede llevar varios productos y varias variedades, y cada aplicación confirmada descuenta de la ronda del plan fitosanitario que cubre. Spec: `docs/superpowers/specs/2026-10-27-ordenes-multiproducto-plan-design.md`. Decisión: [[2026-10-27-ordenes-multiproducto]]. Rama `feat/ordenes-multiproducto`, **sin push ni deploy** a la fecha de esta nota. Click-through web y prueba en dispositivo siguen pendientes.

## Qué cambió

- **Modelo y migración:**
  - Tabla nueva `ordenes_aplicacion_insumos` (líneas de producto de la orden: insumo, dosis por ha, unidad).
  - `registros_fitosanitarios` gana `plan_fitosanitario_id`, `orden_insumo_id`, `orden_parcela_id`, `orden_valvula_id` (el vínculo con el plan deja de ser heurístico).
  - Las columnas shim de `ordenes_aplicacion` (insumo, dosis, variedad del producto único) **siguen NOT NULL** y se sincronizan desde la primera línea, para clientes viejos.
  - Las columnas legacy `registro_fitosanitario_id` de parcela/válvula **se conservan**.
- **API:**
  - `POST /ordenes-aplicacion/` unificado con `lineas`; los bodies legacy (un solo producto, `desde-plan`) se siguen aceptando.
  - `PUT` y `DELETE` para todos los orígenes hasta la primera confirmación.
  - 409 si un `PUT` con body legacy llega a una orden con más de una línea (evita perder en silencio las líneas 2..N).
  - Nuevo `GET /plan-fitosanitario/rondas-pendientes`.
  - `cumplimiento` y `necesidad-stock` pasan a medirse por hectáreas.
  - Confirmar crea un registro por línea; Deshacer, Eliminar y Reactivar actúan sobre la válvula (o parcela) completa, con todos sus registros hermanos, fotos incluidas.
- **Backfill:** `scripts/migracion/backfill_plan_registros.py` con `--local` / `--apply`. Sin `--local` lee PRODUCCIÓN; `--apply` pide escribir `SI`. Una sola transacción.
- **Web:** flujo por tarjetas (nueva orden desde una ronda del plan), productos múltiples en listados, barras de cumplimiento por hectáreas, repaso.
- **Mobile:** lista de productos por orden; la cantidad por válvula se calcula con redondeo half-even idéntico al servidor (`mobile/lib/cantidad.ts`, BigInt; un test del backend fija el contrato). `mobile/tsconfig.json` excluye `dist/` (el export web local desbordaba el stack de `tsc`); `tsconfig.json` no entra en el fingerprint, así que el OTA no se ve afectado.

## Decisiones que importan a futuro

- **El redondeo sigue half-even** (default de `Decimal`) en el backend; mobile lo reproduce. Con half-up el operario vería 3,53 donde el stock guardado dice 3,52.
- **La cobertura se mide por hectáreas**, no por cantidad de parcelas. Una parcela con todas sus válvulas activas cubiertas cuenta como completa aunque la suma de superficies de válvulas quede apenas por debajo de `Parcela.superficie_ha`; el porcentaje se limita a 99 si faltan hectáreas y a 1 si hay alguna cubierta.
- **Backfill: los manuales duplicados del mismo día se fusionan** en una sola aplicación (agrupación consciente de los registros ya vinculados a órdenes). Un registro manual con `valvula_id` pero sin `orden_valvula_id` se trata como parcela completa.
- **La clave de tarjeta es el conjunto pendiente de cada variedad**, no la ronda nominal; así una tarjeta desaparece cuando su conjunto se cubre.
- **Los meses se ordenan en orden de campaña** (mayo → abril).
- Si una parcela no tiene variedad, `ValvulaARevisar.variedad` cae a la del shim de la orden.
- La web usa el flag `parcial` (el spec lo llama `completa`).

## Orden de despliegue (checklist)

1. Backup de prod.
2. Probar migración y backfill sobre un dump restaurado: la base local no tenía órdenes de plan ni confirmaciones de parcela completa, así que esas ramas del backfill nunca corrieron con datos reales.
3. Migración en prod con el OK de Fausto, vía `scripts/migracion/_alembic_prod.py`.
4. Deploy del backend (push a `main`; Railway).
5. Backfill contra prod: primero dry-run, luego `--apply` solo con OK explícito.
6. Web: `npx vercel --prod` desde `frontend/` (no auto-despliega).
7. Mobile: OTA con `eas update --branch preview --environment preview`, según `mobile/AGENTS.md`.
8. Click-through en web y en dispositivo (con lista larga de productos: revisar teclado, no hay `KeyboardAvoidingView`).
9. Regenerar `docs/sistema/Modelo de Datos.md` después de migrar prod.
10. Contar `Valvula.superficie_ha IS NULL` en prod antes de mostrar barras por hectárea: una válvula sin superficie suma 0 ha.

## Pendiente post-deploy

- **`Modelo de Datos.md` no se regeneró.** `scripts/generate_modelo_datos.py` lee el esquema de PRODUCCIÓN (vía `scripts/migracion/.env.prod`, solo lectura) y prod todavía no tiene la migración. `PROJECT_MAP.md` sí se regeneró.
- Click-through web y prueba en dispositivo + OTA no hechos.
- Memoria `project_ordenes_multiproducto` y su entrada en `MEMORY.md`: proponer a Fausto, no se tocó.

## Pendientes y limpieza futura

- **Plan de limpieza (otro plan):** migración que elimine las columnas shim de `ordenes_aplicacion`, las `registro_fitosanitario_id` de filas parcela/válvula y los campos shim de las respuestas, cuando no queden builds viejos (revisar Play Console y adopción del OTA).
- El filtro `GET /ordenes-aplicacion/?variedad=` hace OR con la columna shim; sacarlo en la limpieza.
- `OrdenAplicacionInsumo.dosis_por_ha` es `Float`; pasar a `Numeric` en la limpieza.
- Líneas sin deduplicar por `insumo_id` si una variedad repite insumo en una misma ronda; filas duplicadas del plan (misma temporada/variedad/insumo/número) se vuelven rondas sucesivas.
- Body mixto (`lineas` + `insumo_id` de nivel superior): se ignora el de nivel superior en silencio.
- Backfill: un registro de orden con `orden_parcela_id` pero sin `plan_fitosanitario_id` no entra en el mapa de vinculados del día.
- Web: `AplicacionesRealizadas` no usa `apiErrorMessage` en Eliminar/Reactivar (un 422 con lista cae al texto genérico); `NuevaOrdenAplicacion.tsx` (~715 líneas) conviene partirlo; `RegistroFitosanitarioResponse` no expone `orden_valvula_id`; la barra de cumplimiento no se limita a 0-100 y muestra "(+0%)".
- Mobile: `check-cantidad.mjs` pide Node >= 22.18 y no corre en CI; "No aplicada" en una válvula sin superficie sigue rotulando "(cantidad para esta válvula)" con "—".
- Cobertura: `estado` y `parcelas_aplicadas` pueden discrepar cuando hay parcelas sin superficie; la dosis promedio cuenta dos veces los retoques.
- Tooling: `generate_modelo_datos.py` lee prod sin avisar; evaluar un flag explícito o apuntarlo a local por defecto.
