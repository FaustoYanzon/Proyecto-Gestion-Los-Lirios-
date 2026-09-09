---
tags: [sistema, sesion, feature, refactor, fenologia, migracion]
---

# 2026-09-08 — Reorden del Inicio, campanita de alertas y unificación de estados fenológicos

Sesión larga con tres pedidos de Fausto que terminaron en un cambio de modelo de datos.

## Campanita de alertas

Las alertas genéricas (riego atrasado, carencia fitosanitaria, recordatorio ARCA, parcelas sin estado) vivían como una tarjeta más en el Inicio (`Alertas.tsx`). Se movieron a la campanita del header (`NotificacionesBell.tsx` nuevo, `Alertas.tsx` borrado) — mismo comportamiento de buzón (tildar = descartar 48h), pero **sin el botón de cancelar** (✕), que hacía exactamente lo mismo que tildar y no aportaba nada. Riegos en curso pasó a ocupar el espacio que dejó libre Alertas en el Inicio (dejó de estar colapsado a "solo el primero").

## Reorden del Inicio

Iteración con Fausto — el primer orden que probé no era el que quería. Orden final:
- **Gerenciales:** Dirección (KPIs + gráfico) → notificación de Fenología → Mapa + Clima/Riegos.
- **Resto de roles** (sin Dirección): Fenología arriba de todo, después Mapa + Clima/Riegos.

## Unificación de estados fenológicos — el cambio grande

Pedido de Fausto en dos mensajes: primero pidió que investigáramos un supuesto bug ("todos los parrales aparecen en cosecha") que, al revisar producción en vivo, resultó no ser un bug — el sistema mostraba "Post-Cosecha" correctamente. Lo que en realidad quería era una página de referencia para no tener que recordar las fechas de memoria. Ahí surgió el pedido real: **unificar los nombres de estado fenológico** que usa Fenología/Ciclo de Campaña con los que ya pinta el mapa — hasta ahora eran dos sistemas separados:

- `app.core.fenologia` (viejo): 10 fases finas por variedad (Reposo invernal, Lloro, Brotación, Floración, Cuaje, Grano de arveja, Envero, Madurez, Cosecha, Post-cosecha), calendario propio por variedad basado en el informe INTA.
- `app.core.ciclo_campana` (el que ya pintaba el mapa): 7 estados, un solo calendario igual para todas las variedades (Brotación, Floración, Cuaje, **Cierre de Racimo**, Envero, Cosecha, **Post-Cosecha**), pensado originalmente solo para medir cumplimiento de riego.

Fausto pidió explícitamente eliminar el calendario fino por variedad y dejar **un solo calendario** (el del mapa) en todos lados, conservando la posibilidad de confirmar un estado a mano por variedad "como estaba antes" (la pestaña Ciclo de Campaña).

### Decisiones de mapeo (acordadas con Fausto antes de tocar la DB)

- Reposo invernal + Lloro + Post-cosecha (los tres colapsaban ya en "Latencia") → **Post-Cosecha** único, cubre todo el invierno hasta la próxima Brotación.
- Grano de arveja (mostraba "Cuaje") → **Cierre de Racimo**, que ya existía en el mapa para ese mismo momento agronómico (bayas tocándose entre sí, justo después del cuaje).
- Madurez (sin equivalente en el mapa) → se fusiona en **Envero**, que en el calendario del mapa ya se extiende hasta el inicio de Cosecha.

### Implementación

- **Migración de DB en 2 pasos** (Postgres no deja usar un valor de enum recién agregado en la misma transacción): `f3665520fad8` agrega `cierre_racimo`/`post_cosecha` al enum `estadofenologico`; `703724978020` migra las filas existentes (`madurez`→`envero`, `latencia`→`post_cosecha`). `madurez`/`latencia` quedan en el enum de Postgres sin uso (no se pueden sacar sin recrear el tipo) — el modelo Python los deja documentados como legacy.
- `fenologia.py` reescrito: se fue el calendario por variedad (`CALENDARIO_FENOLOGICO`, `FaseOperativa`, `calcular_fase`) — ahora delega 100% el cálculo del estado a `ciclo_campana.calcular_estado_actual()`. Lo que sigue siendo por variedad: tareas recomendadas (re-mapeadas a los 7 estados nuevos, con las listas de las fases fusionadas concatenadas) y riesgo de oídio.
- `/produccion/fenologia/estado-actual` y `/produccion/fenologia/calendario` (endpoint nuevo de esta sesión, agregado antes de saber que iba a cambiar de forma) reescritos para usar el calendario único; el override manual por variedad (tabla `CicloCampana`, ventana de 45 días) sigue exactamente igual que antes.
- Web (`campana/page.tsx`) y mobile (`estado-campana.tsx`, `lib/types.ts`) actualizados a los 7 estados nuevos.
- Página nueva **Documentación → Fenología**: como el calendario ahora es único, quedó una sola tabla (no una por variedad) con el estado de hoy resaltado y un link directo a Ciclo de Campaña para confirmar un estado a mano.

### Verificación

129/129 tests de backend, TypeScript limpio en frontend y mobile. Probado en vivo contra Postgres local después de correr la migración: cambié "Aspirant" a mano a "Cierre de Racimo" desde Ciclo de Campaña (POST 201, enum nuevo acepta el valor), se vio reflejado con la tarea recomendada correcta, reseteado después. Migración en producción no requiere paso manual — Railway corre `alembic upgrade head` solo en cada push a `main`.

### Hallazgo de proceso (recurrencia)

Volvió a pasar lo del `uvicorn --reload` con workers huérfanos sirviendo código viejo (ver [[Bugs Conocidos]]) — esta vez lo noté porque el endpoint devolvía "Lloro"/"Latencia" (valores que ya había borrado del código) después de haber guardado los cambios. `taskkill /F /IM python.exe /T` + reiniciar. Para el resto de la sesión levanté el servidor **sin** `--reload` para evitar repetirlo mientras verificaba en el navegador.

## Ver también

- [[Bugs Conocidos]]
- [[2026-09-08-fix-zindex-mapa-sidebar]]
- [[Arquitectura]]
