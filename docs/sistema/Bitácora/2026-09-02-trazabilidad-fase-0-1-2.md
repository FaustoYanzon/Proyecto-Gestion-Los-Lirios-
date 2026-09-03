---
tags: [sistema, sesion, feature, trazabilidad, pdf]
---

# 2026-09-02 — Trazabilidad: ficha por parcela (Fase 0-1) + carta exportable en PDF (Fase 2)

Fausto pidió una forma de mostrar y controlar la trazabilidad de cada parral/parcela — riego, aplicaciones fitosanitarias con sus días de carencia, tareas, cosechas, fotos, análisis de calidad — con la idea de poder entregarla como "carta de trazabilidad" a compradores. Sesión larga, en tres tandas: diseño de alcance completo, Fase 0-1 (ficha interna) y Fase 2 (carta en PDF), cada una con su propio ciclo de plan formal → implementación → verificación local con datos reales → deploy.

## Diseño de alcance (antes de tocar código)

Revisado el esquema real antes de proponer nada: `RegistroFitosanitario` ya calculaba `fecha_habilitacion_cosecha`/`fecha_habilitacion_reingreso` al crearse, pero **en ningún lugar del sistema se comparaba esa fecha contra una cosecha real** — todo lo existente (`alertas/carencia`, `Alertas.tsx`) solo compara contra "hoy". Ese semáforo de cumplimiento (cumplido/incumplido/pendiente) quedó como el mayor valor agregado de la feature.

Decisiones tomadas con Fausto en esta ronda: unidad de trazabilidad = parcela (no lote/remito, aclarado explícitamente después de un primer malentendido — ver Fase 2 abajo); fotos en álbum simple asociado por fecha, no por evento; análisis de calidad soporta medición propia **y** informe de laboratorio con adjunto; permisos de carga = `encargado` o superior; acceso externo futuro = link público/QR por lote, no portal con login (fase posterior, no construida todavía).

## Fase 0-1 — Ficha continua de parcela

**Backend:** modelos nuevos `Foto` (`fotos_parcela`) y `AnalisisCalidad` (`analisis_calidad`), ambos con índice `(parcela_id, fecha)`. Endpoint agregador `GET /trazabilidad/parcela/{id}/historial?desde&hasta` — consulta el ORM directo sin límite (los endpoints de lista de `/produccion` truncan en 100 filas, no sirven para traer una campaña completa) y calcula el semáforo comparando cada aplicación fitosanitaria contra las cosechas reales posteriores de esa parcela. CRUD de fotos/análisis con subida a Cloudinary (`upload_foto_parcela` solo imagen, `upload_informe_analisis` imagen o PDF).

**Frontend:** sección nueva "Trazabilidad" en el menú (visible a todos los roles, las acciones de carga sí gatean por rol), con selector de parcela (filtrado a `parral`) y de campaña/rango, timeline cronológico mezclando los 5 tipos de evento, banner de cumplimiento, álbum de fotos y lista de análisis.

Verificado con datos reales de prueba (creados y borrados sin dejar rastro): casos cumplido/incumplido/pendiente del semáforo, estado vacío, subida de foto y análisis desde la UI real (Claude in Chrome). 98/98 tests backend passing.

## Incidente real de deploy — proyecto Vercel equivocado creado por accidente

El primer `vercel --prod` (corrido por Fausto con `!`) se ejecutó desde la raíz del repo en vez de `frontend/` — Vercel detectó el backend como "servicio" y creó un **proyecto nuevo `fausto-yanzon/los-lirios`**, con un `vercel.json` en la raíz declarando `services` que después seguía "secuestrando" cualquier deploy posterior hacia ese mismo proyecto equivocado, aunque se corriera desde `frontend/`. Diagnosticado con `mcp__plugin_vercel_vercel__get_project` (ninguno de los dos usaba lo que decía `frontend/.vercel/project.json`, que siempre estuvo bien). Solución real: borrar `vercel.json` y `.vercel/` de la raíz (ninguno estaba en git, ninguno existía antes de esta sesión) — con eso el segundo intento fue directo al proyecto correcto (`fausto-yanzon/frontend`, alias `frontend-six-jade-79.vercel.app`). **El proyecto roto `fausto-yanzon/los-lirios` sigue existiendo en la cuenta de Vercel** (deploy en estado `ERROR`, no molesta a nada) — pendiente opcional de borrarlo a mano desde el dashboard.

## Fase 2 — Carta de trazabilidad en PDF

**Corrección de alcance real, a mitad de camino:** el plan original (heredado de la idea inicial de Fausto) proponía una carta agrupada por lote/remito de cosecha. Al preguntar el detalle, Fausto aclaró que la necesita **por parcela completa**, no por envío — la misma ficha de la Fase 0-1, exportada. Replanteado en el momento, antes de escribir código de agrupamiento que no hacía falta.

**Motor de PDF: `xhtml2pdf`, no WeasyPrint.** Descartado explícitamente por precedente real de este mismo proyecto: la sesión del 08-28 tuvo un problema real con `cairosvg` (necesita GTK a nivel de sistema) en Windows, y el backend en Railway no tiene ningún `Dockerfile`/`nixpacks.toml` para instalar paquetes de sistema — cualquier librería basada en Pango/Cairo es un riesgo real de romper el build. `xhtml2pdf` + `Jinja2` (más su cadena de dependencias transitivas — `reportlab`, `pypdf`, `Pillow`, etc., todas puro Python) instalaron limpio en Windows sin pedir nada del sistema, confirmando la decisión antes de comprometerse.

**Gap real encontrado al revisar la Fase 0-1 con más atención:** la ficha nunca mostraba los datos fijos de la parcela (variedad, superficie, ubicación) — solo los eventos —, pese a que Fausto lo había pedido desde el primer mensaje de la sesión. Corregido con un encabezado nuevo (`ParcelaHeader.tsx`) tanto en pantalla como en el PDF. De paso se sumó el día de reingreso (antes solo se mostraba la carencia) al detalle de cada fitosanitario en pantalla.

**Campo `finca` agregado a `Parcela`** (no existía — el selector "Media Agua/Los Mimbres" del header es un contexto global de Finanzas, sin relación con parcelas en la base). Migración aditiva nullable, selector nuevo en Admin de Parcelas, script de backfill (`scripts/backfill_finca_parcelas.py`, mismo patrón dry-run + `--commit` + backup con `pg_dump`) — confirmado con Fausto que las 37 parcelas activas están todas en Media Agua, corrido por él mismo contra producción tras el deploy.

**Contenido del PDF:** encabezado institucional (Los Lirios SA, CUIT 33-67368809-9, Juez Ramón Díaz (S) 473, San Juan), identificación de parcela, resumen ejecutivo (kg cosechados, litros de riego, aplicaciones por estado), tablas de riego/fitosanitarios (semáforo por color de fila)/cosecha, **tareas resumidas por tipo con totales** (no el listado completo evento por evento — decisión explícita de Fausto, el PDF es de presentación, no de auditoría interna), análisis de calidad con link al informe, galería de fotos en miniatura. Pie: "Generado por `<usuario>` — Los Lirios SA" con fecha/hora, aclarando explícitamente que **no** es una firma digital (no existe ese sistema, mejor decirlo que fingir una firma).

Endpoint `GET /trazabilidad/parcela/{id}/carta-pdf` reutiliza exactamente la misma función de agregación que el endpoint JSON (`_fetch_historial`, extraída como refactor) — la generación (síncrona, CPU-bound) corre en threadpool (`starlette.concurrency.run_in_threadpool`) para no bloquear el event loop async, mismo cuidado que ya tenía el proyecto con Cloudinary. Verificado con datos reales: PDF válido de 2 páginas/~75KB, texto extraído con `pypdf` confirmando cada sección, fila "Incumplido" correcta, imagen remota (Cloudinary) resuelta sin `link_callback` explícito, servidor sigue respondiendo otras rutas mientras se genera el PDF (chequeo de concurrencia real, no asumido). Botón "Descargar carta (PDF)" probado en el navegador real (Claude in Chrome + verificación de la request en Network, 200 OK).

## Deploy

Dos commits a `main`: `6151176` (Fase 0-1) y `83f925d` (Fase 2). Railway corrió ambas migraciones sola y confirmado `RUNNING` en cada caso (`railway status --json`). Frontend: `vercel --prod` corrido por Fausto con `!` en las dos vueltas (la primera de la Fase 0-1 salió bien a la primera; la de la Fase 2 tuvo el incidente del proyecto equivocado, ver arriba). Backfill de `finca` corrido por Fausto contra producción tras confirmar el deploy — `UPDATE 37`, verificado con un segundo dry-run que dio 0 pendientes.

## Pendiente real para la próxima sesión

1. **Fase 3 de Trazabilidad** (no iniciada): link público/QR por lote de cosecha, para que un comprador vea la carta sin necesitar login — decisión ya tomada con Fausto de arrancar por acá en vez de un portal con usuarios.
2. **Fase 4 de Trazabilidad** (no iniciada): landing institucional ("quiénes somos" + buscador de cartas públicas), depende de la Fase 3 solo en contenido/branding, no en lo técnico.
3. Mapa estático del polígono de la parcela en el PDF — quedó fuera a propósito de la Fase 2 (no hay infraestructura para renderizarlo del lado del servidor), anotado como mejora futura, no bloqueante.
4. Proyecto Vercel roto `fausto-yanzon/los-lirios` (del incidente de deploy) sigue en la cuenta — borrar a mano desde el dashboard si se quiere, no urge.
5. **Chatbot de WhatsApp — sigue pausado.** Fausto avisó al arrancar esta sesión que ya había comprado el chip prepago, pero la sesión se fue entera a Trazabilidad y no se retomó el registro del número real en Meta for Developers. Sigue exactamente donde quedó el 08-27: falta el Paso 2 ("Register your WhatsApp phone number"), actualizar `WHATSAPP_PHONE_NUMBER_ID`, reabrir `ngrok` con el Callback URL nuevo.
6. Arrastrados de sesiones previas, sin cambios hoy: confirmar en Play Console cuántos de los 12 verificadores ya aceptaron participar (recién ahí arrancan los 14 días); armar grupo de pruebas externas en TestFlight cuando haga falta sumar testers reales de iOS; confirmar nombres completos reales de los 4 usuarios creados el 09-01; Misión/Visión/Valores en Documentación > Empresa sigue en placeholder.

## Ver también

- [[Sistema de Gestión Agrícola]]
- [[Arquitectura]]
- [[Stack Técnico]]
