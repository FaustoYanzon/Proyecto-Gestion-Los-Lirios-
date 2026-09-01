---
tags: [sistema, mobile, sesion]
---

# Mobile: EAS Update (OTA) + rediseño de "Cargar Tarea" — 2026-07-12

> Sesión de trabajo sobre la app mobile, después del deploy de piloto documentado en [[2026-07-11-deploy-piloto-completado]]. Un tester (Camilo) reportó no poder loguearse en el APK instalado; se diagnosticó, se configuró actualización OTA para evitar rebuilds futuros, y se rediseñaron 5 puntos de UX en el formulario de carga de tarea diaria.

## 1. Bug reportado: "No se puede conectar con el servidor" al loguear

**Diagnóstico:** el backend en Railway respondía correctamente (`curl` a `/` y `/auth/login` confirmaron `200`/`401` normales). El mensaje de error en `login.tsx` es genérico para *cualquier* fallo no-401, así que no confirmaba un problema de red real. Causa más probable: el tester tenía instalado un APK de un intento de build anterior (2 de los 3 intentos del piloto fallaron, ver [[2026-07-11-deploy-piloto-completado]]) que todavía apuntaba a la IP de LAN en vez de a Railway. Se le indicó reinstalar desde el link de build correcto.

## 2. Usuario nuevo: Camilo (gerencial)

Se creó vía `POST /auth/register` (requiere token de super_admin) directamente contra producción:
- `camiloyanzon@hotmail.com` — rol `gerencial` — id `35c182e9-9d34-45ef-a539-b95c7d2774b3`.

## 3. EAS Update (OTA) configurado

Antes de este cambio, el proyecto mobile **no tenía `expo-updates` instalado ni canales configurados** — cualquier cambio, incluso puro JS/UI, requería `eas build` + redistribuir el link + reinstalar en cada teléfono.

**Cambios:**
- `npx expo install expo-updates` (agrega dependencia nativa).
- `npx eas-cli update:configure` → agregó a `app.json`: `updates.url` (`https://u.expo.dev/956e1040-2583-4249-9504-9b62ae24271e`) y `runtimeVersion: { policy: "appVersion" }` (las updates OTA solo aplican a instalaciones con la misma versión de app declarada).
- `eas.json`: cada build profile ahora tiene un `channel` (`development`, `preview`, `production`).

**Implicancia a futuro:** de acá en adelante, cambios de puro JS/UI se publican con `eas update --branch preview --message "..."` en segundos, sin rebuild ni reinstalación. Solo cambios nativos (nuevas dependencias con código nativo, cambios de permisos, etc.) siguen requiriendo `eas build` + redistribución.

Esta build (`66e747d7-e810-4f1c-a8cb-b5347c424e7b`) es la **última que necesita reinstalación manual** en los teléfonos de los testers — trae el canal OTA activado por primera vez.

## 4. Rediseño de UX en "Cargar Tarea" (`mobile/app/(tabs)/tareas.tsx`)

Contexto de arquitectura: **`mobile/components/Wizard.tsx` es código muerto** — ningún screen lo importa. Los 4 wizards reales (`tareas.tsx`, `fito.tsx`/`fitosanitario.tsx`, `riego.tsx`, `campana.tsx`) reimplementan cada uno su propio wizard a mano (`StepIndicator`, estilos locales), no comparten el componente genérico documentado en `docs/DESIGN_SYSTEM.md` § 8. Vale la pena tenerlo en cuenta si se piden cambios similares en los otros 3 formularios — no son el mismo código, hay que tocar cada archivo.

**Cambios aplicados (paso 2 y 3 del wizard de tareas):**

1. **Ubicación** (paso "Detalle"): antes era un buscador + lista plana de las primeras 6 parcelas filtradas, sin distinguir tipo. Ahora es un campo tipo dropdown que abre un modal (`SectionList`) agrupado por tipo de parcela (Parrales/Potreros/Paseros/Cabezales, con el color de cada tipo ya definido en `theme.ts` → `parcelaColors`/`parcelaLabels`, antes sin usar en este screen) + "Sin ubicación específica" fijo arriba + buscador.
2. **Unidad**: antes 8 chips en fila horizontal con scroll. Ahora 3 chips primarios (Días/Melgas/Plantas) + chip "Otros" que abre un modal con las 4 unidades restantes (Metros/Vines/Cajas/Gamelas) + Otros genérico como último recurso.
3. **Cantidad por trabajador** (paso "Trabajadores"): reemplazado el stepper +/- por una casilla de texto con teclado numérico (`decimal-pad`) — cargar 90 unidades ya no requiere 90 taps.
4. **Confirmación de carga**: se eliminó la pantalla intermedia "Guardado" con botón "Nueva carga". Ahora, al confirmar, vuelve directo a la lista (home de Tareas) con un toast de 1.8s ("Tarea cargada ✓") en vez de requerir una acción extra del usuario.
5. **Cancelar wizard**: se agregó una "X" en la esquina superior derecha del `StepIndicator`, visible en los 4 pasos, con confirmación (`Alert.alert` con 2 botones) antes de descartar los datos ingresados.

Verificado interactivamente (Playwright contra `expo start --web`, con rutas de API mockeadas) recorriendo el flujo completo: selección de ubicación por tipo, submenu de unidad, carga directa de cantidad "90" con cálculo de monto correcto, submit → toast → vuelta a home. El botón de cancelar se verificó visualmente en los 4 pasos; el diálogo de confirmación en sí no se pudo re-verificar en el preview web porque `Alert.alert` con múltiples botones no dispara un diálogo nativo de navegador en React Native Web — no es un problema del código (reutiliza el mismo patrón ya probado en producción de `RecentList`/`handleDelete` en el mismo archivo).

**Nota técnica de la sesión de testing:** para poder correr el preview web de Expo hubo que instalar `react-native-web` (declarado en `app.json` como plataforma pero sin la dependencia instalada) y parchear temporalmente `lib/api.ts`/`lib/auth.ts` para tolerar que `expo-secure-store` no tiene implementación funcional en web en esta versión (el módulo nativo es un stub vacío `export default {}`, así que cualquier llamada a `SecureStore.getItemAsync` explota antes de llegar a la red). El parche se revirtió al terminar — no quedó en el código commiteado. Si se quiere volver a testear en web en el futuro, hay que repetir ese parche temporal (o resolverlo de forma permanente con un `try/catch` o chequeo de plataforma, si se decide dar soporte real a mobile-web).

## Commits de la sesión

| Commit | Descripción |
|---|---|
| `eadb52c` | `feat(mobile): enable EAS Update (OTA) for the app` |
| `8bc668a` | `feat(mobile): redesign ubicación/unidad/cantidad UX in carga de tareas` |

## Ver también

- [[2026-07-11-deploy-piloto-completado]]
- [[Arquitectura]]
- [[Stack Técnico]]
- [[Sistema de Gestión Agrícola]]
