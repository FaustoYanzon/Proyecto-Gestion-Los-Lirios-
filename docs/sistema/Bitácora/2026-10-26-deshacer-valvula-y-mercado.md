---
fecha: 2026-10-26
tags: [sistema, bitacora, produccion, fitosanitarios, ordenes-aplicacion, valvulas, mobile, despacho]
---

# Bitácora 2026-10-26: deshacer válvula y prueba del wizard de mercado

Cierra el pendiente "sin deshacer para una válvula ya confirmada" de [[2026-10-26-fito-por-valvula-deploy]]. También deja registrada la prueba del wizard mobile de mercado que quedó sin probar en [[2026-10-16-mercado-expo-y-conciliacion-de-bodega]]. Plan: `docs/superpowers/plans/2026-10-26-deshacer-valvula-y-pendientes.md`.

## Implementación

- **Backend:** nuevo `POST /ordenes-aplicacion/{orden_id}/valvulas/{orden_valvula_id}/deshacer`. Solo `super_admin`, `gerencial` y `encargado` (el encargado solo de su finca).
  - Lock por orden.
  - Devuelve el stock con `_revertir_movimiento_stock`.
  - Borra el `RegistroFitosanitario` y sus fotos (por registro y por `orden_valvula_id`).
  - Limpia `revisada_at` / `revisada_por`.
  - Baja la parcela y la orden: `_recalcular_estado_orden` ahora también baja el estado.
  - Orden de errores: 404 → lock → 404 fila/orden ajena → 403 finca → 409 si ya estaba pendiente.
  - Sin migración.
- **Web:** botón "Deshacer" en `OrdenCard` (Pendientes) y en el panel "A revisar", con modal propio. Checkbox "Mostrar completadas" para poder deshacer en órdenes completadas (el panel A revisar solo lista válvulas con observaciones o `no_aplicada`, no cubre las completas sin observaciones). Invalida órdenes, a-revisar, fitosanitarios e insumos.
- **Mobile:** botón "Deshacer" en los chips de válvulas ya confirmadas (parrales aún pendientes de órdenes pendientes/en curso). Para la última válvula de un parral o una orden completada se usa la web. Sin cambios en `eas.json`, `app.json` ni `package.json`: el fingerprint del OTA queda intacto.
- **`DELETE /produccion/fitosanitarios/{id}`:** ahora responde 409 "Esta aplicación viene de una orden: deshacela desde la válvula." si el registro nació de una válvula. Antes dejaba la fila aplicada/completa con registro NULL, sin bajar parcela ni orden. En "Aplicadas" la web muestra ese error en un banner inline y el confirm aclara que los registros de válvula se deshacen desde la válvula. El `PUT` con cambio de insumo sobre un registro de válvula queda sin tratar.

## Pruebas

- **Backend:** pytest 289 passed (285 previos + 4 nuevos). 10 tests de deshacer, más los de reconfirmar, 403 antes que 409 y válvula de otra orden = 404.
- **Web:** lint 0 errores (29 warnings preexistentes), build OK.
- **Mobile:** `tsc` pelado da RangeError por stack overflow en Node 24, también sin cambios. Con `node --stack-size=20000 node_modules/typescript/lib/tsc.js --noEmit` no da errores.
- **Local con click real** (Postgres local, web en localhost):
  - Deshacer una completa devuelve el stock exacto (88→90); deshacer una `no_aplicada` no lo toca.
  - Orden completada con "Mostrar completadas": aparece el botón y al deshacer baja a `en_curso` (stock +4).
  - Reconfirmar después de deshacer: OK.
  - Dos deshacer simultáneos: 200 y 409, con el stock devuelto una sola vez.
  - `DELETE` de un registro de válvula: 409.
- **No probado con click real:** el botón dentro del panel "A revisar", el botón de mobile (solo revisión de código y compilación), fotos reales (cubierto por pytest), roles `regador` / `obrero` en la UI (cubierto por `test_deshacer_roles`).

## Wizard mobile de mercado (MI / EXPO)

Probado con la app corriendo en navegador (Expo web) contra el backend local:

- Sin mercado, el Siguiente no avanza.
- Exportación crea la cosecha con destino `exportacion` y remito FRE-000003.
- Mercado interno crea `mercado_interno` y FRE-000004.
- Con "Pasero" el selector desaparece y se limpia al volver a "Uva en fresco".
- El doble click creó un solo remito.
- Para correr la app en web hizo falta un shim temporal de `expo-secure-store` (ya borrado), porque SecureStore no existe en web.

## Fingerprint iOS

- Los builds iOS 5 y 6 tienen runtime `07054827…` (el del OTA iOS publicado hoy).
- El build iOS 4 tiene runtime `1.0.0` y no recibe OTA: los testers con ese build deben actualizar desde TestFlight.

## Pendientes

- Consulta en prod: `SELECT count(*) FROM ordenes_aplicacion_valvulas WHERE estado='aplicada' AND resultado='completa' AND registro_fitosanitario_id IS NULL;`. Son las filas que dejó la vía vieja de `DELETE`; se corrigen con Deshacer.
- El `logger.info` del deshacer se emite antes del commit de `get_db`.
- Fotos borradas de la DB pero no de Cloudinary (igual que `delete_fitosanitario`).
- El botón Deshacer es visible a un encargado en válvulas de otra finca (responde 403 claro).
- Los triggers del panel A revisar no tienen `disabled` mientras corre la operación.
- El banner de error de "Aplicadas" no se limpia al cambiar filtros.
- Estilo del chip y `Alert` de mobile sin probar en dispositivo.
- Desplegar: push de backend, `vercel --prod`, y OTA mobile solo si `fingerprint:compare` coincide.
