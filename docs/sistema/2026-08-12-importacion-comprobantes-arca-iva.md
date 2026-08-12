---
tags: [sistema, sesion]
---

# 2026-08-12 — Importación de comprobantes ARCA → Egresos/Ingresos + IVA compra/venta/saldo

Feature nueva grande, pedida por Fausto para automatizar la carga de gastos/ingresos oficiales (los "en negro" se van a cubrir después con un chatbot aparte, fuera de esta sesión). Planeada en modo plan formal, ejecutada completa en la misma sesión.

## El pedido original

Dos veces al mes (mitad y fin de mes) Fausto baja de ARCA (ex-AFIP) dos CSV de "Mis Comprobantes": recibidos (compras) y emitidos (ventas). Quería que cada fila apareciera en el sistema como un comprobante pendiente de clasificar (tipo/clasificación/finca/forma de pago), y que el IVA de cada uno se sumara para mostrar IVA compra/venta/saldo en el dashboard.

## Análisis crítico antes de diseñar

Se analizaron los 2 CSV reales de julio de Fausto. Dos problemas que su planteo original no contemplaba:
- **ARCA no informa forma de pago** en ningún campo — decidido con Fausto: la elige él al clasificar cada fila.
- **Hay notas de crédito mezcladas con facturas** en su propio archivo (tipo de comprobante 3, 8, 13, etc. según la tabla oficial AFIP) — deben restar, no sumar, tanto en el IVA como en el monto del Egreso/Ingreso resultante.

También se cuestionó la idea de subir los CSV a una carpeta de Google Drive (propuesta original de Fausto) — se le explicó que agregaba complejidad innecesaria (credenciales de service account, polling) sin necesidad, dado que ya usa la app web todos los días. Aceptó un botón de "Importar CSV" directo en la app.

## Decisiones de diseño

- **IVA por mes calendario, no quincena** — así se declara en Argentina; las dos subidas de mitad/fin de mes solo reparten el trabajo de clasificar.
- **El IVA se calcula sobre TODOS los comprobantes importados no descartados**, sin importar si ya se clasificaron en Egreso/Ingreso — es un hecho fiscal del comprobante, no depende del costeo interno.
- **Notas de crédito**: restan automático (monto negativo en el Egreso/Ingreso resultante, sin cambio de schema).
- Permisos: `require_gerencial_up`, igual que el resto de `finanzas.py`.

## Modelo de datos

Dos tablas nuevas en `backend/app/models/arca.py`: `LoteImportacionArca` (historial de cada subida) y `ComprobanteArcaImportado` (staging, un row por comprobante del CSV, separado de `Egreso`/`Ingreso` para no ensuciarlos con campos de ARCA). Índice único natural `(tipo_archivo, tipo_comprobante, punto_venta, numero_desde, cuit_contraparte)` evita duplicar si se reimporta el mismo CSV. Al clasificar, se crea el `Egreso`/`Ingreso` real con `fuente='arca_csv'` — campo que ya existía en `Egreso` (sin usar hasta ahora) y se agregó a `Ingreso` por primera vez para el mismo filtro.

## Backend

- `backend/app/core/arca_import.py`: parser puro con la tabla oficial de tipos de comprobante AFIP (código → descripción + si es nota de crédito). Un código desconocido se reporta como error explícito en vez de adivinar el signo — proteger la integridad del IVA importaba más que importar todo a cualquier costo.
- 3 migraciones aditivas: tablas ARCA, `fuente` en `ingresos`, vista `vw_kpi_iva` (mismo patrón que `kpis.py`, neteando notas de crédito).
- Router nuevo `backend/app/api/arca.py` (`/finanzas/arca/importar`, `/pendientes`, `/lotes`, `/{id}/clasificar-egreso`, `/{id}/clasificar-ingreso`, `/{id}/descartar`, `/resumen-iva`).
- **Registrado correctamente en `main.py` y en `app/models/__init__.py`** siguiendo el checklist aprendido del bug del router de clima (08-10) — de hecho `test_router_registration.py` (escrito la noche anterior) corrió limpio con el router nuevo, primera vez que demostró su utilidad real en la práctica.
- 37/37 tests backend pasando (10 nuevos: parser con nota de crédito/USD/código desconocido, importación con dedupe, clasificar con signo correcto, rechazo de tipo_archivo cruzado).

## Frontend

Primera subida de archivo de todo el repo (confirmado que no había ningún precedente) — `FormData` + multipart contra la instancia `api` existente. `ComprobantesArcaPanel.tsx` (banner + modal de pendientes reusando `BuzonModal.tsx`, clasificación inline por fila) agregado a Egresos e Ingresos. 3 KPI cards de IVA en el dashboard de finanzas. Recordatorio de quincena sin importar sumado al panel de Alertas existente (`derivarAlertas()` en `Alertas.tsx`) — puro cálculo de fecha (día ≥18 sin lote de la primera quincena, día ≤3 sin lote de la segunda), sin scheduler nuevo. Type-check limpio.

## Verificación end-to-end con los CSV reales de julio

43 comprobantes recibidos + 3 emitidos importados contra Postgres local; reimportar el mismo archivo dio 0 nuevos / 43 duplicados (dedupe funciona); `resumen-iva` dio exactamente el mismo número que el cálculo manual del parser (IVA compra $12.993.032,87, IVA venta $13.184.705,10, saldo $191.672,23 a pagar); se clasificó una factura normal (monto positivo), una nota de crédito (monto negativo) y un comprobante emitido como Ingreso (`estado=facturado`, comprador prefilado desde ARCA) — todos con los valores esperados. Usuario y datos de verificación borrados de la DB local al terminar.

## Deploy

Commit `04a3eae` pusheado a `main`. Railway va a correr las 3 migraciones nuevas solas en el próximo deploy. **Pendiente que haga Fausto:** `vercel --prod` para que el frontend llegue a producción (Vercel no auto-despliega en este proyecto).

## Follow-up mismo día: bugs reales encontrados por Fausto probando en producción

- **Fecha en formato D/M/YYYY sin ceros** (`"1/7/2026"`) — el archivo real de ARCA en producción no usa ISO como el archivo de muestra que se había analizado. 43/43 filas del CSV de julio fallaban al importar. Parser corregido para aceptar ambos formatos (`_parse_fecha`), más filas en blanco al final del export que se saltean en silencio en vez de contar como error.
- **No había forma de deshacer un descarte** — Fausto descartó comprobantes de prueba (julio y agosto) y no podía reimportarlos (el índice único de dedupe lo bloqueaba). Agregado: vista "Ver descartados" con botón **Restaurar** (vuelve a pendiente) y botón **Borrar** (definitivo — a diferencia de descartar, borrar libera la clave natural, así que reimportar el mismo CSV más adelante sí puede traer ese comprobante de nuevo como nuevo).
- **`$NaN` en el total ARS de Egresos** — bug preexistente a esta sesión (la API serializa `Decimal` como string en el JSON; sumar strings con `+` concatena en vez de sumar numéricamente), recién visible ahora que había 2+ egresos ARS reales cargados a la vez. Corregido en `EgresosTable.tsx`, `IngresosTable.tsx` y `cheques/page.tsx` (mismo patrón en los tres).
- **Datos de prueba borrados de producción a pedido de Fausto**, para arrancar de cero con "el ingeniero": 17 comprobantes descartados (14 recibidos + 3 emitidos, julio+agosto) + 6 lotes de importación. Confirmado antes de borrar que ninguno había generado un `Egreso`/`Ingreso` real (`fuente='arca_csv'` daba 0 filas en ambas tablas) — el borrado no tocó ningún dato financiero real.
- Commits: `00da76a` (fecha), `38858e6` (restaurar + NaN), `f753702` (borrar definitivo). Todos pusheados y desplegados (Railway auto + `vercel --prod` x3 durante el follow-up).

## Pendiente para más adelante (no bloqueante)

- El chatbot para gastos no oficiales ("en negro") sigue como visión a futuro, no iniciado.
- `SENTRY_DSN` todavía no está seteado en las env vars de Railway (pendiente desde la sesión del 08-11) — el código está listo, solo falta que Fausto lo agregue a mano en el dashboard.

## Ver también

- [[2026-08-11-logging-sentry-tests-idempotencia-router-build-offline]]
- [[Sistema de Gestión Agrícola]]
