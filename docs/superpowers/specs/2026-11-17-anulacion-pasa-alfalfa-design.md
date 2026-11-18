# Anulación de remitos de pasa y documentos de alfalfa — diseño

Fecha: 2026-11-17 · Estado: borrador para aprobación · Tamaño: proyecto mediano (migración + servicio + endpoints + web). Paso 4 de la serie paseros → manto → alfalfa → **anulación (pasa y alfalfa)** → mobile.

## Intención
Hoy un remito o un documento de alfalfa mal cargado no se puede corregir: no hay anulación ni borrado (decisión de octubre para pasa, consecuencia de la spec de alfalfa). Fausto quiere que **solo el super_admin** pueda anular, y que la anulación **devuelva los saldos** a como estaban. Todavía no hubo errores reales (el sistema aún no entra en uso), así que se hace lo básico y se amplía si hace falta.

## Decisiones de Fausto (no re-litigar)
- Alcance: **remitos de pasa y documentos de alfalfa**. Bines y cierre de lote **quedan afuera**.
- Camino elegido: **marcar el documento como anulado** (no borrar, no contra-documento).
- Solo **super_admin**.
- Esto revierte parcialmente la decisión de octubre «sin anulación de remitos» (`docs/sistema/Decisiones/2026-10-07-alta-de-produccion-fase-1.md`): se registra una decisión nueva que la reemplaza.

## Goals
- Anular un remito `entrega_pasa`, `salida_fresco` o `salida_bodega`, y un documento de alfalfa (alta o salida), con motivo obligatorio y auditoría (quién, cuándo, por qué).
- Los saldos y el stock vuelven al valor previo; el documento sigue visible, con su número, marcado «ANULADO» en listados y PDF.
- No se puede anular dos veces ni dejar el sistema inconsistente (stock negativo).

## Non-goals
- Anular remitos `traslado_pasero` (TRA), bines, ingresos al pasero o el cierre de un lote.
- Editar documentos, «desanular», anulación parcial de líneas, mobile (paso 5).
- Reutilizar el número de un documento anulado (la numeración sigue por conteo e incluye los anulados).

## Constraints
- Migración **nueva** y aditiva sobre el head (`a1fa1fa00001`); no se editan migraciones aplicadas. Producción: backup `pg_dump` antes (`scripts/migracion/backup_prod.py`) y nada se despliega sin confirmación de Fausto.
- Convenciones del backend: UUID `String(36)`, `Decimal`, `flush`+`refresh` sin commit en routers, rutas estáticas antes de las parametrizadas, sin `except` pelado.
- Un documento anulado nunca cuenta en saldos ni en stock; sigue contando para la numeración (`count+1`).

## Approaches
1. **Marcar anulado (elegida).** Columnas `anulado_at`, `anulado_by`, `motivo_anulacion` en el documento; los cálculos de stock excluyen anulados; en entrega de pasa se repone `saldo_kg` y se libera el bin. Trade-off: hay que tocar cada consulta que suma líneas, a cambio de auditoría completa y sin huecos en la numeración.
2. Borrar y revertir: simple, pero pierde el rastro y deja un hueco en la numeración. Descartada.
3. Contra-documento numerado: lo más contable, pero desproporcionado para una finca sin uso real todavía. Descartada.

## Diseño
### Modelo y migración
- `remitos` y `documentos_alfalfa` ganan `anulado_at` (timestamptz, null), `anulado_by` (FK `users`, null) y `motivo_anulacion` (String 500, null). «Anulado» = `anulado_at IS NOT NULL`. Check: los tres campos son todos NULL o todos NOT NULL.
- `remito_lineas.anulada` (Boolean, default false, server default false). El índice único parcial `uq_remito_linea_bin` pasa a `WHERE bin_id IS NOT NULL AND NOT anulada`, para que un bin de un remito anulado pueda entregarse de nuevo. (Decisión mía; el builder puede elegir otro mecanismo si mantiene que el bin quede libre y la línea conserve su bin para auditoría.) La migración recrea el índice; `downgrade` lo restaura.

### Reglas de anulación (servicio nuevo `app/services/anulacion.py`)
- Motivo obligatorio, 5–500 caracteres. Anular algo ya anulado → **409**.
- **entrega_pasa:** bloquea los lotes afectados (orden determinístico, `with_for_update`, igual que la creación), suma `linea.kg` a `lote.saldo_kg`, marca las líneas `anulada=True`. El lote sigue cerrado.
- **salida_fresco:** solo marca remito y líneas (el saldo de cosecha se calcula sumando líneas y excluirá anulados).
- **salida_bodega:** igual, pero **409** si ya tiene `comprobante_bodega`.
- **traslado_pasero:** **409** «no se puede anular» (va atado a un ingreso al pasero).
- **alfalfa salida:** bloquea el Depósito Alfa y marca anulada; siempre permitido.
- **alfalfa alta:** bloquea el Depósito Alfa; si al excluirla el stock de algún producto (unidades o kg) quedaría negativo → **409** con producto y saldo; si no, marca anulada.

### Consultas que excluyen anulados
`saldos_cosecha` y `remitos_por_cosecha` (`services/alta_produccion.py`), la búsqueda de remitos por cosecha en `services/despacho_cosecha.py` (~línea 139), `_entregas_de` en `api/lotes_pasa.py`, `conciliacion-bodega` y el listado de `api/remitos.py`, y `stock_alfalfa` en `services/alfalfa.py`. El builder revisa con grep que no quede otra suma de `RemitoLinea` o de líneas de alfalfa sin filtrar. El chequeo de `api/produccion.py` (~2209, impide borrar una cosecha con líneas) **sigue contando** anulados: la cosecha tiene historia.

### API
Ambas con `require_super_admin`, cuerpo `{motivo: str}`, respuesta = el documento actualizado:
- `POST /remitos/{remito_id}/anular`
- `POST /alfalfa/documentos/{documento_id}/anular`

Los listados y detalles exponen `anulado`, `anulado_at`, `motivo_anulacion`. El listado de remitos y el de alfalfa devuelven anulados (marcados) por defecto; el stock y los saldos, nunca.

### PDF
Remito y documento de alfalfa anulados llevan una marca «ANULADO» visible con fecha y motivo. El PDF de un documento anulado se sigue pudiendo abrir.

### Web
- Botón «Anular» solo para super_admin en `alta-produccion/remitos` y en la tabla de `inventarios/alfalfa`, con modal que pide el motivo y confirma. Muestra el error 409 del backend tal cual.
- Documentos anulados: fila atenuada con etiqueta «Anulado» y el motivo disponible; sin botón de anular. Tras anular se refrescan stock, saldos y listados.

## A cargo del builder
Textos, estilo de la marca en el PDF, nombres de queries/tests, y el mecanismo exacto para liberar el bin (ver Modelo).

## Verificación
- Tests (SQLite): anular entrega repone `saldo_kg` y permite re-entregar el bin; FRE/BOD vuelven el saldo de la cosecha; BOD con comprobante → 409; TRA → 409; doble anulación → 409; motivo vacío/corto → 422; alfalfa salida anulada devuelve stock; alfalfa alta con salidas dependientes → 409 y sin cambios; permisos (gerencial, encargado, regador → 403); anulados siguen ocupando su número; stock y saldos nunca incluyen anulados.
- Migración probada en la Postgres **local**: `upgrade`, `downgrade -1`, `upgrade`.
- Click real en local (Playwright o Chrome): anular una entrega y un documento de alfalfa como super_admin; un gerencial no ve el botón; PDF con marca.
- Despliegue como la alfalfa: backup, push a `main` (Railway migra), `npx vercel --prod`, con confirmación de Fausto en cada paso.

## Riesgos
- Olvidar una consulta que suma líneas dejaría saldos que cuentan documentos anulados; se mitiga con el grep de la sección «Consultas» y un test de regresión por cada una.
- Cambiar el índice único de `remito_lineas` en producción toma un lock breve; la tabla es chica.
