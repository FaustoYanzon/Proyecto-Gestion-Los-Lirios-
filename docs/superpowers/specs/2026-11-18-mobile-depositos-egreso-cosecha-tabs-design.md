# Mobile: pestañas en Depósitos y Cosecha, y egreso de insumos — diseño corto

Fecha: 2026-11-18 · Estado: aprobado e implementado en feat/mobile-depositos (sin desplegar) · Tamaño: cambio mediano (1 migración + endpoint en backend, y app Expo por OTA). Continúa `2026-11-18-mobile-depositos-design.md`.

## Intención
Fausto probó Depósitos y quiere (1) ver un depósito a la vez, (2) registrar **salidas** de insumos varios (combustible, aceite, etc.) con la misma facilidad que los ingresos, y (3) ordenar Cosecha por tipo de producto. Además cargó el motivo por el que no veía los polígonos del mapa: era solo la base local (ya corregido, sin cambio de código).

## Goals
- **Depósitos con pestañas**: Fitosanitarios | Insumos varios | Paseros | Bodega | Alfalfa, una visible a la vez.
- **Egreso de insumos** (salida manual): quién, cuánto, cuándo y **dónde se usó** (máquina, tractor o parcela, en texto libre por ahora).
- Ingreso y egreso accesibles desde **Depósitos** y desde **Inicio** (acciones rápidas).
- **Cosecha con pestañas** que separan los tipos de registro.

## Non-goals
- Atar el egreso a una máquina o parcela por ID: queda libre hasta cargar todos los insumos y clasificarlos (decisión de Fausto).
- Egresos de fitosanitarios a mano: su salida sigue siendo la aplicación (automática). El egreso manual es para **insumos varios**.
- Detalle de movimientos e historial (web, pendiente ya anotado).
- Cola offline.

## Decisiones de Fausto (no re-litigar)
- El egreso lleva dónde se usó; por ahora texto libre, se clasifica después.
- Lo carga el encargado o superior.
- Botones de ingreso y egreso en Depósitos **y** en la pestaña principal, bien integrados.
- Cosecha separada en pestañas, cada una con sus propios registros.

## Approaches
- **A. Texto libre `destino` + tipo `egreso` (elegida).** Una columna nullable de texto y un valor nuevo del enum. Cumple "libre ahora, clasificar después" y deja los datos consultables.
- B. Meter el destino dentro de `observacion`. Sin migración, pero el destino no se puede filtrar ni clasificar después.
- C. FK a máquina/parcela ya. Descartada por Fausto: faltan cargar los insumos.

## Diseño
### Backend (única parte que toca producción)
- Migración nueva (no editar las aplicadas): `ALTER TYPE tipomovimientostock ADD VALUE IF NOT EXISTS 'egreso'` (fuera de transacción), y en `movimientos_stock` las columnas nullable `destino` (String 200) e `idempotency_key` (String 64) con índice único parcial sobre `idempotency_key`.
- `POST /insumos/{id}/movimientos`: acepta `tipo: "egreso"`; exige `destino` no vacío para egreso; resta del stock; permitido solo en insumos de `tipo` `vario` y `riego` (fito sale por aplicación); `require_encargado_up`. Si el stock quedaría negativo se permite (igual que el egreso por aplicación hoy): la app avisa antes de confirmar.
- `idempotency_key` opcional en el ingreso y el egreso: un reintento con la misma clave devuelve el movimiento original (200) sin volver a sumar ni restar. Cierra el riesgo de duplicado aceptado en v1.
- `MovimientoStockResponse` agrega `destino` e `idempotency_key`. Tests: egreso resta, destino obligatorio, rechazo en fitosanitario, replay idempotente, rol sin permiso, ingreso sigue igual.

### Mobile
- **Depósitos**: barra de pestañas fija arriba (scrolleable si no entra) que muestra una tarjeta a la vez. «+ Ingreso» y «− Egreso» (solo en Insumos varios) dentro de la pestaña.
- **Modal de egreso**: insumo, cantidad, fecha, «¿Dónde se usó?» (obligatorio, texto libre, placeholder «Tractor, máquina o parcela»), observaciones. Confirmación «Se restan X de Y; quedan Z» con aviso si queda en negativo. Usa la clave idempotente por intento, igual que alfalfa.
- **Inicio**: dos acciones rápidas «Ingreso de insumos» y «Egreso de insumos» (encargado o superior) que abren esos modales eligiendo el insumo de la lista.
- **Cosecha** (mi decisión, corregir si no): tres pestañas arriba. **Uva**: despachos De → Para y ingresos al pasero. **Pasa**: levantar pasa, lotes, entrega de pasa. **Alfalfa**: stock, Alta, Entrega y últimos documentos (lo que hoy muestra la pantalla Alfalfa, integrado como pestaña). La pantalla Alfalfa suelta sigue accesible desde el depósito.
- Mismo componente de pestañas para Depósitos y Cosecha, con el estilo de la app.

## A cargo del builder
Textos, estilos, componente de pestañas, orden de acciones en Inicio, cómo reutilizar el contenido de la pantalla Alfalfa dentro de Cosecha sin duplicar código.

## Verificación
- Backend: pytest (tests de arriba) y suite completa.
- Mobile: `npx tsc --noEmit` y prueba en el iPhone contra el backend local: pestañas, ingreso, egreso con y sin stock, destino vacío, doble toque, modo avión, regador sin acceso.
- Publicación (orden fijo, cada paso con confirmación): backup, push a `main` (Railway aplica la migración en el arranque, verificar), verificar `POST` real, recién después el OTA único con alfalfa, paseros, depósitos y estos cambios.

## Riesgos
- Migración de enum en producción: `ADD VALUE` es irreversible; se hace con backup previo y verificación.
- OTA nuevo antes que el backend: el modal de egreso fallaría con 422. Por eso el backend va primero.
- Pestañas de Cosecha tocan la pantalla más grande de la app (1224 líneas): se extrae el contenido por pestaña sin cambiar la lógica del wizard de despacho.

## Pendiente (web)
Detalle por depósito, historial de movimientos, clasificar el destino de egresos por máquina/parcela cuando estén cargados los insumos.
