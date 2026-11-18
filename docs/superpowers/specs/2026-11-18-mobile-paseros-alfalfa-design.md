# Mobile: paseros en el mapa y alfalfa — diseño corto

Fecha: 2026-11-18 · Estado: aprobado e implementado en feat/mobile-alfalfa (sin desplegar) · Tamaño: cambio mediano (1 endpoint backend + app Expo, por OTA). Paso 5 de la serie paseros → manto → alfalfa → anulación → **mobile**.

## Intención
Fausto quiere que el encargado o el ingeniero carguen alfalfa desde el celular, en el potrero o al depositar fardos/rollos/semilla en el depósito, y que el pasero tenga en el mapa del celular el mismo tratamiento que ya tiene en web. La entrega de pasa del celular **no se toca** (decisión de Fausto, 2026-11-18).

## Goals
- Mapa mobile: el pasero tiene su propio panel (superficie, tareas, uva fresca en kg con barra por variedad), solo «+ Tarea», y no aparece en riego ni fito.
- Alfalfa mobile: ver stock, hacer **Alta** (a un potrero) y **Entrega** (a un comprador, con patente opcional), y abrir el PDF del documento.
- Un solo cambio de backend: enlace firmado del PDF de alfalfa, igual al de remitos.

## Non-goals
- Anular desde el celular (solo super_admin, queda en web).
- Cambios a la entrega de pasa, lotes, levantada o ingresos al pasero mobile.
- Carga sin conexión (cola offline): se evalúa solo si en la práctica falta señal.
- Listado histórico de documentos en el celular (v1 muestra stock y los últimos documentos).

## Decisiones de Fausto (no re-litigar)
- Quién carga: encargado o ingeniero, desde el potrero o el depósito.
- **Solo con conexión** (opción A), igual que Entrega de pasa. Si aparecen problemas de señal, se resuelve después con la cola offline.

## Approaches (carga en el potrero)
- **A. Solo con conexión (elegida).** Simple; stock y numeración se validan en el servidor. Costo: sin señal no se carga hasta llegar a cobertura.
- B. Alta offline con cola (`offlineQueue`): serviría para altas, pero la entrega necesita validar stock y cada alta quedaría sin número ni PDF hasta sincronizar. Descartada por ahora.
- C. A primero, offline después: es A con la puerta abierta.

## Diseño
### Backend
- `POST /alfalfa/documentos/{id}/pdf-link` (`require_encargado_estricto`): devuelve `{path, url, expires_in}` con token firmado de 5 min, espejo de `POST /remitos/{id}/pdf-link`; una ruta pública `GET /alfalfa/descarga/{token}` sirve el PDF (mismo generador que `GET /alfalfa/documentos/{id}/pdf`, incluida la marca ANULADO). Ruta estática antes de las parametrizadas. Test: token válido abre el PDF, token inválido/vencido da 401/403, otro tipo de token no sirve.

### Mobile (Expo SDK 54, ver `mobile/AGENTS.md`)
- `lib/alfalfa.ts`: tipos y llamadas (`getStockAlfalfa`, `getDocumentosAlfalfa`, `createDocumentoAlfalfa`, `abrirDocumentoAlfalfaPdf`), reutilizando `errorDetail`, `getCompradores` y la lista de potreros de `lib/altaProduccion.ts`. Cantidades como string decimal; fardo y rollo enteros; semilla en kg.
- Pantalla `app/alta-produccion/alfalfa.tsx` (acceso «Alfalfa» en la pestaña Cosecha, junto a los de Alta de producción, solo `puedeAltaProduccion`): tarjetas de stock por producto (unidades y kg) y dos botones, «Alta» y «Entrega».
- Modal de carga (patrón de `EntregaModal`): potrero (alta) o comprador + patente (entrega), fecha (hoy por defecto), cantidades por producto, observaciones. **Paso de revisión** antes de guardar con el texto «Revisá bien el documento antes de guardar: una vez guardado, solo un super admin puede anularlo.». `idempotency_key` UUID por intento para que un doble toque o un reintento no duplique.
- Errores del backend (409 stock insuficiente, 422) se muestran tal cual dentro del modal.
- Tras guardar: refrescar stock y ofrecer «Abrir PDF» (link firmado, `Linking.openURL`).
- Mapa (`app/(tabs)/mapa.tsx`): rama `tipo === 'pasero'` en el panel — oculta cosecha, ciclo, fenología, agua, fito y cabezal; tarjeta «Uva fresca» desde `GET /pasero/stock?pasero_id=` (solo encargado o superior; para el resto no se muestra, sin error); acciones rápidas solo «+ Tarea». Pasero neutro en los modos de mapa de cumplimiento y fito.
- Selectores de riego, fito y órdenes de aplicación del celular excluyen `pasero` (el backend ya responde 422).

## A cargo del builder
Textos, estilos, nombres de componentes y tests; el formato exacto del token del PDF (copiar el de remitos).

## Verificación
- Backend: pytest del nuevo endpoint (token ok, vencido, inválido, documento anulado sigue abriendo).
- Mobile: `npx tsc --noEmit`; probar contra el backend local (uvicorn) en Expo/emulador: alta y entrega, 409 por stock, PDF, panel del pasero con ingresos de dos variedades, pasero ausente en riego/fito. Rol regador o gerencial: acceso a Alfalfa según `puedeAltaProduccion`.
- Publicación: backend primero (push a `main`, Railway), después OTA con `EXPO_PUBLIC_API_URL=<prod> eas update --branch production --environment production`, y verificar el bundle publicado (URL de producción, sin `192.168.*`). Cada paso con confirmación de Fausto.

## Riesgos
- Un OTA con la URL equivocada rompe la conectividad: seguir `mobile/AGENTS.md` al pie de la letra.
- Cliente OTA viejo contra backend nuevo: el endpoint nuevo es aditivo, no rompe a nadie.
- Sin señal en el potrero: la carga falla con error claro y no se pierde nada; si pasa seguido, ver opción B.
