# Fitosanitario: confirmación por válvula, seguimiento y push de orden nueva

Fecha: 2026-10-23 · Origen: capacitación con los operarios (estandarización).

## Objetivo
Las órdenes de aplicación se confirman **por válvula**, no por parcela entera. La parcela se
tilda sola cuando se confirman todas sus válvulas. Cada confirmación registra responsable,
observaciones y foto. Lo aplicado mal o no aplicado dispara un aviso y se revisa desde un panel
para decidir si hace falta una orden de repaso. Crear una orden nueva notifica a los celulares.

## Decisiones tomadas (con Fausto)
- Superficie por válvula: se calcula desde `frontend/public/layers/Cuadrantes de Riego.geojson`
  (57 polígonos, campo `Valvula Correspondiente`). Control: suma por parcela vs `Parcela.superficie`.
- Responsable: selector, por defecto el trabajador del usuario logueado.
- Resultado por válvula: **solo `completa` o `no_aplicada`**. No existe "parcial": una aplicación
  parcial se registra como `completa` + observación, y **descuenta stock como si se hubiera
  aplicado toda la superficie de la válvula**. La revisión posterior decide qué hacer.
- Orden de confirmación **libre** (no se fuerza 21 → 22 → 23).
- Push de orden nueva: a **todos los usuarios con token**.
- Seguimiento: push de alerta a encargados y gerencia + panel web "A revisar" + botón
  "Crear orden de repaso".

## Modelo de datos
- `Valvula.superficie_ha` (Numeric, nullable hasta correr el script de carga).
- `OrdenAplicacionValvula` (nueva), hija de `OrdenAplicacionParcela`:
  `id`, `orden_parcela_id`, `valvula_id`, `estado` (pendiente/aplicada), `resultado`
  (completa/no_aplicada, null mientras pendiente), `responsable_id`, `responsable`,
  `observaciones`, `registro_fitosanitario_id` (null si no_aplicada), `confirmada_at`,
  `revisada_at`, `revisada_por`. Único `(orden_parcela_id, valvula_id)`.
- `RegistroFitosanitario.valvula_id` (nullable). Cantidad = dosis_por_ha × `superficie_ha` de la válvula.
- Una válvula `no_aplicada` NO crea registro ni descuenta stock. Cuenta como "resuelta" para
  cerrar la parcela, pero queda en "A revisar".
- Una parcela pasa a `aplicada` cuando todas sus válvulas están resueltas; la orden pasa a
  `completada` cuando todas sus parcelas lo están (misma lógica que hoy).
- Respaldo: parcelas sin válvulas, y órdenes creadas antes del cambio (sin filas de válvula),
  se confirman enteras como hoy. Sin migración de datos.

## API
- `POST /ordenes-aplicacion/{orden_id}/valvulas/{orden_valvula_id}/confirmar`
  body: `resultado`, `responsable_id?`, `observaciones?` (obligatoria si `no_aplicada`).
- `POST /ordenes-aplicacion/valvulas/{orden_valvula_id}/fotos` (mismo patrón que parcelas).
- `OrdenAplicacionParcelaResponse` suma `valvulas: [...]`.
- `GET /ordenes-aplicacion/a-revisar` y `POST .../valvulas/{id}/revisar`.
- Al crear la orden se generan las filas de válvula de cada parcela.
- Endpoint existente de confirmar parcela se mantiene (respaldo).

## Seguimiento y push
- Alerta (push a encargado+, ver abajo) cuando una confirmación es `no_aplicada` **o** es
  `completa` con observaciones no vacías (así se señalan las aplicaciones parciales).
- Panel web "A revisar" (Producción): válvula, parral, responsable, observaciones, foto, fecha.
  Botón "Crear orden de repaso": precarga orden extra con esa válvula y marca la alerta revisada.
- Push de orden nueva (desde plan y extra): todos los tokens. Envío en lotes de 100, lectura de
  recibos de Expo, borrado de tokens `DeviceNotRegistered`, vía `BackgroundTasks`.
- Limitación conocida: un token por usuario (celular compartido → gana el último que abrió la app).

## Mobile / Web
- Mobile (`OrdenesPendientes.tsx`): tocar el parral despliega sus válvulas (orden por
  `Valvula.orden`); cada una abre el modal con responsable, resultado, observaciones y foto.
- Web: historial por válvula y panel "A revisar".

## Fases (cada una se prueba en local antes de deployar)
1. Backend: superficie + script de carga, tablas, endpoints, tests. Railway.
2. Push de orden nueva (independiente).
3. Mobile: acordeón + modal; OTA (backend desplegado antes; la app vieja sigue andando con el respaldo).
4. Web: historial y panel "A revisar"; deploy manual Vercel.

## Riesgos
- Superficies calculadas que no cierren con `Parcela.superficie` → revisar antes de activar.
- Stock: "parcial = descuento completo" sobreestima consumo; la corrección queda para la revisión manual.
- Push: token único por usuario.
