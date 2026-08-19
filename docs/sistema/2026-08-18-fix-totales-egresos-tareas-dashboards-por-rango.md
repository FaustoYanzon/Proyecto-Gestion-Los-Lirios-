---
tags: [sistema, sesion]
---

# 2026-08-18, segunda tanda — Fix de totales (Egresos/Tareas) + tarjetas de dashboard por rango de fecha

Continuación de la sesión de válvulas del mismo día. Fausto reportó dos cosas después de probar la app:

1. El total de Egresos y de Tareas diarias (~14M) no coincide con la tarjeta de Dirección en Inicio (~18M) para el mismo período.
2. Las tarjetas de los dashboards de Finanzas (Cumplimiento, Egresos, Ingresos, IVA) y Mano de Obra (Costo MO) quedan fijas al mes calendario actual, sin respetar el selector de rango de fecha que el propio dashboard ya tiene. Pidió además botones rápidos "Mes actual"/"Mes anterior".

## Diagnóstico de la diferencia de totales (confirmado en código, alta confianza)

Causa raíz: `EgresosTable.tsx`/`TareasTable.tsx` sumaban el array que les llega de `GET /finanzas/egresos/` y `GET /produccion/trabajo/` — ambos con `limit=100` por defecto (`backend/app/api/finanzas.py`, `backend/app/api/produccion.py`), ordenados por fecha descendente. Como ninguna de las dos pantallas pasa un `limit` explícito, el "total" mostrado terminaba siendo la suma de los **últimos 100 registros**, no de todo lo que matchea el filtro — en una finca con carga diaria, eso cubre solo 2-4 semanas de historial, mucho menos que una campaña completa. La tarjeta de Inicio, en cambio, suma con `SUM()` en SQL sin límite (`vw_flujo_mensual_real`). Confirmado con un test que carga 120 filas (>100) y verifica que el total sigue siendo el real, no el de las primeras 100.

**Fix:** ambas tablas ahora piden el total a un endpoint separado que suma en SQL, con los mismos filtros que la lista:
- `GET /finanzas/egresos/resumen/por-tipo` — ya existía pero estaba sin usar en el frontend (el tipo TS `ResumenTipo` ni siquiera coincidía con la forma real de la respuesta, nunca se había ejercitado). Extendido para aceptar `tipo`/`clasificacion`/`origen` además de `fecha_desde`/`fecha_hasta`/`finca`/`moneda` (antes solo soportaba estos últimos 4).
- `GET /produccion/trabajo/resumen/total` — nuevo, mismo patrón, mismos filtros que `GET /produccion/trabajo/`.

`TareasTable.tsx` además avisa cuando la tabla muestra menos filas que el total real ("mostrando X de Y registros — el total ya incluye todos") para que no vuelva a pasar desapercibido si se repite el patrón en otro lado.

## Tarjetas de dashboard por rango de fecha

`dashboard/finanzas/dashboard/page.tsx` y `dashboard/finanzas/mano-de-obra/page.tsx` ya tenían un selector de rango de meses (`mesDesdeIdx`/`mesHastaIdx`, posiciones en el orden de campaña mayo→abril) que alimentaba los gráficos, pero las tarjetas de KPI (Cumplimiento, Egresos, Ingresos, Jornales, Costo MO) filtraban aparte por `mes === mesActual` (mes calendario de hoy), ignorando el selector. Corregido: ahora agregan sobre el mismo rango ya cargado para el gráfico (`porMes`/`moMensual`), con el label de la tarjeta mostrando el mes único o el rango ("May–Ago") según corresponda. La tarjeta "Saldo acumulado" ya estaba bien (no se tocó). "Empleado del mes" queda deliberadamente como está — es una métrica de "este mes" por diseño, no del rango.

IVA (`GET /finanzas/arca/resumen-iva`) antes solo aceptaba un mes puntual (default: mes/año del servidor). Extendido a `anio_desde`/`mes_desde`/`anio_hasta`/`mes_hasta`, sumando `vw_kpi_iva` con comparación de tuplas `(anio, mes) >= (...) AND (anio, mes) <= (...)` — sintaxis válida en Postgres, verificada contra la vista real en producción (vacía porque los datos de prueba de ARCA se habían borrado en una sesión anterior, pero sin error de sintaxis).

Componente nuevo `MesRangeQuickButtons.tsx` (compartido entre los 2 dashboards) con los botones "Mes actual"/"Mes anterior" — calculan la posición de campaña correcta (mayo-diciembre pertenecen al año de campaña en curso, enero-abril al siguiente) y aplican `anio`+`mesDesdeIdx`+`mesHastaIdx` de una sola vez.

## Verificación

56/56 tests backend (5 nuevos en `test_resumenes_totales.py`, cubren el caso de >100 filas y los filtros nuevos). `tsc --noEmit` limpio en frontend. 3 errores de eslint preexistentes detectados de paso (`setState` síncrono en `useEffect` de paginación, ya documentados en `Bugs Conocidos.md` desde antes) — no introducidos por esta sesión, no tocados.

## Deploy — incidente de Railway

Commit `382901f`, pusheado. `vercel --prod` corrido — frontend en producción. **Backend bloqueado**: el deploy a Railway quedó en estado "Queued" con el mensaje "Deployment queued due to GitHub issues" durante más de 20 minutos (vs. <1 minuto en deploys anteriores del mismo día). Investigado con Claude in Chrome contra el dashboard de Railway: banner propio de la plataforma "Deployments are slow to progress. We are investigating the incident.", confirmado como incidente real y activo en [status.railway.com/incident/YYU63JUO](https://status.railway.com/incident/YYU63JUO) — afecta las 4 regiones (US East, US West, EU West, Southeast Asia), reportado 2026-08-18 23:19 UTC (pocos minutos después del push a las 23:11 UTC). No es un problema del repo, de la integración GitHub↔Railway, ni de la cuenta de Fausto — descartado también por status.githubstatus.com (todo operativo del lado GitHub). No hay forma de esquivarlo desde nuestro lado (ni `railway up` directo serviría, el cuello de botella es la etapa de inicialización del deploy en la plataforma, no el fetch de GitHub).

**Estado al pausar la sesión:** el sitio sigue funcionando normal (versión anterior del backend activa, sin caída) — solo falta que el deploy nuevo (con el fix de totales) quede activo una vez Railway resuelva el incidente. Fausto se fue a entrenar, vuelve en ~2 horas a confirmar.

## Ver también

- [[2026-08-18-tabla-equivalencia-valvulas-cuadrante]] (primera tanda del mismo día)
- [[Sistema de Gestión Agrícola]]
