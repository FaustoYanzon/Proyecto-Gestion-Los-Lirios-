---
tags: [sistema, sesion, feature, trazabilidad, pdf]
---

# 2026-09-03 — Trazabilidad: link público/QR sin login (Fase 3) + landing institucional (Fase 4)

Continuación directa de [[2026-09-02-trazabilidad-fase-0-1-2]]. Con la ficha por parcela y la carta en PDF ya en producción, esta sesión cerró las dos fases que quedaban pendientes: **Fase 3** — que un comprador pueda ver la carta de una parcela desde un link/QR sin necesitar usuario — y **Fase 4** — una landing institucional en `/` que hasta ahora era el boilerplate de `create-next-app`. Cada fase con su ciclo plan → implementación → verificación local → deploy. Las dos están commiteadas, pusheadas y deployadas.

## Decisiones de alcance (antes de tocar código)

Confirmadas con Fausto al arrancar:

- **Acceso externo = link/QR con token no adivinable, no portal con login.** Ya venía decidido de la sesión anterior; ratificado.
- El enlace fija su rango `desde`/`hasta` al generarse, pero **consulta datos en vivo** (no es un snapshot congelado).
- La vista pública **oculta `comprador` y `responsable`** de todos los eventos.
- Solo `gerencial` o superior genera/revoca enlaces.
- El enlace es **revocable pero sin vencimiento automático**.
- El QR se **embebe en el PDF interno** cuando ya existe un enlace activo para esa misma parcela + rango (no cambia permisos ni genera uno nuevo).
- **Fase 4 sin buscador de cartas.** Fausto lo descartó explícitamente: si la landing tuviera un buscador, el acceso dejaría de depender del token no adivinable. La landing solo explica quiénes somos / qué producimos / cómo funciona la trazabilidad pública y da un contacto.

Plan formal de la Fase 3: `C:\Users\faust\.claude\plans\functional-waddling-blossom.md`.

## Fase 3 — Enlace público + QR (commits `680d395`, `83f3434`, `4dbd4c6`)

### Backend

- Modelo nuevo `EnlacePublico` (`enlaces_publicos_trazabilidad`, migración `c0e767795194`). Revocación **soft**: `activo=False` + `revoked_at`.
- Endpoints de gestión, `require_gerencial_up`: `POST/GET /trazabilidad/parcela/{id}/enlaces`, `POST /trazabilidad/enlaces/{id}/revocar`.
- Endpoints públicos **sin auth**: `GET /trazabilidad/publica/{token}` y `.../pdf`. **404 genérico único** para token inexistente o revocado (no se distingue, para no filtrar si un token existió).
- `_build_historial_publico` arma `HistorialPublicoResponse` **campo por campo desde schemas nuevos curados por allow-list** (`FitosanitarioPublicoItem` / `FotoPublicaItem` / `AnalisisPublicoItem` / `ResumenPublicoItem`) — sin `responsable`, `comprador` ni `created_by`. No es un `.dict()` filtrado, es una construcción explícita: lo que no está en el schema no puede salir.
- `app/core/qr.py`: `generar_qr_png` / `generar_qr_data_uri`. Paquete `qrcode==8.2` agregado a `requirements.txt` — puro Python + Pillow, sin nada de sistema (mismo criterio que `xhtml2pdf` en la Fase 2).
- `pdf_carta.generar_pdf_carta` gana `publico: bool` (omite responsable/comprador en las 3 comprehensions) y `publico_url: str | None` (embebe el QR como data URI). La `carta-pdf` **interna** busca un `EnlacePublico` activo del mismo rango exacto y hereda el QR sin cambiar sus permisos.
- Config nueva: **`PUBLIC_BASE_URL`** (default `http://localhost:3000`). Fausto la seteó en Railway a `https://frontend-six-jade-79.vercel.app` — si no, el QR y el link del pie del PDF apuntan a localhost.

### Bug encontrado en producción y corregido (`83f3434`)

El QR no se dibujaba en la carta PDF. Causa: `_link_callback` en `pdf_carta.py` solo dejaba pasar `http`/`https` y mandaba todo lo demás a `os.path.join(ASSETS_DIR, basename(uri))` → con un `data:` URI, xhtml2pdf terminaba buscando un archivo cuyo nombre era la cola del base64, no lo encontraba y **descartaba la imagen sin lanzar error**. El pie de texto con la URL sí se veía, así que los tests iniciales (que solo revisaban texto extraído) no lo agarraron. Fix: `_link_callback` deja pasar los `data:` sin tocarlos; los tests ahora **cuentan imágenes embebidas** en la página 1 (logo solo vs. logo + QR).

### Frontend

- `lib/api/trazabilidad.ts`: tipos + `crearEnlacePublico` / `listEnlacesPublicos` / `revocarEnlacePublico` / `getHistorialPublico` / `downloadCartaPdfPublica`, reusando el cliente `api`.
- `proxy.ts`: `/trazabilidad/publica` sumado a `alwaysPublicRoutes`.
- Página nueva `app/trazabilidad/publica/[token]/page.tsx` — **fuera de `/dashboard`**, mobile-first, reusa `RiegoPorEstado` / `DestinoResumen`, con su propio estado 404. No monta el shell autenticado.
- `components/trazabilidad/EnlacesPublicos.tsx`: panel de gestión, montado solo para `super_admin` / `gerencial` (`PUEDE_GESTIONAR_ENLACES_ROLES`), con copiar-URL (`window.location.origin`) y revocar.

### Rate limiting (`4dbd4c6`, agregado después)

30/min por IP sobre `GET /trazabilidad/publica/{token}` y `.../pdf` vía `slowapi` (`@limiter.limit`, mismo patrón que `LOGIN_RATE_LIMIT`), configurable con `PUBLIC_TRAZABILIDAD_RATE_LIMIT`. Verificado que devuelve 429. Backend-only.

### Tests y verificación

- `backend/tests/test_trazabilidad_enlaces.py`: 10 tests nuevos, incluye un chequeo **defensivo recursivo** de que `responsable` / `comprador` no aparecen en ningún nivel del JSON público ni en el texto del PDF público. **108/108 backend**, `tsc --noEmit` limpio.
- Local (Claude in Chrome): panel genera enlace → la página pública carga sin shell autenticado y sin errores de consola → revocar → la misma URL pasa a 404. Carta interna con enlace activo del rango: PDF con QR embebido + URL pública en el pie.
- **En producción, verificada por Fausto (2026-09-03): escaneó el QR de una carta real y abrió la página pública.**

## Fase 4 — Landing institucional (commits `f44561f`, `2a4bce0`)

### `f44561f` — primera versión

Reemplaza el boilerplate de `create-next-app` de `frontend/app/page.tsx` (que nunca era accesible: sin sesión, `/` redirigía a `/login`) por una landing real: quiénes somos, qué producimos, cómo funciona la trazabilidad pública, contacto. Contenido editable en `frontend/lib/content/landing.ts` (placeholders realistas con TODOs). `proxy.ts` cambiado para que `/` **sin sesión** muestre la landing en vez de redirigir a `/login`; **con sesión** sigue yendo a `/dashboard`.

**Gotcha:** `globals.css` tiene un `a { color: var(--color-burdeos-600) }` **fuera de `@layer`** → le gana a `text-white` de Tailwind (una regla unlayered pisa a una layered, sin importar especificidad). Por eso el botón del nav usa las clases `.btn` / `.btn--primary` del design system en vez de utilidades de color de Tailwind.

### `2a4bce0` — rediseño (con la skill `impeccable`)

Fausto pidió subir el nivel de diseño, meter fotos reales y un mapa.

- **Dirección de arte de finca**, no template plano. Hero fijo (`position: sticky`) con la foto del atardecer; las secciones scrollean por encima y lo cubren (efecto "se atenúa al bajar"), con un scrim que oscurece vía CSS scroll-driven donde hay soporte. Tipografía Fraunces grande, escala fluida `clamp()`, sección de trazabilidad drenada en vino (`.landing__section--wine`).
- **4 fotos reales de celular** (carpeta `C:\claude-projects\Fotos Los Lirios`, comprimidas por WhatsApp, fuera del repo) procesadas con `sharp` a `frontend/public/finca/*.jpg`: recorte de las barras de WhatsApp + ajuste de grado + grano para unificar la compresión. Una va como duotono-vino real (`mix-blend-mode: color`).
- **Mapa de variedades:** `frontend/scripts/build-finca-map.mjs` parsea el KML real de la finca (`public/Los Lirios 2026.kml`) → `frontend/lib/content/finca-map.ts` (19 cuadros de parral, geometría real proyectada a un viewBox). `components/landing/VarietyMap.tsx`: SVG **inline** (~6 KB), cuadros pintados por variedad, leyenda con nº de cuadros + ha, hover/tap con tooltip. Sin Leaflet ni API. La variedad y los ha de cada cuadro son una tabla `PARCELA_META` dentro del script (snapshot de la DB al 2026-09) — editar ahí si cambia.
- `components/landing/Reveal.tsx` + `.reveal-scroll`: reveal on scroll con `animation-timeline: view()`, guardado por `@supports` + `@media (prefers-reduced-motion)`. El contenido **siempre queda visible** donde no hay soporte. Nota: las animaciones scroll-driven **no se pudieron verificar visualmente dentro de Claude-in-Chrome** — `CSS.supports` da `true` pero el compositor no tickea el scroll en ese contexto. Son spec-correctas y corren en Chrome / Edge / Firefox reales.

## Deploy y cierre

- Commits a `main`, todos pusheados: `680d395`, `83f3434`, `4dbd4c6` (Fase 3), `f44561f`, `2a4bce0` (Fase 4).
- **Railway** auto-desplegó el backend (migración `c0e767795194` + rate limit). `PUBLIC_BASE_URL` seteada por Fausto en Railway al dominio de Vercel.
- **Vercel** (no auto-despliega en este proyecto): `vercel --prod` corrido por Fausto desde `frontend/`. Deploy final `dpl_DRrMqUytiVRebkKbeg3J1EEP4EnZ`, **Ready**, en el alias de producción `frontend-six-jade-79.vercel.app`. Verificado por curl: `/` sin cookie sirve la landing (200, sin redirect), el CSS bundle trae `animation-timeline:view()` / `l-hero-darken` / `reveal-scroll`, las fotos sirven 200.
- El proyecto Vercel roto `fausto-yanzon/los-lirios` (del incidente de deploy de la sesión anterior) se **borró** el 2026-09-03 (`vercel project rm los-lirios`). Queda solo `fausto-yanzon/frontend`.

## Pendiente real para la próxima sesión

1. **Fausto:** confirmar a ojo el fade del scroll de la landing en su navegador (incógnito → `frontend-six-jade-79.vercel.app`) — la pestaña automatizada de Claude-in-Chrome no procesa scroll-driven animations, y la URL directa del deploy tiene Vercel deployment protection con SSO. Y **reemplazar los textos/fotos placeholder** de `frontend/lib/content/landing.ts`.
2. Extender Trazabilidad a potreros con **alfalfa** — hoy todo sigue filtrado a `tipo=parral`. Pendiente explícito de Fausto (Fase 2.5).
3. Mapa estático del polígono de la parcela **en el PDF** — fuera de alcance a propósito (no hay infraestructura para renderizarlo server-side), mejora futura no bloqueante.
4. **Mobile:** solo el ícono está registrado (`ICONS.trazabilidad`), no hay pantalla propia — explícitamente fuera de esta ronda.
5. **Chatbot de WhatsApp — sigue pausado.** Chip prepago ya comprado; falta el Paso 2 en Meta for Developers ("Register your WhatsApp phone number"), actualizar `WHATSAPP_PHONE_NUMBER_ID`, reabrir `ngrok` con el Callback URL nuevo. Sin cambios desde el 08-27.

## Ver también

- [[2026-09-02-trazabilidad-fase-0-1-2]]
- [[Sistema de Gestión Agrícola]]
- [[Arquitectura]]
- [[Stack Técnico]]
