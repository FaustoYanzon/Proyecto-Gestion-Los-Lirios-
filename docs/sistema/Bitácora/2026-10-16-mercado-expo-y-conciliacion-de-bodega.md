---
fecha: 2026-10-16
tags: [sistema, bitacora, produccion, despacho, bodega, remitos]
---

# Bitácora 2026-10-16: mercado interno / exportación y conciliación de bodega

Cierra los pendientes que dejó [[2026-10-10-despacho-de-cosecha]] y [[2026-10-15-entrega-de-pasa-por-bines]].

## Decisiones (Fausto, 2026-10-16)

- **Pesaje en destino: solo bodega.** El comprobante de bodega (SUV + kg recibidos) ya es el pesaje en destino y se carga cuando llega el camión. Para fresco a comprador el único documento es el FRE del despacho; para pasero no se pesa en destino. **No se construyó nada nuevo.**
- **MI vs EXPO: se elige en cada despacho a comprador** (selector Mercado interno / Exportación, sin valor por defecto en las apps). Un mismo comprador puede recibir de los dos mercados.
- **Conciliación: pantalla de diferencias** (sin alertas automáticas por ahora).

## Implementación

- `DespachoCosechaCreate.mercado` (`interno` | `exportacion`, opcional). Con `para=comprador` y `exportacion` la cosecha queda con destino `EXPO`; si no llega el campo (clientes viejos) queda `MI`, como hasta ahora. Con otro "Para" el campo se rechaza (422). La clave de idempotencia distingue el mercado: reenviar el mismo envío es idempotente, cambiarlo da 409. El remito sigue siendo FRE.
- Web (`DespachoCosechaModal`) y mobile (wizard de Cosecha): selector de mercado obligatorio al elegir "Uva en fresco"; el paso de confirmar lo muestra.
- `GET /remitos/conciliacion-bodega` (filtros `desde`, `hasta`, `comprador_id`, `estado` = todos / pendientes / conciliados / con_diferencia). Una fila por remito BOD con kg despachados, SUV, kg recibidos, diferencia en kg y %. Los totales de diferencia comparan solo remitos con comprobante; los pendientes se cuentan aparte (cantidad y kg sin confirmar).
- Web: pantalla **Alta de producción → Bodega → Conciliación** con tres tarjetas (despachado, pendientes, diferencia), tabla con los pendientes resaltados y "Cargar cuando llegue" directo desde la fila. El modal del comprobante se extrajo a `components/alta-produccion/ComprobanteBodegaModal.tsx` y lo comparten Remitos y Conciliación.
- No hay migración: `destino` ya admitía `EXPO`.

## Pruebas

- Backend: 235 tests OK (mercado interno / exportación / sin dato / "solo comprador" / idempotencia, y conciliación con filas, totales, los cuatro filtros y el caso vacío).
- `tsc` web y mobile sin errores; eslint limpio en lo tocado.
- Local contra copia de prod: 3 remitos BOD (2 con comprobante, 1 pendiente) → la pantalla muestra −50 kg sobre 15.000 (−0,33 %), un pendiente de 2.000 kg; cargando el comprobante desde la fila los pendientes pasan a 0 y la diferencia a −70 kg sobre 17.000. El FRE a exportación quedó con destino `EXPO`. El selector de mercado se vio en el modal web.
- **No probado:** el wizard mobile con el selector de mercado (solo compila).

## Pendiente

- Alertas de conciliación (remitos sin comprobante pasados X días, diferencias grandes): descartadas por ahora; se retoman si la pantalla no alcanza.
- Los reportes de cosecha por destino todavía no separan MI de EXPO en pantalla; ahora que el dato existe se puede agregar.
