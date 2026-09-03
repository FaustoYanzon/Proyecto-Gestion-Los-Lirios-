---
tags: [proyecto, sistema, desarrollo]
---

# Sistema de Gestión Agrícola

## Objetivo

Reemplazar/complementar los workflows manuales de Excel y Power BI con un sistema web + mobile integrado para la gestión operativa de Los Lirios SA.

## Módulos

| Módulo | Backend | Frontend | Mobile |
|---|---|---|---|
| Auth / Usuarios | ✅ | ✅ | ✅ |
| Parcelas | ✅ | ✅ | parcial |
| Finanzas (ingresos/egresos/cheques) | ✅ | ✅ | — |
| Producción (tareas/riego/fito) | ✅ | parcial | parcial |
| Dashboards analíticos | — | en curso | — |
| Trazabilidad (ficha por parcela + carta PDF) | ✅ | ✅ | — (solo ícono registrado) |
| Deploy / infraestructura | ✅ producción (piloto) | ✅ producción (piloto) | ✅ build distribuido (piloto) |

## Estado actual (2026-07-11 — piloto de prueba en producción)

- **Deploy: listo, en producción.** Los 5 bloqueantes de [[Checklist Deploy de Prueba (Semana Piloto)]] se resolvieron el 2026-07-10/11, junto con 7 problemas adicionales no anticipados (driver async de Postgres, root directory del monorepo, puerto del proxy de Railway, symlinks de Obsidian rompiendo el build de EAS en Windows, lockfile de mobile desincronizado, conflicto de peer dependency `react-dom`/`react`, entre otros). Backend en Railway, frontend en Vercel, mobile con build EAS distribuido a testers. Detalle completo: [[2026-07-11-deploy-piloto-completado]].
- **Backend: sólido.** Hardening de seguridad completado y verificado línea por línea (ver [[Arquitectura]] § Seguridad): secretos rotados y fuera de git, JWT migrado a PyJWT, rate limiting por IP + por username, invalidación de sesión vía `token_version`, autorización por rol server-side confirmada en rutas sensibles, suite de tests de regresión 11/11 passing **contra Python 3.12.10, la misma versión del deploy real**. Los 3 bugs críticos viejos y el dashboard de producción "roto" ya están resueltos (ver [[Bugs Conocidos]] § Resueltos). Bug adicional encontrado y resuelto durante el deploy: `app/models/__init__.py` no registraba el modelo `Trabajador`, rompiendo scripts standalone (`seed.py`).
- **Frontend: funcionalmente completo para el alcance actual, en producción.** Dashboards de finanzas, mano de obra y producción reconstruidos (commit `8691260`, "Cambio 5": KPIs D1-D4, presupuestos, metas de producción). `npm run build` compila limpio. Rutas admin (usuarios/parcelas) y mapa ya no son stubs. Gaps: TareaForm sin campo `finca` ni selector de trabajador, sin error boundaries, lint con errores no fatales.
- **Mobile: build de piloto distribuido, con OTA activado desde 2026-07-12.** Expo 54 / React Native 0.81, apunta al backend de Railway vía `eas.json`. `expo-updates` configurado (ver [[2026-07-12-ota-y-ux-cargar-tarea]]) — cambios de puro JS/UI ya se publican con `eas update`, sin rebuild ni reinstalación. Se rediseñaron 5 puntos de UX en el formulario de "Cargar Tarea" (ubicación agrupada por tipo, unidad con submenú, cantidad por teclado numérico, confirmación sin pantalla intermedia, cancelar wizard con "X").

## Estado actual (2026-07-14 — primera semana piloto, primeros bugs reales)

Detalle completo: [[2026-07-14-finanzas-ingresos-y-fixes-piloto]]. Resumen:

- **Ingresos rediseñado** de venta-de-uva-por-kilo a libro general de cobros ("BD COBROS"), con `estado` (enum `no_registrado`/`facturado`) y `cuenta_destino` (combobox extensible, "+ Agregar nueva..."). Nueva pantalla de seguimiento de cheques (`/dashboard/finanzas/cheques`).
- **Bug de sesión (F5/pestaña nueva) resuelto:** root cause era `app/providers.tsx` sin llamar a `initAuth()`. Agregado guard de auth en `dashboard/layout.tsx`.
- **Históricos cargados a producción** (591 cosechas, 144 egresos, 370 presupuestos) — nunca se habían aplicado desde el deploy inicial, por eso el panel "Dirección" de KPIs en Inicio se veía vacío.
- **Hallazgo operativo importante: Vercel no auto-despliega en este proyecto.** Railway sí. Cualquier cambio de frontend necesita `vercel --prod` manual después del push — de lo contrario el pilot sigue sirviendo una build vieja sin avisar.

## Estado actual (2026-07-17 — 11 puntos de la primera semana piloto)

Detalle completo: [[2026-07-17-riegos-en-curso-mapa-y-limpieza-de-datos]]. Resumen:

- **Riego: feature nueva "Riegos en curso"** — arrancar un riego con solo hora de inicio y cerrarlo después, con litros/tiempo calculados en vivo. Implementado en backend, web y mobile.
- **Mapa mobile arreglado de raíz:** `parcelas.coordenadas` (existía en el schema, nunca se había poblado) es ahora la fuente única de geometría para web y mobile — se sacó el snapshot hardcodeado de mobile. Agregada la parcela "Pasero 3" que faltaba, unificados colores y modos de color entre plataformas.
- **Históricos migrados de Excel borrados** (591 cosechas / 144 egresos / 370 presupuestos) por decisión de datos de Fausto — los va a re-analizar y recargar más adelante. No están disponibles hasta que eso pase.
- **Permisos aclarados:** crear = `require_encargado_up`, editar/borrar = `require_gerencial_up`, consistente entre `produccion.py`, `parcelas.py` y `finanzas.py`.
- **Filtro de Finca agregado** a los dashboards (cosmético, solo "Media Agua").
- **Pendiente sin resolver:** error genérico al cargar riego mobile con 2+ válvulas — necesita reproducirse en el dispositivo antes de poder arreglarse (ver [[Bugs Conocidos]]).

## Estado actual (2026-07-18 — egresos huérfanos corregidos)

Fausto notó que Mano de Obra (producción, $2.743.575) y Egresos (finanzas, $3.817.725) no coincidían. Causa: `limpiar_duplicados.py` (2026-07-17) borró `registros_trabajo` duplicados por SQL directo sin borrar el `Egreso` vinculado que genera cada uno (`_build_egreso_for_trabajo`), a diferencia del endpoint real `delete_trabajo`. Quedaron 14 egresos huérfanos por exactamente $1.074.150, la diferencia exacta. Corregido con `scripts/limpiar_egresos_huerfanos.py` (backup + dry-run + `--commit`) — ambos totales coinciden ahora en $2.743.575. Fix **solo de base de datos**, sin cambios de código, ya visible en producción sin necesidad de deploy. Detalle: [[2026-07-17-riegos-en-curso-mapa-y-limpieza-de-datos]] § "Follow-up 2026-07-18".

## Estado actual (2026-07-27 — duplicados web, mapa mobile, cumplimiento de riego)

Detalle completo: [[2026-07-27-duplicados-web-mapa-mobile-y-cumplimiento-riego]]. Resumen:

- **Duplicados en tareas/riego web resueltos** — el guard anti doble-tap del 2026-07-17 nunca se había replicado del mobile al web. Limpiados en producción.
- **Mapa mobile funcionando de nuevo** — causa real era un `TypeError` en `dashboard_eficiencia_hidrica` con cualquier riego en curso, que tumbaba los 6 endpoints del mapa a la vez (`Promise.all`). Cambiado a `Promise.allSettled` — de paso corrige que `regador`/`obrero` tenían el mapa roto *siempre*, no solo con este bug.
- **"Cumplimiento de riego por estado fenológico" completado en web** — quedaba pendiente desde el 2026-07-20/22 (estaba empezado sin commitear). Ahora la capa de color y el panel de detalle por variedad funcionan igual en web y mobile.
- **UX de "riegos en curso" pulida**: litros solo se muestran al terminar (no en vivo), "Terminar" solo desde la pantalla de Riego (no desde Inicio), falso error al terminar corregido con verificación contra el servidor.
- Sesión trabajada en paralelo con otra instancia de Claude Code sobre los mismos archivos (sin coordinación previa) — convergieron al mismo resultado sin conflicto destructivo, pero es una práctica a evitar si no es intencional.

## Estado actual (2026-08-10 — clima realmente arreglado, cola offline, layout Inicio, riego y alertas)

Detalle completo: [[2026-08-10-clima-fix-inicio-layout-riego-alertas]]. Resumen:

- **El widget de clima nunca había funcionado** (ni antes ni después del "enriquecimiento" del 08-05/06) — el router de la API nunca se registró en `main.py`, en ningún commit desde que existe el archivo. Encontrado, corregido (+ 2 bugs más descubiertos al probar de punta a punta: `\r` corrupto en un import, columna de fecha sin timezone) y verificado en producción.
- **Cola de envíos offline (mobile) implementada** para tareas/riego/fito — pendiente confirmar en dispositivo real.
- **Backup:** `pg_restore --list` agregado, cierra el blindspot de dumps truncados del 08-05.
- **Riego (web):** error falso al confirmar corregido (mismo patrón que el bug de "terminar riego" del 07-27). Se descubrió que "iniciar riego en curso" ya existía en web desde el 07-17, solo sin descubrir — agregado un CTA de estado vacío en el Inicio.
- **Alertas:** nuevo panel tipo "buzón" (modal con todas las alertas, tildar/cancelar las oculta 48h — persistido en backend, compartido entre usuarios).
- **Layout del Inicio:** mapa más angosto y clickeable (lleva al mapa completo), "Riegos en curso" con el mismo patrón de panel que Alertas, dos bugs de superposición corregidos (altura del grid, z-index de los modales vs. Leaflet).
- Camilo confirmado y agregado como tester de Play Store (no estaba, a pesar de creerse hecho el 08-05).

## Próximos pasos (actualizado 2026-09-02)

Pilot estable. Trazabilidad (ficha por parcela + carta PDF, Fase 0-1-2) en producción. Primer build de iOS ya en TestFlight (interno); Android con los íconos nuevos en revisión de Play Store; faltan los últimos pasos administrativos de ambas tiendas.

### Pendiente real

1. **Trazabilidad — Fase 3 (link público/QR por lote) y Fase 4 (landing institucional), no iniciadas.** Decisión ya tomada con Fausto: el acceso externo arranca por link público sin login (no portal con usuarios). Detalle: [[2026-09-02-trazabilidad-fase-0-1-2]].
2. **Chatbot de WhatsApp — Fausto ya compró el chip prepago**, pero esta sesión se fue entera a Trazabilidad y no se retomó. Sigue en el mismo punto del 08-27: falta el Paso 2 en Meta for Developers ("Register your WhatsApp phone number"), actualizar `WHATSAPP_PHONE_NUMBER_ID`, reabrir `ngrok`.
3. **Play Store — confirmar aceptación real de los 12 verificadores, no solo que estén en la lista.** El panel oficial de Google (Panel de la app → "Producción") distingue "en la lista" de "aceptó participar" — al 2026-09-01 los 12 emails estaban cargados pero 0 habían aceptado. Cada uno tiene que abrir `https://play.google.com/apps/testing/com.loslirios.app` desde el celular (logueado con esa cuenta exacta de Gmail) y tocar "Convertirme en probador". Recién ahí arrancan los 14 días corridos exigidos antes de poder pedir "Acceso a producción". Detalle: [[2026-09-01-ios-primer-build-play-store-14-dias]].
4. **iOS — sumar testers reales cuando haga falta.** Ninguno de los 12 verificadores de Android tiene cuenta de Apple todavía. Cuando se necesite, armar un grupo de **pruebas externas** en TestFlight (requiere Beta App Review de Apple la primera vez, a diferencia del grupo interno que ya tiene a Fausto probando). No hay mínimo de testers ni período de espera exigido por Apple, a diferencia de Google.
5. Confirmar con Fausto los nombres completos reales de los 4 usuarios nuevos del sistema creados el 2026-09-01 (se usaron nombres inferidos del email: "El Cauquen SRL", "Leticia Yanzon", "Mari Barcelo", "Fausto Yanzon") — corregir en Admin > Usuarios si hace falta.
6. **Misión, Visión y Valores** en Documentación > Empresa quedaron como placeholder "(a definir)" — contenido pendiente de que Fausto lo dicte.
7. Sin confirmación reciente sobre el catálogo de válvulas reales en mobile (pendiente desde el 08-21) — no se retomó, puede que ya se haya resuelto solo; revisar si Fausto no lo vuelve a mencionar.
8. Opcional, sin apuro: borrar a mano el proyecto Vercel roto `fausto-yanzon/los-lirios` (creado por accidente el 09-02 al correr `vercel --prod` desde la raíz del repo en vez de `frontend/`) — no afecta a nada, es solo basura en la cuenta.

**Resuelto desde la última actualización (no repetir):**
- **Trazabilidad completa (Fase 0, 1 y 2)** — ficha por parcela (riego/fitosanitarios con semáforo de carencia/tareas/cosecha/fotos/análisis de calidad) + carta exportable en PDF, campo `finca` en Parcela (backfill corrido, 37/37 parcelas activas). En producción, verificado end-to-end. Detalle: [[2026-09-02-trazabilidad-fase-0-1-2]].
- Deploy del fix de permisos de parcelas (`ce971a6`) — confirmado con `railway status --json` el 2026-09-01: terminó con éxito (el texto plano del CLI mostraba "Deploy failed" engañosamente, pero el JSON confirma `SUCCESS`/`RUNNING`). Ya está en producción.
- Build nuevo de mobile por `react-native-svg` (íconos Fase 2) — hecho el 2026-09-01 (Android versionCode 6, en revisión de Google; iOS build 4, ya en TestFlight).
- Cuenta Apple Developer Individual inscripta y activa (Fausto) — primer build de iOS compilado y subido a App Store Connect el 2026-09-01.
- Rotación de credenciales de producción del 08-19 — confirmado hecho por Fausto el 08-28 ("las roté y arreglé").
- Fausto ya cargó su propia foto/cumpleaños reales en producción.

### Hecho en la sesión del 2026-09-02 (Trazabilidad: ficha por parcela + carta en PDF)

Ver [[2026-09-02-trazabilidad-fase-0-1-2]] para el detalle completo. Resumen: **Fase 0-1** — ficha continua de trazabilidad por parcela (`GET /trazabilidad/parcela/{id}/historial`), agregando riego/fitosanitarios/tareas/cosechas/ciclo de campaña/fotos/análisis de calidad, con un semáforo de cumplimiento de carencia nuevo (compara la fecha de habilitación de cosecha contra cosechas reales, algo que no existía en ningún lado del sistema — todo lo anterior solo comparaba contra la fecha de hoy). Pantalla nueva `/dashboard/trazabilidad`. **Fase 2** — la misma ficha exportable como "carta de trazabilidad" en PDF (`xhtml2pdf`, elegido explícitamente sobre WeasyPrint por el precedente real de `cairosvg`/GTK del 08-28 y porque Railway no tiene infraestructura para instalar paquetes de sistema), con encabezado institucional, resumen ejecutivo, tablas con semáforo de color y tareas resumidas por tipo. Corregido en el camino un gap real (la ficha no mostraba variedad/superficie/ubicación de la parcela) agregando el campo `finca` a `Parcela` (no existía) con backfill a las 37 parcelas activas. Incidente real de deploy (proyecto Vercel equivocado creado por correr el comando desde el directorio raíz) diagnosticado y corregido en la misma sesión.

### Hecho en la sesión del 2026-08-28 (rediseño estético completo + camino a Play Store Producción + fix de permisos)

Dos frentes grandes en la misma sesión. **1) Rediseño estético completo (7 fases, web + mobile)** a partir de un paquete armado con Claude Design — logo repintado a los colores oficiales, íconos unificados a Lucide en las dos plataformas (60 conceptos), tokens de borde/formularios corregidos, login rediseñado, shell web (sidebar + clima real en el topbar, antes texto fijo) y header mobile reconstruidos (con un fix real de safe-area tras probar en dispositivo), mapa mobile con las dos leyendas duplicadas fusionadas y el zoom reubicado (causa real: colisionaba con el botón de modo de color). Ver [[2026-08-28-estetica-v1-rediseno-web-mobile]] para el detalle completo, incluidos 3 bugs reales encontrados de paso (script de assets roto en Windows, proxy.ts bloqueando assets estáticos para visitantes sin sesión, pill de fenología con color fuera de paleta). **2) Camino a Producción de Play Store + arranque de iOS + bug real de permisos.** Confirmado en vivo en Play Console el requisito real de Google (12 verificadores, 14 días de prueba cerrada) — arrancada la prueba cerrada, link de opt-in listo. Decidida la cuenta de Apple Developer (Individual). Bug real encontrado y arreglado: `GET /parcelas/` bloqueaba a encargado/regador con 403, dejando el selector de "Ubicación" vacío en el formulario de Tareas — corregido y verificado con un usuario de prueba real, pero el deploy quedó trabado por un incidente de plataforma de Railway (no nuestro). Ver [[2026-08-28-play-store-produccion-ios-fix-parcelas]] para el detalle completo.

### Hecho en la sesión del 2026-08-26 (costo por kg, perfil con avatar + cumpleaños)

Ver [[2026-08-26-costo-por-kg-avatar-cumpleanos]] para el detalle completo. Resumen: **1) Costo por kg** en el dashboard de Finanzas — encontró y reemplazó un endpoint de mayo (`f4a6c12`) nunca conectado a ningún frontend, que calculaba con la fórmula equivocada (todos los egresos, rendimiento estimado por hectárea en vez de cosecha real). Fórmula nueva acordada con Fausto: solo costos de producción directos (materia prima + producción + insumos varios + repuestos y reparación) sobre kg reales de uva cosechada. Verificado en vivo: $45/kg. **2) Perfil personalizable** (avatar + cumpleaños) en web y mobile: foto sincronizada vía Cloudinary (self-service, `POST /users/me/avatar`), cumpleaños con notificación push automática a todo el equipo (scheduler in-process nuevo — el proyecto no tenía ningún cron hasta ahora). Corrección real de proceso: se había instalado un picker nativo de React Native para el selector de mes en mobile, revertido a tiempo por JS puro para poder publicar por OTA sin necesitar un build nuevo de Play Store (mismo tipo de bug que el incidente de `netinfo` de agosto). Deploy: 2 commits, Railway + Vercel + `eas update` (OTA), todo verificado — sin pendientes bloqueantes.

### Hecho en la sesión del 2026-08-25 (nuevo tipo de egreso "Repuestos y Reparación")

Ver [[2026-08-25-tipo-egreso-repuestos-reparacion]] para el detalle completo. Resumen: Repuestos/Reparaciones vivía mezclado dentro de Insumos Varios — conceptualmente incorrecto desde lo financiero. Tipo nuevo `repuestos_reparacion` (Infraestructura/Vehículos/Maquinaria/Riego/Parral/Otros); Insumos Varios gana Herramientas/Indumentaria. Cambio acotado a un solo archivo por capa (confirmado explorando los ~15 lugares que referencian estos enums, todos derivan dinámicamente). Los egresos históricos con Repuestos Vehículos/Infraestructura se reclasifican solos vía migración (0 filas afectadas en producción — todavía no había ninguno cargado). **Hallazgo técnico real, ya corregido:** agregar un valor a un enum nativo de Postgres y usarlo en la misma corrida de `alembic upgrade head` rompe si las migraciones no commitean por separado — faltaba `transaction_per_migration=True` en `env.py`, mejora general para cualquier migración futura de este tipo.

### Hecho en la sesión del 2026-08-24 (pestaña Documentación, selectores Finca/Campaña conectados, fix Ctrl+K)

Ver [[2026-08-24-documentacion-selectores-finca-campana-ctrlk]] para el detalle completo. Resumen: pestaña nueva "Documentación" (Parcelas/Trabajadores movidos desde Admin + Riego/Melgas/Empresa nuevas). El selector global de Finca/Campaña del header **no filtraba nada** (hallazgo real, no solo "sacar Caucete" como pedía Fausto originalmente) — ahora los ~9 dashboards se sincronizan de verdad con él. Campo `finca` nuevo en `User`: encargado/regador/obrero ven fija la finca asignada en mobile (sin picker), gerencial/super_admin mantienen el picker manual; el selector de Campaña se sacó de mobile (no filtraba nada real ahí). Ctrl+K reparado — derivaba de una lista hardcodeada desincronizada, ahora deriva de la nav real.

### Hecho en la sesión del 2026-08-21 (diagnóstico: válvulas/cuadrantes "faltantes" en mobile)

Fausto pidió aplicar a mobile el trabajo de válvulas/cuadrantes que creía hecho solo para web, tras probar en su celular y no verlo. Antes de escribir código se investigó si realmente faltaba: `git show --stat 93c4fcb` confirmó que `mobile/app/(tabs)/riego.tsx` y `mobile/app/(tabs)/mapa.tsx` ya tienen el catálogo real de válvulas (`getValvulasReales`, chips "Válvula {nombre}", filtrado por cabezal) y `window.setValvulasEnRiego` para el resaltado de cuadrante — ambos del 18/08. `npx eas update:list --branch production` confirmó que el OTA con ese cambio se publicó a producción hace 2 días. El endpoint `/produccion/valvulas` responde en producción (401 sin token, ruta viva). No se encontró ningún commit posterior que lo haya roto o revertido. Conclusión: no se tocó código esta sesión — se le pidió a Fausto que cierre/reabra la app dos veces (patrón OTA ya conocido) y confirme de nuevo antes de asumir que hay un bug real. Ver también la memoria de Claude Code (`project_loslirios.md`) para el detalle completo de la investigación.

### Hecho en la sesión del 2026-08-19 (pestaña Clima: termógrafo de campo + pronóstico extendido)

Ver [[2026-08-19-clima-termografo-pronostico-extendido]] para el detalle completo. Resumen: pestaña nueva `/dashboard/produccion/clima` — importación del CSV del termógrafo BLE de campo (mismo patrón de dedupe que ARCA), 6 métricas agroclimáticas (horas bajo 0°C/sobre 30°C/de frío, GDD acumulado cruzado contra el calendario de Ciclo de Campaña, amplitud térmica diaria, eventos de helada, riesgo fúngico), tabla de eventos de helada paginada (10 por página), y pronóstico extendido de 7 días (Open-Meteo, humedad/viento/precipitación) sin tocar el widget compacto de Inicio. Verificado end-to-end contra Postgres real y el CSV real de Fausto antes de deployar. Bug real encontrado y corregido en producción: los campos `Decimal` de la API (GDD, amplitud térmica, mínimas de helada) llegan al frontend como *string*, no `number` — mismo patrón que el bug de "$NaN" del 08-18, ahora anotado como gotcha recurrente. **Metodología nueva a partir de esta sesión:** probar en local con Claude in Chrome antes de pushear/deployar — ver [[feedback_local_testing_before_deploy]] en la memoria de Claude Code (no vive en esta bóveda).

### Hecho en la sesión del 2026-08-18, segunda tanda (para referencia — no repetir)

**Fix de totales (Egresos/Tareas) + tarjetas de dashboard por rango de fecha.** Ver [[2026-08-18-fix-totales-egresos-tareas-dashboards-por-rango]]. La diferencia de totales entre Inicio (~18M) y Egresos/Tareas (~14M) resultó ser que esas dos tablas sumaban solo los últimos 100 registros (tope de paginación del backend), no el total real — corregido con endpoints dedicados que suman en SQL sin límite. Las tarjetas de Cumplimiento/Egresos/Ingresos/IVA (dashboard Finanzas) y Jornales/Costo MO (Mano de Obra) dejaron de estar fijas al mes actual y ahora respetan el rango de fecha ya seleccionado en cada dashboard, con botones rápidos nuevos "Mes actual"/"Mes anterior".

### Hecho en la sesión del 2026-08-18, primera tanda (para referencia — no repetir)

**Tabla de equivalencia de válvulas reales (GeoJSON) + resaltado de riego en curso a nivel de cuadrante** — cierra el punto 2 pendiente desde el 08-13. Ver [[2026-08-18-tabla-equivalencia-valvulas-cuadrante]]. Encontró y corrigió, con confirmación de Fausto: el Parral 2 reparte sus 3 válvulas reales entre 2 cabezales distintos (antes invisible, `Parcela.cabezal_riego` solo guardaba uno); las válvulas "41"/"42" son del Parral 4 y "43"/"44" del Parral 5 (estaban digitalizadas del lado equivocado del límite compartido en QGIS); "31"/"32" riegan el Potrero 3, no un parral; una válvula mal nombrada "SU3" duplicada corregida a "SU4". Tabla nueva `valvulas` en el backend (cabezal por válvula, no por parcela) reemplaza las 3 listas hardcodeadas que antes vivían duplicadas en frontend y mobile. Válido en producción, confirmado por Fausto en el celular.

### Hecho en la sesión del 2026-08-13 (para referencia — no repetir)

**5 mejoras al mapa (web + mobile), con plan formal aprobado antes de ejecutar:** (1) modo "Fenología" corregido para leer del Ciclo de Campaña nuevo (antes mostraba estados viejos tipo "Latencia"/"Madurez" en vez de "Post-Cosecha"); (2) modo "Riego" anual eliminado, queda solo "Cumpl. riego" (los dos mostraban la misma info con etiquetas distintas); (3) objetivo de agua en el panel de parcela ahora en mm/año (600mm/año) en vez de litros, agregado también a mobile que no lo tenía; (4) capa "Cuadrantes de Riego" ahora clickeable (tenía `interactive:false`, el click caía siempre sobre el parral de abajo); (5) riegos en curso se resaltan en tiempo real sobre el parral exacto (poll 30s, borde celeste punteado) — deliberadamente a nivel parral y no cuadrante/válvula, ver el análisis de viabilidad en la nota de sesión. Verificado en vivo en producción (web) con una prueba real de principio a fin. Ver [[2026-08-13-mejoras-mapa]].

### Hecho en la sesión del 2026-08-12, quinta tanda (para referencia — no repetir)

**Pantalla de notificaciones push** (`/dashboard/admin/notificaciones`): compone título/cuerpo, elige destinatarios (todos, o usuarios puntuales para super_admin), llama al endpoint que ya existía (`POST /notificaciones/enviar`) pero no tenía UI. Sin cambios de backend. Los triggers automáticos desde Alertas quedaron fuera de alcance a propósito (decisión de diseño aparte).
**Responsividad — las 13 páginas cerradas.** Headers que no envolvían (varios botones se superponían en pantallas angostas) corregidos en 9 páginas; las otras 4 (`flujo`, `flujo/desglose`, `presupuesto`, `campana`) ya resolvían el ancho bien con `flex-wrap` + `overflow-x-auto`, solo hacía falta confirmarlo. Hallazgo real de paso: el panel de detalle de parcela en el mapa (`FincaMapInner.tsx`) tenía un ancho fijo de 288px que tapaba casi toda la pantalla en un celular — corregido a `w-full` por debajo de `sm`. Ver [[2026-08-12-notificaciones-y-responsividad]].

### Hecho en la sesión del 2026-08-12, cuarta tanda (para referencia — no repetir)

**Diagnóstico: el catálogo de Trabajador estaba vacío en producción desde que se lanzó el 08-05** — 105 de 106 registros de Tareas (y todos los de Riego/Fitosanitarios) nunca quedaron vinculados a un `Trabajador`. Confirmado con Claude in Chrome que el combobox funciona bien hoy (creación de prueba real, luego borrada sin rastro); el problema era retroactivo, no un bug vigente. **Backfill corrido en producción por Fausto vía `!`: 28 Trabajadores creados, 109 registros vinculados (105 tareas + 3 riegos + 1 fitosanitario), 0 pendientes verificado después.** Nueva pantalla `/dashboard/admin/trabajadores` (maestro de trabajadores, CRUD completo, sin cambios de backend) y KPI "Trabajadores activos" en el dashboard de Mano de Obra. Auditoría del resto del esquema: es el único caso de este tipo en toda la base. Ver [[2026-08-12-catalogo-trabajadores-vacio-y-fix]].

### Hecho en la sesión del 2026-08-12, tercera tanda (para referencia — no repetir)

**Combobox de Trabajador extendido a Riego y Fitosanitarios** (`responsable_id`, mismo patrón que Tareas desde el 08-05) — mobile y web por igual, en los dos módulos. Ver [[2026-08-12-combobox-responsable-riego-fito]].

### Hecho en esta sesión (2026-08-12, segunda tanda — para referencia, no repetir)

1. **`vercel --prod` corrido** — la importación ARCA (CSV → Egresos/Ingresos + IVA) ya está en el frontend de producción.
4. **`SENTRY_DSN` seteado en Railway** (vía `railway variables --set`, DSN obtenido del proyecto `python-fastapi` en sentry.io) — Sentry queda activo en producción a partir del próximo redeploy del servicio (el set de la variable ya dispara uno).
5. **4° test de idempotencia agregado** para `POST /produccion/riego/iniciar` (`backend/tests/test_produccion_idempotency.py`) — expuso un bug real de paso: `ZoneInfo("America/Argentina/San_Juan")` depende de la base IANA del sistema operativo, ausente en Windows sin el paquete `tzdata` explícito (nunca se había ejercitado ese endpoint en un test). Agregado `tzdata` a `requirements.txt`. 44/44 tests backend pasando. Commit `7c4fde1`, pusheado — Railway redespliega solo (sin migraciones nuevas).
6. **Punto "deshacer descarte ARCA" — ya estaba resuelto, el roadmap había quedado desactualizado.** El follow-up de la sesión del 08-12 (misma tarde, commits `38858e6`/`f753702`) ya había agregado `POST /finanzas/arca/{id}/restaurar`, `DELETE /finanzas/arca/{id}` y la vista "Ver descartados" en `ComprobantesArcaPanel.tsx` — confirmado presente en el código actual. No había nada que construir, solo corregir este documento.

### Hecho en la sesión del 2026-08-12, primera tanda (para referencia — no repetir)

Importación de comprobantes ARCA (CSV) → Egresos/Ingresos + IVA compra/venta/saldo, completa (modelo, backend, frontend, alertas, verificada end-to-end con datos reales). Ver [[2026-08-12-importacion-comprobantes-arca-iva]].

Ajuste posterior (2026-09-01): el monto del Egreso/Ingreso al clasificar pasó a ser el **neto sin IVA** (`imp_total - total_iva`), porque Fausto es responsable inscripto y toma crédito fiscal solo de Facturas A — el IVA ya se computa aparte en `resumen-iva`. Ver [[2026-09-01-arca-egresos-ingresos-neto-sin-iva]].

### Hecho en la sesión del 2026-08-11 (para referencia — no repetir)

Ver el resumen completo en [[2026-08-11-logging-sentry-tests-idempotencia-router-build-offline]]. Cierra los puntos 2-4 del roadmap anterior (logging/Sentry, tests de idempotencia riego/fito/cosecha, test de registro de routers) y adelanta el punto 1 (cola offline) con un build nuevo tras detectar que el publicado no tenía el módulo nativo necesario.

### Hecho en la sesión del 2026-08-10 (para referencia — no repetir)

Ver el resumen completo arriba y en [[2026-08-10-clima-fix-inicio-layout-riego-alertas]]. Cierra los puntos 1-4 del roadmap anterior (cola offline, backup, revisión de Play Store, Camilo como tester).

### Roadmap (features nuevas, sin fecha)

- Costo por kg en dashboard de finanzas.
- Integraciones Fase 5: Climagro real (solo si el dato de Open-Meteo se demuestra insuficiente), bot de WhatsApp (carga de egresos), agente ARCA (boletas), termógrafo IoT.

### Google Play Store (track Internal testing)

Decidido y arrancado el 2026-07-27, publicado en Internal testing el 2026-07-29, ficha enviada a revisión de Google el 2026-08-05 (pendiente, punto 3 de arriba), versión 3 (huella/login/clima/trabajador) publicada el 2026-08-06. Checklist completo: [[Play Store — checklist de publicación]].

## Ver también

- [[2026-09-02-trazabilidad-fase-0-1-2]]
- [[2026-09-01-ios-primer-build-play-store-14-dias]]
- [[2026-08-26-costo-por-kg-avatar-cumpleanos]]
- [[2026-08-25-tipo-egreso-repuestos-reparacion]]
- [[2026-08-24-documentacion-selectores-finca-campana-ctrlk]]
- [[2026-08-19-clima-termografo-pronostico-extendido]]
- [[2026-08-18-fix-totales-egresos-tareas-dashboards-por-rango]]
- [[2026-08-18-tabla-equivalencia-valvulas-cuadrante]]
- [[2026-08-12-importacion-comprobantes-arca-iva]]
- [[2026-08-11-logging-sentry-tests-idempotencia-router-build-offline]]
- [[2026-08-10-clima-fix-inicio-layout-riego-alertas]]
- [[Spec — Cola de envíos offline (mobile)]]
- [[2026-08-05-login-username-biometria-clima]]
- [[2026-08-05-trabajador-combobox-refresh-token-backup-check]]
- [[Play Store — checklist de publicación]]
- [[2026-07-29-duplicados-cuarta-vez-idempotencia-real]]
- [[2026-07-27-duplicados-web-mapa-mobile-y-cumplimiento-riego]]
- [[2026-07-20-login-mobile-y-ciclo-campana]]
- [[2026-07-17-riegos-en-curso-mapa-y-limpieza-de-datos]]
- [[2026-07-14-finanzas-ingresos-y-fixes-piloto]]
- [[2026-07-11-deploy-piloto-completado]]
- [[2026-07-12-ota-y-ux-cargar-tarea]]
- [[Arquitectura]]
- [[Stack Técnico]]
- [[Bugs Conocidos]]
- [[Dashboards]]
- [[Checklist Deploy de Prueba (Semana Piloto)]]
