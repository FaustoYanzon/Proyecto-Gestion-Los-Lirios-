---
fecha: 2026-11-16
tags: [sistema, bitacora, mobile, web, deploy, camara, offline, finanzas]
---

# Bitácora 2026-11-16: cámara en mobile y deuda previa (PR #7 y PR #8)

Dos fases, cada una en su PR. Spec: `docs/superpowers/specs/2026-11-16-camara-y-deuda-mobile-design.md`. Plan: `docs/superpowers/plans/2026-11-16-camara-y-deuda-mobile.md`. Cierra los pendientes que quedaron abiertos en [[2026-11-11-modulo-maquinaria]] y en la decisión [[2026-11-11-modulo-maquinaria]] (ver Decisiones).

Estado al cierre: **ambas fases mergeadas a `main` (HEAD `25ccb2c`) y desplegadas.** Web en Vercel, OTA publicado, builds nativos subidos.

## Qué se construyó

**Fase 1 (PR #7, merge `ba046ee`): solo JS, llega por OTA a los builds vigentes**

- **Finca pisada en teléfonos compartidos (cerrada).** `loadFinca(role)` en `mobile/store/fincaStore.ts` restaura la finca guardada solo para `gerencial` y `super_admin`. Encargado, regador y obrero quedan fijados a su finca asignada. `UserBadge` la llama cuando ya conoce el rol.
- **Cola offline: items `failed` reintentables y descartables (cerrada).**
  - `mobile/lib/offlineQueue.ts`: todas las mutaciones pasan por un lock de promesas encadenadas (`withLock`), así un reintento o descarte manual no pisa la escritura del loop de sync.
  - Nuevas: `getFailedItems`, `retryFailed` (resetea `retryCount` y `createdAt`) y `discard`.
  - `mobile/components/FailedQueueSheet.tsx`: se abre desde `OfflineQueueBanner` y permite reintentar o descartar. Ya no se abre sola.
  - `offlineSync.processQueue`: si se llama mientras ya está sincronizando, vuelve a correr al terminar (flag `rerun`), en vez de perder la llamada.
- **Sheet de Ingresos web (cerrada).** `frontend/app/dashboard/finanzas/ingresos/page.tsx` usa `components/maquinaria/Drawer` (portal a body). Se eliminó el `Sheet` duplicado.

**Fase 2 (PR #8, merge `25ccb2c`): cámara, requiere build nativo**

- `mobile/lib/imagePicker.ts`: `elegirImagen()` muestra un Alert «Tomar foto / Galería». Reemplaza a `elegirImagenDeGaleria` en los 4 usos: reportar falla de maquinaria, `orden/[id]`, `OrdenesPendientes` (2 lugares) y perfil. El import sigue siendo lazy.
- iOS: espera 450 ms después de cerrar el Alert antes de abrir el picker. Sin la espera, el picker no abre sobre los modales `pageSheet` (el Alert y el modal compiten).
- Permiso denegado: si `canAskAgain` es false, ofrece «Abrir ajustes» con `Linking.openSettings`.
- `mobile/app.json`: plugin `expo-image-picker` con textos de permiso en español y `microphonePermission: false`. Sin esa opción el plugin agrega `RECORD_AUDIO`, que la app no necesita. El permiso de cámara viene del manifest de la librería.
- `eas.json` no se tocó.

## Qué se verificó

- Fase 1: desplegada por OTA. Fausto la probó junto con la build de iOS.
- Fase 2: iOS probado por Fausto en TestFlight. Android subido a Play (prueba cerrada) y publicado el 2026-11-16.
- Bundles OTA verificados: URL de Railway de producción presente, sin `192.168`.

## Despliegues

**Web (Vercel prod):** `frontend-six-jade-79.vercel.app`, deploy manual con `vercel --prod` tras verificar.

**OTA producción desde `ba046ee`:**

- Android, runtime `1ccf455d`: grupo `dff77a67`, y luego uno duplicado `1aade529`.
- iOS, runtime `07054827`: grupos `4c2e5e00` y `390ee5e3`.

**Builds nativos desde `b81d292`:**

- Android: `versionCode 10`, build `eaca782c`, runtime y fingerprint `bc733f64`. Subido a Play prueba cerrada (Alpha), publicado 2026-11-16.
- iOS: `buildNumber 7`, build `23995076`, fingerprint `10cc6f4a`. Enviado a TestFlight (ASC App ID `6807586103`).

## Decisiones tomadas

- **Dos fases, no un solo PR.** La fase 1 no toca `app.json` ni `eas.json`, así el fingerprint no cambia y el OTA llega a todos los binarios instalados. La cámara sí cambia el fingerprint, y solo llega con build nuevo. Así se evita dejar sin arreglos a los celulares ya en el campo.
- **Corolario de runtime (importante para los próximos OTA):** los builds nativos nuevos tienen runtime `bc733f64` (Android) y fingerprint `10cc6f4a` (iOS), distintos de los viejos (`1ccf455d` / `07054827`). Desde ahora, un OTA publicado desde `main` apunta solo a los runtimes nuevos. Los usuarios que siguen en el binario viejo quedan en su runtime viejo, con lo último que se les publicó ahí. Un fix JS para ellos tendría que salir desde un branch con el runtime viejo; desde `main` ya no llega.
- **Cámara: un helper único `elegirImagen()`** en vez de repetir el Alert en cada pantalla. El permiso denegado se maneja en un solo lugar.

## Lecciones de operación (eas-cli)

- **ECONNRESET por IPv6 desde esta PC.** `eas-cli` falla al resolver IPv6 en la red de Fausto. Workaround: en PowerShell, `$env:NODE_OPTIONS="--dns-result-order=ipv4first"` (con `set` no tiene efecto en PowerShell).
- **Build lanzado por error desde `main`** (sin el plugin de cámara). Se canceló. Regla: antes de `eas build` o `eas submit`, verificar la rama activa y, después, `eas build:view` con `gitCommitHash`.
- **`eas submit android` no-interactivo falla:** no hay Google service account cargada en EAS. Los `.aab` se suben a mano en Play Console.
- **`eas submit ios` no-interactivo necesita `ascAppId`.** No está en `eas.json` a propósito, porque `eas.json` entra en el fingerprint. Correrlo interactivo y responder NO a «guardar» el ID.
- **`appVersionSource` es `remote`:** `android.versionCode` de `app.json` se ignora. El número sale de EAS.
- **Deep links de Play Console adivinados dan error.** Navegar desde el menú.

## Qué NO está hecho o no está verificado

- Foto de maquinaria por cámara: la subida de fotos de órdenes de Maquinaria ya se puede probar con el build nuevo de cámara. No se probó todavía en campo.
- Menores diferidos (sin cambio en este ciclo): texto «Sin conexión», tope de páginas, parcelas dadas de baja.
- Builds viejos: no se sabe todavía cuáles siguen activos en Play ni en TestFlight.

## Abiertos

- **2026-11-19:** confirmar que el reloj de 14 días de la prueba cerrada no se reinició con la release 10. Si se reinició, la fecha de acceso a producción se corre y hay que recalcularla.
- Revisar qué binarios viejos siguen activos en Play y TestFlight antes de sacar las columnas shim de la base de datos.
- Ficha de máquina, edición y baja: pendiente de la ficha técnica del encargado.
- Carga de la flota real: entregada al encargado, sin confirmar.
- Grupos OTA duplicados (Android `1aade529`, y el iOS `390ee5e3` o `4c2e5e00`): inofensivos, no hace falta borrarlos.

## Docs

- `docs/sistema/Bugs Conocidos.md`: sección Resueltos con los tres puntos cerrados (finca pisada, cola offline sin reintento, Sheet de Ingresos). Se agregó un riesgo 🟡 de ECONNRESET de eas-cli.
- `docs/sistema/Decisiones/2026-11-11-modulo-maquinaria.md`: los tres puntos que decían «sin resolver» (finca pisada, Sheet de Ingresos, cámara) quedaron marcados como resueltos, con referencia a este PR.
- `PROJECT_MAP.md`: no se regeneró. No hay rutas de backend, modelos ni pantallas de `mobile/app/` nuevas. `FailedQueueSheet` y `imagePicker.ts` son componentes y libs de mobile, que el generador no lista.
- `Modelo de Datos.md`: no se regeneró. No hay cambio de esquema.
