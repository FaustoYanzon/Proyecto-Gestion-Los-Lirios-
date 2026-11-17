# Alfalfa: fardos, rollos y semilla — diseño

Fecha: 2026-11-17 · Estado: borrador para aprobación · Tamaño: proyecto (modelos + migración + endpoints + PDF + web). Paso 3 de la serie paseros → manto → **alfalfa** → anulación (pasa y alfalfa) → mobile.

## Intención
Hoy no existe ningún registro de la alfalfa que se produce en los potreros. Hay que poder dar de alta **fardos, rollos y semilla** por potrero, llevar su stock en un «Depósito Alfa» (ficticio) y sacarlos con un documento de salida a un comprador, con el mismo estilo que el ingreso al pasero y la entrega de pasa.

## Decisiones de Fausto (no re-litigar)
- Fardo = **unidad de 20 kg**; rollo = **unidad de 300 kg**; semilla se da de alta **por kg**.
- Depósito ficticio **«Depósito Alfa»** que muestra los tres tipos.
- **Pestaña nueva en Inventarios** con un documento de **alta** (como el ingreso al pasero) y uno de **salida** (como la entrega de pasa); ambos con **número y PDF**.
- Salida: **primero a comprador**, después «consumo interno» (no en esta versión).
- Cargan **encargado, gerencial y super_admin**. El **potrero de origen es obligatorio** en toda alta (el stock actual se carga con altas de fecha pasada).
- Primera versión **web**; la anulación (solo super_admin) es el paso 4 y mobile el paso 5.

## Goals
- Altas por potrero con varias líneas (fardo, rollo, semilla) y su PDF numerado.
- Stock por producto (unidades y kg) = altas − salidas, visible en la pestaña.
- Salidas a comprador con validación de stock y PDF numerado.
- Constantes de 20 y 300 kg editables como parámetros.

## Non-goals
- Anulación de documentos (paso 4) y mobile (paso 5).
- Salida «consumo interno», precios, trazabilidad por potrero de lo que sale (no se asigna una salida a un potrero ni se aplica FIFO), stock por potrero.
- Reutilizar `Remito` (ver Approaches).

## Constraints
- Tablas, enums, parámetros y depósito se crean con una **migración nueva** encima del head (`alembic heads`); migraciones aplicadas no se editan. Es **aditiva**: no toca datos existentes.
- Producción: Railway corre `alembic upgrade head` al arrancar (hay una ventana corta con código viejo sobre esquema nuevo; en una migración aditiva no afecta). Nada se escribe en producción sin confirmación de Fausto.
- Cantidades y kg con `Decimal`, nunca `float`; la API los serializa como string (`Number()` en el front).
- Convenciones del backend: ids UUID `String(36)`, `flush`+`refresh` sin commit en routers, rutas estáticas antes de las parametrizadas, sin `except` pelado.

## Approaches
1. **Tablas propias + stock derivado (elegida).** `DocumentoAlfalfa` + `DocumentoAlfalfaLinea`; el saldo se calcula como suma de altas menos suma de salidas por producto. Trade-off: duplica un poco la mecánica de numeración y PDF, pero no toca el modelo de pasa y hace trivial el paso 4 (anular = marcar el documento y excluirlo de la suma).
2. Reutilizar `Remito`: obligaría a tocar el check `ck_remito_destinatario_segun_tipo`, el enum `tiporemito`, `PREFIJO_REMITO`, los rótulos del PDF y `RemitoLinea` (solo tiene kg/lote/bin/cosecha), y a meter unidades de fardo y rollo en un modelo pensado para pasa. Descartada.
3. Columna de saldo por producto con bloqueo (como `Lote.saldo_kg`): rápida de leer pero se desincroniza ante errores y complica la anulación. Descartada.

## Diseño
### Modelo (`backend/app/models/alfalfa.py`, registrado en `models/__init__.py`)
- Enums: `TipoDocumentoAlfalfa` (`alta`, `salida`) y `ProductoAlfalfa` (`fardo`, `rollo`, `semilla`).
- `DocumentoAlfalfa` (`documentos_alfalfa`): `id`, `tipo`, `numero` (String 50), `fecha` (Date), `potrero_id` (FK `parcelas`, solo altas), `comprador_id` (FK `compradores`, solo salidas), `deposito_id` (FK `depositos`), `vehiculo_patente` (opcional, salidas), `observaciones` (String 500), `idempotency_key` (String 36, único parcial), `created_by`, `created_at`. `UniqueConstraint(tipo, numero)`. Check: alta ⇒ `potrero_id` NOT NULL y `comprador_id` NULL; salida ⇒ lo inverso.
- `DocumentoAlfalfaLinea` (`documento_alfalfa_lineas`): `id`, `documento_id` (FK, index), `producto`, `cantidad` (Numeric 14,2: unidades para fardo/rollo, kg para semilla), `kg` (Numeric 14,2, **congelado** al crear con los parámetros vigentes). Un producto por documento (sin repetir).
- Parámetros nuevos en `parametros_produccion`: `kg_fardo` (20) y `kg_rollo` (300), junto a `tara_carro`; entran en `PARAMETROS_DEFAULT`, `Parametros`, `ParametrosResponse/Update` y la pantalla Documentación → Parámetros. Cambiarlos **no** reescribe documentos ya cargados.
- Depósito: `DEPOSITO_ALFA = "Depósito Alfa"`. La migración lo siembra (idempotente, por nombre, patrón de `079038232ad0`) y el servicio lo resuelve por nombre y lo crea si falta (tests).

### Reglas (servicio `backend/app/services/alfalfa.py`)
- Numeración automática `ALF-ALT-000001` / `ALF-SAL-000001`: `count+1` por tipo con `pg_advisory_xact_lock` y bucle hasta número libre (copia de `siguiente_numero_remito`). Sin número manual.
- Alta: potrero activo de tipo `potrero`; ≥ 1 línea; fardo/rollo con cantidad entera > 0; semilla kg > 0.
- Salida: comprador existente; cada producto con cantidad ≤ stock disponible, si no **409** con el producto y el saldo; se serializa bloqueando la fila del Depósito Alfa (`with_for_update`).
- `idempotency_key` opcional: un reintento devuelve el documento ya creado.
- `stock_alfalfa(db) -> list[StockProducto]`: por producto, `unidades` y `kg` = altas − salidas.

### API (`backend/app/api/alfalfa.py`, prefijo `/alfalfa`, registrado en `main.py`)
Todas con `require_encargado_estricto` (super_admin, gerencial, encargado). Rutas estáticas primero: `GET /stock`, `GET /documentos` (filtros `tipo`, `fecha_desde`, `fecha_hasta`, `potrero_id`, `comprador_id`, `skip`, `limit`), `POST /documentos`, `GET /documentos/{id}`, `GET /documentos/{id}/pdf` (inline, `Cache-Control: no-store`).

### PDF
`backend/app/core/pdf_alfalfa.py` + `backend/app/templates/alfalfa_documento.html` (xhtml2pdf + Jinja2, estilo y empresa de `remito_entrega.html`): título «Alta de alfalfa» / «Entrega de alfalfa», número, fecha, potrero o comprador (+ patente), tabla producto · cantidad · kg y total de kg. El enlace firmado para mobile queda para el paso 5.

### Web
- `frontend/app/dashboard/inventarios/alfalfa/page.tsx`: tres tarjetas de stock (fardos y rollos en unidades y kg, semilla en kg), botones **+ Alta** y **+ Salida** (modales), tabla de documentos con filtros (tipo, fechas) y botón PDF (patrón `abrirPdf` de `lib/api/altaProduccion.ts`).
- Cliente `frontend/lib/api/alfalfa.ts` (Decimal → `Number()`).
- **Menú por rol** (`frontend/lib/navigation.ts`): los ítems de `SUB_NAVS` ganan `allowedRoles?`; `Inventarios` suma `encargado`; **Insumos** y **Producto Terminado** quedan para `super_admin` y `gerencial`; **Alfalfa** para los tres. Como el encargado no debe aterrizar en Insumos, `Inventarios` apunta a un índice `/dashboard/inventarios` que redirige según el rol (encargado → Alfalfa, el resto → Insumos como hoy). El menú solo oculta: las páginas de Insumos y Producto Terminado siguen dependiendo de la autorización del backend.
- Campos nuevos en Documentación → Parámetros: «kg por fardo» y «kg por rollo».

## A cargo del builder
Textos exactos, estilo de las tarjetas, columnas de la tabla, nombres de queries y estructura de los tests.

## Verificación
- Tests (SQLite en memoria; el depósito se crea al vuelo): alta feliz con tres líneas y kg congelados; stock tras altas y salidas; salida mayor al stock → 409 sin crear nada; cambio del parámetro no toca documentos viejos; cantidad no entera en fardos → 422; producto repetido → 422; alta sin potrero / salida sin comprador → 422; numeración correlativa por tipo; `idempotency_key`; PDF responde `application/pdf` no vacío; roles (regador y obrero → 403).
- Migración probada contra la Postgres **local**: `upgrade`, `downgrade -1`, `upgrade`; el seed del depósito y de los parámetros es idempotente.
- Click real en local (Playwright): alta, salida y PDF; menú de un encargado frente al de un gerencial.
- Despliegue: backend por merge a `main` (Railway migra al arrancar), web con `npx vercel --prod`; sin OTA. Después regenerar `Modelo de Datos.md` y la bitácora.

## Riesgos
- Permisos: el menú del encargado cambia (ve Inventarios, solo con Alfalfa). Las páginas de Insumos y Producto Terminado siguen accesibles por URL directa si el backend no las restringe: revisar los endpoints que consumen antes de publicar.
- Un error de carga no se puede corregir hasta el paso 4 (anulación). Mitigación: la web pide confirmar antes de guardar.
