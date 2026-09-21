---
tags: [sistema, sesion, feature, produccion, mapa, cosecha, dashboard]
---

# 2026-09-20 — Selector de temporada sincronizado, mapa por temporada, KPIs de Cosecha en el dashboard de Producción

Pedido de Fausto, siguiendo directo de la migración de Cosecha histórica del 09-19: 1) que el selector de temporada de cualquier pantalla sincronice a todas las demás; 2) que el Mapa también filtre por temporada (cosecha/fitosanitarios/riego); 3) corregir que el dashboard de Producción mostraba 1.178 t para la campaña 2025/2026 mientras Cosecha mostraba 2.555 t, más un gráfico de origen de los kilos (propio/tercero) y sacar el estado fenológico del dashboard; 4) mover "Progresión Semanal" de Cosecha al dashboard y borrar "Kg por Parral".

Antes de tocar código se pidió explícitamente analizar factibilidad y preguntar todo lo necesario — 4 preguntas con `AskUserQuestion`: mantener los selectores locales de cada pantalla pero sincronizados en las dos direcciones (no borrarlos); en el mapa, ocultar los widgets "en vivo" (fenología actual, cumplimiento de riego, riego en curso) cuando la temporada elegida no es la actual; "Kg totales" = total real (propio+tercero) con una card aparte para "Kg propios"; sacar el bloque "Estado Fenológico Actual" del dashboard de Producción.

## Selector de temporada — mismo bug en 13 pantallas, no sólo en las 3 mencionadas

Ya existía `useContextStore.campana` (store global Zustand) y `CampanaSwitcher` en el header, pero **13 pantallas** (Cosecha, Dashboard Producción, Dashboard Finanzas, Mano de Obra, Flujo + su desglose, Presupuesto, Metas, Plan Fitosanitario, Órdenes de Aplicación, Cumplimiento Fitosanitario, Insumos, Precios, Trazabilidad) repetían el mismo patrón: `useState` local inicializado desde el store global + un bloque "ajustado durante el render" (`prevCampanaGlobal`) que sólo sincronizaba GLOBAL→LOCAL. Cambiar la temporada en el dropdown de cualquiera de esas pantallas nunca tocaba el store global ni las demás — sincronización de una sola vía.

**Fix:** `useCampanaAnio()`, hook nuevo en `contextStore.ts` que lee y escribe directo sobre el store (sin estado local, sin lógica de sync manual) — el dropdown de cada pantalla queda ligado 1:1 al valor global, en ambas direcciones, por construcción. También se unificó el rango de años de cada dropdown (antes cada uno tenía su propia lista corta y desactualizada, algunas ni llegaban a 2023) con `buildCampanas(aniosAdelante)` compartida — `aniosAdelante=1` para las pantallas de planificación (Metas, Presupuesto, Plan Fitosanitario, Órdenes de Aplicación, Cumplimiento Fitosanitario, Insumos) que necesitan cargar la campaña siguiente antes de que empiece. Un par de pantallas (Dashboard Finanzas, Mano de Obra, Trazabilidad) tenían además un reset de rango de meses acoplado al cambio de campaña — se preservó ese efecto, ahora disparado por el cambio de `anio` en vez de por el viejo `prevCampanaGlobal`.

## Mapa por temporada

`FincaMap.tsx` no tenía selector propio — ahora lee `campana` del store global directo (consistente con la decisión de no agregar un 14º selector redundante). Cosecha y costo de mano de obra por parcela ya soportaban filtrar por temporada/rango de fechas; se agregaron dos capas de color nuevas, **"Riego"** y **"Fitosanitarios"**, agregando en el cliente el listado de `getRiegos`/`getFitosanitarios` filtrado por el rango de fechas de la campaña elegida (mismo patrón que ya usaba "Costo" — sin endpoint de resumen SQL nuevo, el volumen de una temporada es chico).

Los datos que son del presente por diseño (fenología actual, cumplimiento de riego del Ciclo de Campaña, riego en curso) dejan de pedirse (`enabled: esTemporadaActual`) fuera de la campaña actual, y los botones de esos modos de color quedan deshabilitados — si el modo activo deja de tener sentido, el mapa vuelve solo a "Tipo" (ajustado durante el render, mismo criterio que el resto del proyecto para evitar `useEffect` con `setState`). El panel de detalle por parcela (`ParcelPanel`, hacía su propio fetch de riego/fito/trabajo hardcodeado a "campaña actual") ahora arma su rango de fechas según `anio`/`esTemporadaActual` recibidos por props, y las etiquetas "— campaña actual" pasaron a ser dinámicas.

## La diferencia 1.178 t / 2.555 t — diagnóstico en dos vueltas

Primera pasada: consulta de sólo lectura contra Postgres **local** — `registros_cosecha` aparecía 100% `origen=propio` (cero terceros) para la temporada 2025. Conclusión errónea reportada a Fausto: el gap era sólo "propio sin parcela vinculada". Fausto aclaró que el Excel migrado sí tiene una columna Los Lirios/Terceros real (columna `ORIGEN` del Excel, ver migración del 09-19). Repitiendo la consulta contra **producción** (`.env.prod`, sólo lectura, sin escribir nada) cerró exacto:

- **2.555.211 kg total** (temporada 2025) = **1.764.474 kg propio** + **790.737 kg tercero**
- Del propio: **1.177.958 kg con parcela vinculada** (exactamente el 1.178 t que mostraba el dashboard, porque `vw_kpi_produccion_parcela` exige `parcela_id IS NOT NULL`) + **586.516 kg sin parcela** (Fausto confirmó dejarlo así — antes de la migración se trabajaba por variedad, no por parral, esos remitos legítimamente no tienen parcela)

**Lección para la próxima vez que haya que diagnosticar un número real de Los Lirios: la Postgres local no está sincronizada con producción para `registros_cosecha`** (posiblemente tampoco para otras tablas) — cualquier cosa que no cierre hay que verificarla contra `.env.prod` antes de reportarla como bug.

### Fix aplicado

- **"Kg totales"** (dashboard Producción) ahora sale de `cosechaTotales.kg_total` (todos los registros, coincide con Cosecha).
- **Gráfico nuevo "Origen de los kilos"** (barra de 2 segmentos, mismo estilo que "Mix por destino" ya existente), alimentado por `resumen_por_origen` — campo nuevo en `CosechaTotalesResponse` (backend), calculado sobre el `origen` que ya viene bien migrado del Excel. No hizo falta tocar esa parte, ya estaba correcta desde el 09-19.
- **Ida y vuelta con Fausto después del primer deploy:** preguntó si "propio sin parcela" se reflejaba en "Kg propios". No — esa card salía de `vw_kpi_produccion_parcela` (sólo con parcela). Corregida para mostrar el total real de `origen=propio` (con y sin parcela, 1.764,5 t) — ahora coincide con la barra "Propio" del gráfico de origen. El número sólo-con-parcela (1.178 t) se sigue usando internamente para Kg/ha (necesita superficie para calcularse).
- Confirmado que **Kg/ha y Kg/variedad ya excluían los terceros correctamente** desde el diseño de la migración del 09-19 (terceros siempre `parcela_id NULL`, esas vistas exigen `parcela_id IS NOT NULL`) — sin cambios ahí.
- Se sacó el bloque **"Estado Fenológico Actual"** del dashboard (dato del presente, no de la temporada seleccionada — ya visible en el Mapa).

## Cosecha

"Kg por Parral" eliminado. "Progresión Semanal" se movió al dashboard de Producción (gráfico nuevo, distinto del "Avance acumulado" que ya existía ahí — uno es acumulado temporada-vs-temporada anterior, el otro es semanal discreto de la temporada elegida). Cosecha quedó con KPIs + tabla nomás.

## Verificación

**Esta sesión NO se pudo probar clickeando en el navegador** — la extensión de Claude in Chrome no conectó en ningún momento (4+ intentos a lo largo de toda la sesión, incluso después de que Fausto la abrió a pedido explícito). Segunda sesión seguida con este problema (también pasó el 09-19) — detalle y recomendación de escalarlo si se repite una tercera vez en la memoria de Claude Code (`feedback_local_testing_before_deploy`, no vive en esta bóveda).

Suplido con: `tsc --noEmit` y `eslint` limpios en los 23 archivos tocados; Next.js compilando las 14 rutas afectadas sin error (forzado con `curl` contra cada ruta); lógica de backend validada con queries de sólo lectura contra producción real (números exactos arriba).

**Incidente de entorno local, variante peor del ya documentado:** el proceso en el puerto 8000 local servía código viejo y ni `netstat` (que sí lo veía, PID 27700) ni `Get-Process`/`Get-CimInstance` de PowerShell lo encontraban — y **siguió sirviendo código viejo después de que Fausto confirmó haber reiniciado su backend**, probablemente porque el proceso real corre en WSL2/contenedor y Windows sólo ve el forwarding de puerto. Sorteado levantando un backend de verificación propio en el puerto 8737 (`backend/venv312`, no `backend/venv` que le falta `fastapi`) para confirmar el schema/lógica nueva sin depender del puerto 8000.

## Deploy

Ante el bloqueo de verificación visual, decisión explícita de Fausto: "pushea todo a producción y main, lo pruebo de ahí". Commit `aab7116` (23 archivos: 2 backend + 21 frontend — se dejaron afuera a propósito `mobile/eas.json` y cambios pendientes en `docs/` de otra sesión, sin contexto para incluirlos a ciegas). Railway auto-desplegó. `vercel --prod` corrido (`https://frontend-six-jade-79.vercel.app`), build limpio, las 14 rutas tocadas aparecen en el output de build.

**Pendiente real: Fausto todavía no confirmó visualmente en producción** — la próxima sesión arranca para eso, y para diagnosticar por qué la extensión de Chrome no conectó en las últimas dos sesiones seguidas.

## Ver también

- [[Sistema de Gestión Agrícola]]
- [[Arquitectura]]
- Migración de Cosecha histórica 2024-2026 (2026-09-19, sin bitácora propia — detalle en la memoria de Claude Code, `project_loslirios.md`, sección "Estado 2026-09-19"): agregó el campo `origen` y los datos que esta sesión terminó de mostrar bien.
- Metodología "probar en local antes de deployar" — memoria de Claude Code, `feedback_local_testing_before_deploy` (no vive en esta bóveda).
