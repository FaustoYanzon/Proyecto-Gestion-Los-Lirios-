---
tags: [sistema, sesion]
---

# 2026-08-24 — Pestaña Documentación, selectores Finca/Campaña conectados de verdad, fix Ctrl+K

Sesión de 3 pedidos, con modo plan formal antes de tocar código (exploración con agentes en paralelo + preguntas de alcance con Fausto antes de escribir nada).

## 1. Pestaña "Documentación" nueva en el sidebar web

Solo `gerencial`/`super_admin`. Junta info de referencia de la finca hoy dispersa: **Parcelas** y **Trabajadores** se mueven ahí desde Admin (mismas pantallas, solo cambia la ruta — `frontend/app/dashboard/admin/{parcelas,trabajadores}` → `frontend/app/dashboard/documentacion/{parcelas,trabajadores}`). Admin queda solo con Usuarios/Notificaciones.

Tres sub-pestañas nuevas:
- **Riego — Válvulas y Cuadrantes** (`frontend/app/dashboard/documentacion/riego/page.tsx`): tabla armada 100% client-side, sin cambios de backend — junta `GET /produccion/valvulas` (catálogo real, ver [[2026-08-18-tabla-equivalencia-valvulas-cuadrante]]) con el GeoJSON estático de cuadrantes (`/layers/Cuadrantes de Riego.geojson`), join por nombre de válvula.
- **Melgas**: la "Planilla Técnica de Relevamiento de Cuarteles y Parrales" que Fausto tenía como imagen suelta (19 parrales, melgas E-O/N-S, cuadros estimados) — transcripta a tabla + la imagen original con un toggle "Ver planilla original" por si la transcripción pierde algún detalle (el caso especial de Parral 11, multi-sector con desglose propio en el texto de observaciones).
- **Empresa**: link al Drive de archivos de la empresa + Misión/Visión/Valores, marcados "(a definir)" — contenido pendiente que Fausto va a dictar en una sesión futura.

`ALL_NAV`/`SUB_NAVS` (antes definidos a mano dentro de `dashboard/layout.tsx`) se extrajeron a `frontend/lib/navigation.ts` como fuente única — la usa también el fix del punto 3.

## 2. Selectores de Finca y Campaña — dos bugs reales, no solo "sacar Caucete"

Fausto pidió sacar Caucete (finca vieja/de prueba) de los selectores. Al investigar apareció un problema más grande: **el selector global de arriba (topbar web, drawer mobile) no filtraba nada** — ningún componente leía `useContextStore()`. Cada pantalla que sí filtraba (Egresos, Ingresos, los ~9 dashboards de Finanzas/Producción) calculaba su propio año de campaña de forma aislada (`DEFAULT_YEAR = now.getMonth() >= 4 ? ...`, repetido en 9 archivos) y algunas tenían la finca hardcodeada a `'media_agua'` — incluso había un `<select>` deshabilitado mostrando "Media Agua" fijo en dos dashboards, vestigio de una conexión que nunca se completó.

**Caucete:** oculta de todos los selectores/formularios de alta (web+mobile) — el enum de Postgres y cualquier dato histórico que ya la use quedan intactos, cero migración de datos. Los Mimbres se queda.

**Selector global conectado de verdad:** los ~9 dashboards ahora inicializan su año de campaña y su finca desde `useContextStore()`, y se re-sincronizan cuando el selector del header cambia — el usuario sigue pudiendo acotar el rango o cambiar la finca localmente después, sin tocar el header. **Detalle técnico real encontrado en el camino:** el patrón obvio (`useEffect(() => setAnio(...), [campanaGlobal])`) viola el lint `react-hooks/set-state-in-effect` que este proyecto ya hace cumplir estricto (mismo lint que forzó el patrón de "ajustar estado durante el render" en la sesión del 08-19) — se resolvió con el patrón oficial de React para esto: comparar contra un `prevCampanaGlobal` guardado en estado y llamar `setState` directamente durante el render cuando cambia, en vez de en un efecto.

**Campo `finca` nuevo en `User`** (`backend/app/models/user.py`, migración aditiva, reusa el enum `Finca` que ya tenían `Egreso`/`Ingreso`, default `media_agua` para los usuarios existentes). Asignable desde Admin > Usuarios. En mobile, `encargado`/`regador`/`obrero` ya no eligen finca — ven fija la que se les asignó (forzada en cada `initAuth`, por si quedó otra cosa guardada de una sesión vieja); `gerencial`/`super_admin` mantienen el picker manual. El selector de Campaña se sacó de mobile — no había ninguna pantalla ahí que filtrara por campaña (los 5 tabs son wizards de carga, no listados históricos), era decorativo.

## 3. Buscador Ctrl+K desincronizado

`CommandPalette.tsx` tenía una lista `CMD_ITEMS` hardcodeada a mano, sin relación con la nav real — le faltaban 8 rutas que ya existían (Parcelas admin, Campaña, Cosecha, Metas, Cheques, Presupuesto, Mano de Obra, Flujo Anual). El listener de `Ctrl/Cmd+K` y la dependencia `cmdk` estaban bien, no era un bug de teclado. Ahora deriva los ítems de `frontend/lib/navigation.ts` (la misma fuente única del punto 1) — cualquier ruta nueva agregada a `SUB_NAVS` aparece sola en el buscador de ahora en más.

## Verificación

Probado en vivo con Claude in Chrome contra local (`uvicorn`+`npm run dev`): las 5 sub-pestañas de Documentación, el catálogo de válvulas/cuadrantes, el formulario de Admin > Usuarios con el campo Finca nuevo, y — el chequeo más importante — cambiar la Campaña en el header y ver que el Dashboard Finanzas trajo datos reales de esa campaña al toque (antes mostraba $0 fijo). Sin errores de consola en ninguna pantalla recorrida. 79/79 tests backend, `tsc`/`eslint` limpios en frontend y mobile.

## Deploy

3 commits separados a `main` (uno por cambio), autorizado explícitamente por Fausto para pushear/deployar sin pedir OK de nuevo si todo salía bien (se iba por 2 horas). Railway corrió la migración de `finca` en `users` sola. `vercel --prod` corrido. `eas update --branch production --environment production` (100% JS, sin build nuevo) — bundle verificado sin IP LAN.

**Pendiente:** que Fausto cierre/reabra la app mobile del todo (patrón OTA de siempre) para que encargado/regador/obrero vean la finca fija en vez del picker.

## Ver también

- [[2026-08-18-tabla-equivalencia-valvulas-cuadrante]] (catálogo de válvulas que alimenta la tabla de Riego en Documentación)
- [[2026-08-19-clima-termografo-pronostico-extendido]] (mismo lint `react-hooks/set-state-in-effect` ya documentado ahí)
- [[Sistema de Gestión Agrícola]]
