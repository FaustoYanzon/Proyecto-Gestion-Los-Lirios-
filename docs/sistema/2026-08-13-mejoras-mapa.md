---
tags: [sistema, sesion]
---

# 2026-08-13 — Mejoras al mapa (web + mobile): fenología, cuadrantes, mm/año, riego en curso

Fausto pidió 5 mejoras al mapa (web y mobile), la quinta ("vincular riegos en curso a cañerías/válvulas/cuadrantes") con pedido explícito de análisis crítico de viabilidad. Se investigó a fondo con 3 agentes en paralelo (mapa web, mapa mobile, backend) antes de planear, y un agente de diseño para pulir el punto 5. Plan presentado y aprobado en modo plan formal antes de tocar código.

## Diagnóstico previo (research)

- El mapa tiene **dos sistemas de estado fenológico/campaña en paralelo**: el viejo (`fenologia.py`/`EstadoFenologico`: brotación/floración/cuaje/envero/**madurez**/cosecha/**latencia**) y el nuevo, construido el 07-20/22 (`ciclo_campana.py`/`EstadoCampana`: brotación/floración/cuaje/**cierre de racimo**/envero/cosecha/**post-cosecha**). El modo de color "Fenología" del mapa (web y mobile) leía del viejo — de ahí la confusión de Fausto. El dato correcto ya se pedía en `FincaMap.tsx` (prop `estadoCampanaByVariedad`) pero nunca se usaba para pintar.
- Los modos "Riego" (objetivo anual fijo, 6.000.000 L/ha/año) y "Cumplimiento riego" (objetivo por estado de campaña actual) compartían la misma función de color y una leyenda casi idéntica — confirmado como confusión real, no solo percibida.
- La capa "Cuadrantes de Riego" tenía `interactive: false` explícito en ambas plataformas — por eso el click caía siempre sobre el parral de abajo (cañerías y válvulas sí eran interactivas, con su propio popup).
- `RiegoEnCurso.valvula` es un **índice posicional por parcela** (ej. "1,2" = válvula 1 y 2 de esa parcela puntual), no el mismo espacio de nombres que usa el GeoJSON de válvulas físicas (`"Nombre de Valvula"`: "SU1", "21", "BV1" — 57 válvulas reales en toda la finca). No existe ninguna tabla de equivalencia hoy entre ambos.

## Decisiones tomadas (avisadas al plan, no preguntadas una por una)

1. **Fenología → lee del Ciclo de Campaña nuevo.** El endpoint viejo (`/produccion/fenologia/estado-actual`) queda intacto — sigue alimentando "tareas recomendadas" en Inicio (ambas plataformas) y la página Ciclo de Campaña, que no formaban parte del pedido.
2. **Modo "Riego" (anual) eliminado**, queda solo "Cumpl. riego". El panel de detalle de parcela sigue mostrando el objetivo anual (ahora en mm) — es una métrica distinta y útil, no se sacó sin que lo pidieran.
3. **Objetivo de agua en mm/año**: 600 mm/año, derivado de la constante existente (`LITROS_OBJETIVO_ANUAL_POR_HA / 10.000`), no un número nuevo. Mobile no tenía esta barra de objetivo en absoluto — se agregó para paridad con web (no solo cambio de unidad).
4. **Cuadrantes clickeables**: mismo popup genérico que ya usan cañerías/válvulas (dump de propiedades del GeoJSON: Nombre de Cuadrante, Válvula Correspondiente, Cabezal). No es el panel grande tipo hoja lateral de los parrales — eso sería un trabajo aparte si hiciera falta.
5. **Riego en curso — resaltado a nivel parral, no cuadrante/cañería/válvula.** Decisión central del análisis crítico pedido: pintar a nivel cuadrante/válvula sería impreciso hoy (un cabezal agrupa más de una docena de cuadrantes; sin la tabla de equivalencia, se pintaría de más) — en una herramienta de campo eso es un riesgo operativo real, no solo estético. `RiegoEnCurso.parcela_id` es el único identificador que conecta exacto y sin ambigüedad con algo que el mapa ya dibuja. Poll cada 30s de `GET /produccion/riego/en-curso`, borde celeste punteado sobre el parral exacto, compuesto encima del modo de color activo (no lo reemplaza). Quedó explícitamente afuera (no rechazado, pospuesto a decisión futura): resaltado a nivel cabezal (impreciso) o preciso por cuadrante/válvula (necesita antes una tabla de equivalencia armada a mano, o cambiar el flujo de "iniciar riego" para elegir la válvula real por nombre).

## Detalle técnico — mobile, hallazgo de proceso importante

El mapa mobile es Leaflet dentro de un WebView (HTML/JS armado como string en `mapa.tsx`, no componentes nativos). El primer intento de implementación del punto 5 conectaba `riegosEnCurso` directo al armado del HTML inicial (`buildMapHTML`) — **se identificó a tiempo que esto recargaría el WebView completo cada 30 segundos** (perdiendo zoom, modo de color y capas activas del usuario), porque cambiar el prop `source.html` de un WebView fuerza una navegación nueva. Corregido usando `injectJavaScript` (mismo mecanismo que ya usaba el código para "deseleccionar" al cerrar el panel) para empujar el dato al JS ya cargado sin reconstruir el HTML — patrón ya usado en el archivo, no algo nuevo.

## Verificación

`tsc --noEmit` limpio en frontend y mobile en cada punto. Verificado en vivo en producción con Claude in Chrome (los 5 puntos, incluyendo iniciar un riego de prueba real para confirmar el resaltado celeste punteado apareciendo y desapareciendo correctamente) — datos de prueba (riego + Trabajador auto-creado "ZZZ Test Mapa Claude") borrados sin dejar rastro. Mobile no se pudo probar en vivo en esta sesión (sin acceso a dispositivo/emulador) — confianza basada en `tsc` limpio + patrón ya establecido en el archivo (`injectJavaScript`), a confirmar por Fausto tras el `eas update`.

## Deploy

Commit `1165832`, pusheado. `vercel --prod` corrido. `eas update --branch production --environment production` (cambio 100% JS, sin build nuevo necesario).

## Ver también

- [[Sistema de Gestión Agrícola]]
