# Cámara en mobile y deuda previa — diseño corto

Fecha: 2026-11-16 · Estado: aprobado por Fausto · Tamaño: cambio chico/mediano, dos fases.

## Intención
Permitir sacar fotos con la cámara (hoy solo galería) en reportes y órdenes, y cerrar cuatro deudas previas conocidas. Motivo: los operarios reportan fallas en el campo; la galería obliga a salir de la app.

## Goals
- Elegir "Tomar foto" o "Galería" en los 4 usos actuales del picker.
- Poder reintentar o descartar items `failed` de la cola offline.
- Que la finca de un encargado/regador/obrero no se pise con la guardada por otro usuario del mismo teléfono.
- Sheet de Ingresos web sin problema de z-index.

## Non-goals
- Menores diferidos (texto «Sin conexión», tope de páginas, parcelas dadas de baja).
- Revisar builds viejos en Play/TestFlight (lo hace Fausto en las consolas).
- Tocar `eas.json`.

## Restricciones
- Tocar `app.json` cambia el fingerprint → build nativo nuevo. Los arreglos OTA deben publicarse ANTES, con el fingerprint actual, para que lleguen a los builds vigentes.
- El código de cámara solo debe llegar a builds con el plugin (el fingerprint separa runtimes).
- OTA con `--environment production` y verificación del bundle según `mobile/AGENTS.md`.

## Approaches
1. **Dos fases (elegida):** fase 1 solo OTA (deuda), fase 2 cámara + build. Trade-off: dos publicaciones, pero los builds vigentes reciben los arreglos.
2. Todo junto en un build nuevo: más simple, pero los usuarios con builds viejos no reciben los arreglos hasta actualizar. Descartada.
3. Cámara con `expo-camera` propia: más control, más código y otra dependencia nativa. Descartada: `expo-image-picker` ya está instalado.

## Diseño
### Fase 1 (OTA, fingerprint actual)
1. `loadFinca` restaura la finca guardada solo si el rol es `gerencial` o `super_admin`; el resto usa `user.finca`. `logout` borra la clave guardada.
2. `OfflineQueueBanner` abre una hoja con los items `failed` (tipo, fecha, error). Acciones: Reintentar (vuelve a `pending`, reintentos en 0) y Descartar (con confirmación). Nuevas funciones en `lib/offlineQueue.ts`.
3. `Sheet` de `frontend/app/dashboard/finanzas/ingresos/page.tsx` con `createPortal` a `body` (patrón de `components/maquinaria/Drawer.tsx`). Deploy web manual.

### Fase 2 (build nativo)
4. `lib/imagePicker.ts`: `elegirImagen()` con opción cámara/galería, import diferido y aviso si falta el módulo. Reemplaza `elegirImagenDeGaleria` en `reportar.tsx`, `orden/[id].tsx`, `OrdenesPendientes.tsx` y `perfil.tsx`.
5. `app.json`: plugin `expo-image-picker` con textos de permiso en español; subir `versionCode`.
6. Build Android (prueba cerrada) + iOS (TestFlight), antes del 2026-11-19. Fausto corre los comandos.

## A cargo del builder
Textos exactos, estilo de la hoja de la cola, tests (`tsc`, lint, build web), orden de comandos de build.

## Verificación
`npx tsc --noEmit` (mobile), `npm run lint && npm run build` (web). Cámara y fotos de órdenes se prueban en dispositivo con el build nuevo (cierra el punto 5 de Maquinaria).
