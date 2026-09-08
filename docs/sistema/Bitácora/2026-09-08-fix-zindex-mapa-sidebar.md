---
tags: [sistema, sesion, bugfix, frontend, estetica]
---

# 2026-09-08 — Mapa tapando selector de campaña y tooltips de la barra lateral (recurrencia del z-index)

Pedido de Fausto: reordenar los íconos de la barra lateral (Inicio, Mapa, Producción, Finanzas, Inventarios, Trazabilidad, Documentación) y arreglar que "el mapa se ha vuelto a poner delante del selector de campaña" y que el tooltip del nombre del ícono al hacer hover queda detrás del mapa.

## Reorden de íconos

Cambio directo en `ALL_NAV` (`frontend/lib/navigation.ts`) — Finanzas pasó a estar antes de Inventarios/Trazabilidad. Admin no se mencionó, quedó al final donde ya estaba.

## El z-index: por qué volvió a pasar

Esto ya se había arreglado el 2026-07-14 (ver [[Bugs Conocidos]] § Riesgos/Resueltos, "Filtros de Finca/Campaña tapados por el mapa"), subiendo el z-index de esos filtros a `z-[1000]` para empatar con los panes de Leaflet. El fix de esa vez era un parche de valores, no una separación estructural — y en algún momento posterior los controles internos del mapa (`FincaMapInner.tsx`: chips de modo de color, leyenda, panel de detalle de parcela) también quedaron en `z-[1000]`/`z-[2000]`, empatando o superando de nuevo al header. Por eso "volvió a pasar": cualquier z-index nuevo agregado adentro del mapa en el futuro puede volver a ganarle al header/sidebar si se sigue jugando con valores sueltos.

**Primer intento (insuficiente):** le agregué `relative z-30` al `<aside>` (sidebar) y `relative z-20` al `<header>` en `frontend/app/dashboard/layout.tsx`, asumiendo que un ancestro posicionado con z-index "contiene" a todos los z-index internos de sus hermanos. Error de concepto: eso solo agrupa el propio subárbol de ese ancestro. Los elementos con z-index dentro de `<main>` (donde vive el mapa) no tenían ningún ancestro que armara un contexto de apilamiento propio, así que sus `z-[1000]`/`z-[2000]` seguían comparándose directo en el contexto raíz contra el z-20/z-30 del header/sidebar — y ganaban por ser números más altos. Fausto probó en local y confirmó que seguía igual (ambos problemas).

**Fix real:** agregar `isolate` (además de `relative`) a `<main>` en el mismo layout. `isolation: isolate` crea un contexto de apilamiento nuevo para todo `main`, así que TODOS los z-index internos del mapa quedan atrapados adentro de ese contexto y se comparan entre sí, no contra el header/sidebar — el conjunto completo de `main` compite hacia afuera como una sola unidad, por debajo del z-20/z-30 del header y la sidebar. Confirmado por Fausto en local: "ahora quedó perfecto".

**Para no repetir esto una tercera vez:** cualquier elemento superpuesto nuevo dentro del mapa puede seguir usando los z-index que quiera (1000, 2000, lo que sea) sin volver a pisar el header/sidebar, porque `isolate` en `<main>` los contiene estructuralmente. Si en el futuro aparece el mismo síntoma en otra pantalla con overlays (no solo el mapa), el patrón a aplicar es el mismo: `isolate` en el contenedor de contenido (`<main>` o el wrapper de esa página), no subir números de z-index a mano.

## Ver también

- [[Bugs Conocidos]]
- [[2026-07-14-finanzas-ingresos-y-fixes-piloto]] (fix original, insuficiente)
