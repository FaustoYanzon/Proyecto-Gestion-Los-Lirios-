---
tags: [sistema, sesion, feature, fitosanitarios, stock, insumos]
---

# 2026-09-08 — Fertilizantes, stock de insumos, plan y cumplimiento fitosanitario

Pedido inicial de Fausto: "empecemos a desarrollar la parte de fertilizantes y gestión de stock". Arrancó analizando un Excel real del agrónomo (`Programa aplicacion fitosanitario.xlsx`, hoja "Programa 26-27") y terminó en tres fases, todas en producción el mismo día.

## Análisis de partida

El Excel del agrónomo programa las aplicaciones por variedad agrupando en 4 columnas: Red Globe, Flame, Fiesta y "Tintas" (todo lo demás — bonarda, syrah, aspirant, sultanina). El sistema ya tenía `RegistroFitosanitario` (aplicación real cargada en el campo) pero con `producto_nombre` de texto libre y sin ningún concepto de stock. El objetivo explícito de Fausto: que cargar una aplicación real descuente stock automáticamente (`dosis × hectáreas del parral`), y más adelante poder comparar lo planificado contra lo real.

## Fase 1 — Catálogo de Insumos + stock

- Modelo `Insumo` (nombre, unidad `kg`/`lt`, categoría libre, `stock_actual`) + ledger `MovimientoStock` (tipo ingreso/egreso_aplicacion/ajuste, trazable).
- `RegistroFitosanitario` gana `insumo_id` (FK), `unidad` (congelada) y `cantidad_total` (congelada = `dosis_por_ha × superficie_ha` de la parcela). El campo viejo `dosis_lt_ha` se **renombra** a `dosis_por_ha` (varios productos del Excel son en kg, no L/ha) vía `alter_column` en la migración — no drop+add, para no perder la dosis de los registros históricos.
- Al crear/editar/borrar una aplicación real, el stock del insumo se descuenta/revierte automáticamente en la misma transacción — verificado que editar la dosis no duplica el descuento (revierte el movimiento viejo antes de aplicar el nuevo).
- Combobox nuevo — `InsumoSelect.tsx` (web) / `InsumoPicker.tsx` (mobile) — con el mismo criterio ya probado para Trabajador: solo elegir de la lista, o "+ Agregar nuevo insumo" con aviso de nombres parecidos + segundo clic. Reuso directo del patrón, cero diseño nuevo de UX.
- Pantalla nueva de administración de Insumos (alta, edición, reposición manual de stock).
- Defensa de servidor: `POST /insumos/` rechaza nombres duplicados (sin tildes/mayúsculas), mismo helper `_normalizar_nombre` extraído a `app/core/normalizacion.py` y reusado por `trabajadores.py`.

## Sección "Inventarios" en la barra lateral

Pedido aparte de Fausto después de ver la Fase 1 funcionando: sacar Insumos de Documentación y darle su propia sección en la barra lateral, junto a "Producto Terminado" — placeholder en blanco a propósito, hasta que Fausto defina cómo quiere llevar el stock de uva/pasa/mosto cosechado.

## Fase 2 — Plan Fitosanitario, rediseñado por el propio Fausto

Mi boceto original planeaba importar el Excel automáticamente, agrupando en "Tintas" como el Excel. Fausto lo frenó y lo cambió, con dos decisiones de fondo:

1. **Sin importación de Excel — carga a mano, temporada tras temporada.** Mismo espíritu que Metas de Producción: sincronizado con el selector global de campaña (`useContextStore`/`campanaToAnio`), cada temporada arranca en blanco.
2. **Sin agrupar en "Tintas" — variedad real por variedad** (`VariedadUva`: flame, red_globe, fiesta, bonarda, sultanina, syrah, aspirant). Que el agrónomo agrupe en su papel es su forma de comunicarlo, no cómo tiene que vivir el dato — si mañana una de esas variedades necesita algo distinto, el sistema ya lo permite sin pelear contra una agrupación fija.

Para no perder productividad por la granularidad más fina, al cargar una fila se puede marcar a qué otras variedades también aplica — se tipea el producto/dosis una vez y se crean filas independientes (después se editan/borran una por una, sin magia oculta). Cada fila lleva número de aplicación explícito (ronda 1, 2, 3... como en el Excel) además del mes. Solo gerencial+ carga/edita el plan; el resto de los roles lo puede leer como referencia al cargar Fitosanitarios reales en el campo.

Diseño de la UI: no calca literal la tabla plana de Metas (que es un solo campo por fila) — es una tabla por variedad (tabs) con modal de alta/edición, más cercano al patrón de Insumos/Trabajador que al de Metas, porque acá cada fila tiene 5-6 campos.

## Fase 3 — Cumplimiento + necesidad de insumos vs. stock

Pregunta clave antes de diseñar: ¿cómo sabe el sistema que una aplicación real cumple una fila del plan? Dos caminos posibles — vínculo manual al cargar la aplicación real (exacto, pero toca el formulario de Fitosanitarios ya validado en producción) o matching automático (sin tocar nada, pero es una heurística). **Fausto eligió matching automático, sin tocar el formulario.**

Algoritmo: cruza variedad de la parcela + insumo + fecha dentro de la ventana de campaña (mayo→abril). Cuando el mismo insumo tiene varias rondas planificadas para una variedad, la N-ésima aplicación real de ese insumo en una parcela (por orden cronológico) cubre la N-ésima ronda planificada — heurística razonable, no infalible si las rondas se aplican fuera de orden en una parcela puntual. Limitación explicada a Fausto de entrada, no descubierta después.

Página nueva "Cumplimiento Fitosanitario": avance por variedad (parcelas aplicadas/total, barra de %, estado pendiente/parcial/completo) y una tabla agregada de necesidad de insumo vs. stock (con alerta de faltante) — esto reemplaza directamente la tabla rota (`#REF!`) que el Excel del agrónomo intentaba calcular al final.

**Verificado en vivo el ciclo completo:** cargué una aplicación real que matcheaba una fila del plan → el cumplimiento subió de 0/2 a 1/2 (50%, parcial) y la necesidad de insumo bajó exactamente lo aplicado, en tiempo real, con el stock ya descontado por la Fase 1.

## Verificación y deploy

129/129 tests backend (16 nuevos entre las 3 fases). Cada fase probada de punta a punta en el navegador local (Claude in Chrome) con datos reales antes de deployar — regla ya establecida del proyecto. Deploy por fase: Railway (migración en Fase 1 y 2, Fase 3 no tocó el esquema) + `vercel --prod`. Mobile (`eas update`) solo en la Fase 1, única que tocó el wizard de carga de Fitosanitarios — Fases 2 y 3 son pantallas de planificación/gerencial, no viven en mobile.

**Dato nuevo para [[feedback_classifier_db_writes]]:** ninguno de los deploys de esta sesión (migraciones locales, `railway` ni `vercel --prod`, corridos varias veces) fue bloqueado por el classifier de Claude Code — a diferencia de sesiones anteriores donde `vercel --prod` se bloqueaba de forma consistente.

## Hallazgo operativo (no es un bug de la app)

Durante la verificación local de la Fase 3, el backend empezó a responder con código viejo de forma intermitente (404/405 en rutas que sí existían en el archivo fuente). Causa real: al reiniciar `uvicorn --reload` varias veces sin matar bien el árbol de procesos, quedaron **workers huérfanos** (hijos de un proceso "reloader" ya muerto) todavía bindeados al puerto 8000 — Windows no libera el socket solo, y dos procesos con versiones distintas del código contestaban al azar en el mismo puerto. Diagnóstico real: `netstat -ano | grep :8000` (no confiar en `Get-CimInstance ... -Filter "CommandLine like '%uvicorn%'"` corrido desde una shell bash — el propio comando contiene la palabra "uvicorn" y se auto-matchea) + `Get-Process -Name python` para encontrar los PIDs reales, `taskkill //F //PID <pid>` para cada uno. Ver [[feedback_local_testing_before_deploy]].

## Ver también

- [[Sistema de Gestión Agrícola]]
- [[Arquitectura]]
- [[2026-09-07-normalizacion-trabajadores-combobox]] (patrón de combobox reusado acá para Insumo)
