---
fecha: 2026-11-18
tags: [sistema, bitacora, mobile, alfalfa, paseros, backend]
---

# Bitácora 2026-11-18: mobile paseros y alfalfa

Rama `feat/mobile-alfalfa`, **sin mergear, sin push, sin OTA**. Decisión: [[2026-11-18-mobile-alfalfa-solo-con-conexion]].

## Qué se construyó

- `0828ec1` backend: link firmado de PDF para documentos de alfalfa (`POST /alfalfa/documentos/{id}/pdf-link`, `GET /alfalfa/descarga/{token}` sin Authorization; token con scope propio, TTL 300 s).
- `3b91bf7` mobile: cliente de API de alfalfa (`mobile/lib/alfalfa.ts`).
- `6893870` y `8205976` mobile: pantalla de Alfalfa con modal de alta y entrega; clave de idempotencia nueva al editar un documento fallido.
- `e234d5b` mobile: panel del pasero en el mapa y paseros fuera de los selectores de riego y fito.

## Qué se verificó

- Backend `pytest -q`: 757 passed (incluso el test conocido de manto 1,56 pasó).
- Mobile `npx tsc --noEmit`: sin errores.
- Contra backend **local** (uvicorn, base `loslirios_db` en localhost), por HTTP con usuarios QA encargado y regador: stock 200 y 403 para regador; `GET /pasero/stock` 200 para encargado; alta 201; reenvío con la misma `idempotency_key` devuelve 200 y el mismo documento; entrega 201; entrega con stock insuficiente 409 (mensaje con producto, disponible y pedido); regador 403 al crear y en pdf-link; pdf-link 200; `GET` del path sin Authorization devuelve `application/pdf`; token alterado, token de sesión (otro scope) y token basura devuelven 401.

## Qué NO se verificó

- **La UI de mobile no se ejercitó.** `expo start --web` compila, pero el login falla en web (`ExpoSecureStore.getValueWithKeyAsync is not a function`: `expo-secure-store` no existe en web), así que no se llegó a la pantalla de Alfalfa ni al panel del pasero. El mapa usa WebView. Falta probar en Expo Go/dev build: doble toque en Guardar, modal con el 409, apertura del PDF, panel de pasero con dos variedades, pasero ausente en riego y fito, regador sin acceso a Alfalfa.
- Token de PDF **vencido** (solo token alterado/ajeno/basura; el vencimiento lo cubren los tests unitarios de la tarea 1).
- Nada contra producción.

## Datos QA locales que quedaron

- Usuarios `qa_mobile_enc` (encargado) y `qa_mobile_reg` (regador) en la base local, desactivados (`is_active = false`).
- Documentos de alfalfa en la base local: `ALF-ALT-000006` (10 fardos al primer potrero) y `ALF-SAL-000006` (4 fardos a un comprador).

## Abierto

- Menores diferidos: sin `KeyboardAvoidingView` en el modal en iOS chicos; `fetchData` corre para roles sin acceso (403 inocuo); `fechaValida` no acota el año; `getPotreros` duplica `getParcelasActivas`; el validador reimplementa la regex de `kgValido` y acepta `007`; `loadingExtra` ante falla de fetch sin cambios.
- `url` del pdf-link se arma con `request.base_url` (igual que remitos y lotes de pasa). `backend/railway.json` arranca uvicorn con `--proxy-headers --forwarded-allow-ips='*'`, así que detrás de Railway `base_url` debería ser `https`; falta verificarlo en producción tras el deploy. Mobile usa `data.url` en los cuatro pdf-link; los remitos ya funcionan así en producción, pero no se verificó el esquema real. No se cambió.
- La clave de idempotencia del modal de alfalfa está atada al contenido (`sentPayloadRef`): reintentar sin cambios reusa la clave; editar y reenviar genera una nueva.
- El OTA debe publicarse con `EXPO_PUBLIC_API_URL=<url prod>` (ver `mobile/AGENTS.md`) y verificar el bundle (URL de producción presente, sin `192.168.*`).
- Pendiente con confirmación de Fausto, en orden: push a `main` (Railway despliega el endpoint), verificar el endpoint en producción, y recién después `eas update`.
