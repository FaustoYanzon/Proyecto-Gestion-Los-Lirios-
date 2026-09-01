---
tags: [sistema, sesion, diseño, mobile, web]
---

# 2026-08-28 — Rediseño estético completo (7 fases, web + mobile)

Fausto trajo un paquete de estética ya armado con Claude Design (carpeta `estetica/` en la raíz del repo): `ESTETICA.md` (especificación, 22 hallazgos con procedencia marcada "verificado en código" u "observado en captura"), `PROMPTS.md` (7 fases con prompts listos), assets SVG nuevos y un script de generación. Antes de tocar código se analizó el paquete completo y se hicieron preguntas críticas — ver el análisis abajo. Regla del documento, respetada en todo momento: **sólo estética, cero cambios de lógica de negocio, endpoints, permisos o datos.**

## Análisis previo y decisiones de arranque

- **Trabajo sin commitear encontrado antes de empezar:** el chatbot de WhatsApp (pausado la sesión anterior, esperando el chip) estaba completo en el working tree sin commitear. Se commiteó primero como checkpoint limpio, y recién ahí se creó la rama `feature/estetica-v1`.
- **Bug real en el propio script del paquete:** `gen_assets.py` (Python, `cairosvg`) no corre en Windows sin instalar GTK a nivel de sistema. Se replicó con `sharp` (ya estaba en `frontend/node_modules` como dependencia de `next/image`) — y de paso se encontró que el script buscaba el `<rect>` de fondo del ícono adaptativo como string autocerrado (`.../>`) cuando el SVG real no lo trae autocerrado: con el script tal cual, `adaptive-icon.png` habría salido con fondo sólido en vez de transparente.
- **Migrar íconos de mobile (Ionicons → Lucide) es riesgo real, no bajo como decía el documento:** agrega `react-native-svg`, un módulo nativo — no alcanza con `eas update` (OTA), hace falta un build nuevo + resubir a Play Store (mismo patrón que `netinfo` en agosto). Decisión de Fausto: migrar igual, aceptando el build nuevo pendiente.
- **Cadencia acordada:** diff por fase, con OK antes de seguir (no todas encadenadas sin revisión, a pesar de que el flujo default del proyecto es "plan una vez, ejecutar todo").
- **Verificación mobile:** sin dispositivo/emulador en sesiones anteriores — esta vez sí, con Expo Go real en el celular de Fausto vía QR (`exp://<ip-lan>:8081`).

## Las 7 fases

**Fase 1 — Assets de marca.** Logo repintado a los colores oficiales del design system (oro `#c89a3a`, uva `#5a1320` — el SVG viejo usaba `#b08d3f`/`#4a2145`, fuera de paleta). Tres niveles de detalle nuevos: `logo.svg` (completa, ≥64px), `logo-reducido.svg` (24-64px), `logo-glifo.svg` (≤24px, solo el racimo) — reemplazan a `logo-mark.svg` (borrado al final de la sesión, sin referencias). Ícono adaptativo de Android corregido: fondo `#faf8f5` (casi blanco) lavaba la marca dorada al recortarse en círculo a 48px — pasa a `#7a1f2c`. Ícono de notificación agregado (faltaba del todo, Android lo aplanaba a un cuadrado blanco).

**Hallazgo real, no relacionado con el paquete, encontrado al probar:** `frontend/proxy.ts` redirigía **cualquier asset estático de `public/`** a `/login` para un visitante sin sesión — confirmado que el bug ya existía con el logo viejo, no lo introdujo esta sesión. El logo del login nunca se había visto para un visitante anónimo real (el navegador pedía la imagen, recibía el HTML de `/login`, mostraba el ícono de imagen rota). Corregido agregando las extensiones estáticas comunes (`svg/png/jpe?g/ico/webp`) a las rutas siempre públicas, sin tocar el resto de la lógica de auth — verificado que `/dashboard` sigue redirigiendo bien sin token.

**Fase 2 — Íconos unificados.** `react-native-svg` + `lucide-react-native` instalados. Vocabulario compartido `lib/icons.ts` (frontend y mobile) ampliado de 21 a **60 claves** — el original solo cubría navegación; mobile tenía ~90 usos de Ionicons con decenas de conceptos más (cerrar, chevrons, calendario, ojo/ojo tachado, huella, clima detallado por código WMO, etc.). Cada nombre de ícono se verificó contra el paquete real instalado (no se adivinó ninguno) — varios nombres "clásicos" de Lucide (`Fingerprint`, `AlertTriangle`, `XCircle`) están renombrados en versiones nuevas pero siguen disponibles como alias. 16 archivos de mobile migrados, incluidos los casos dinámicos (drawer de notificaciones, mapeo de clima por código WMO, toggles de ojo/checkbox). Tab bar: "Fitosanitario" → "Fito" (cabe sin apretar), color inactivo `#a09584`→`#5a544c` (mejor contraste al sol).

**Decisión de scope:** no se normalizaron los tamaños de ícono ad-hoc en los 53 archivos del frontend web que ya usan `lucide-react` con `size` explícito (14/15/18 en vez de la escala canónica 16/18/20/22/24) — volumen de cambio desproporcionado para una mejora visual imperceptible, no pedido con esa granularidad en ningún otro punto del documento.

**Fase 3 — Formularios y tokens.** Token `--color-borde: #e2dbcc` nuevo — los bordes usaban `--color-hueso` (`#fbfaf6`) sobre fondo blanco, ~1.5% de diferencia de luminancia, en la práctica invisibles. Reemplazo global `border-[#fbfaf6]` → `border-[#e2dbcc]`: 23 ocurrencias en 14 archivos (más que los 4 confirmados por el documento — el resto son pantallas agregadas después de esa auditoría). Autofill de Chrome neutralizado (pisaba el campo de celeste). En mobile, los `TextInput` que realmente usaban `colors.hueso` como borde se corrigieron a `colors.borde` — dejados afuera a propósito `perfil.tsx`/`cosecha.tsx`/`estado-campana.tsx`, cuyos inputs usan hex sueltos fuera de la paleta por completo (problema más grande, no pedido acá).

**Fase 4 — Login web y mobile.** Web: panel izquierdo de `w-[800px]` fijo a `w-[46%] max-w-[620px]`, franja de 3px burdeos, bloque de marca centrado. `FormError` component nuevo (reusable en el resto de formularios). Mobile — **este archivo no estaba leído en el documento original**: el "logo" era un círculo burdeos con las iniciales "LL" en texto, no la marca real — reemplazado por `logo-mark.png` (PNG nuevo, recortado sin relleno desde `logo.svg` para poder usarlo suelto en cualquier tamaño). Pie de página ahora lee la versión real de `app.json` vía `expo-constants` (agregado explícito) en vez de texto fijo sin versión.

**Fase 5 — Shell web (primera de riesgo medio).** Sidebar de 68px a 56px, ítems cuadrados con tooltip nuevo (antes solo `title` nativo del navegador), activo con fondo blanco pleno en vez de un velo de opacidad 12% casi invisible. El clima del topbar era texto fijo (`☀ 22°`, siempre) — se creó `ClimateWidget.tsx` extrayendo la lógica que ya existía duplicada en `dashboard/page.tsx` (mismo componente, cero cambio de comportamiento) y se agregó `ClimateMini`, la variante para el topbar: consulta `/clima/actual` con la finca real, "—" mientras carga, nada si falla. Fecha del Inicio corregida — **se confirmó el mecanismo antes de tocar** (el archivo no estaba leído): no era un `.replace()` capitalizando palabra por palabra como sospechaba el documento, era la clase Tailwind `capitalize` en el `<p>`. Los dos switchers (Finca/Campaña) unificados a los mismos colores.

**Fase 6 — Notificaciones y estados.** `Badge` (dot/count/label) en las dos plataformas. En `Alertas.tsx` + `BuzonModal.tsx` (solo presentación, `derivarAlertas()` y el descarte de 48h intactos): los 4 grises de Tailwind encontrados (2 en `Alertas.tsx`, 2 en `BuzonModal.tsx` — el documento los atribuía todos a "AlertasModal") pasaron a la paleta cálida. Etiqueta de nivel agregada junto al mensaje ("URGENTE"/"PENDIENTE"). `SyncBar.tsx` nuevo en mobile (offline/syncing/error/ok) — límite real encontrado: no hay forma de reintentar un ítem `failed` puntual (agotó 7 días de reintentos a propósito, para pedir revisión manual — tocar eso es lógica de negocio prohibida), así que "Reintentar" vuelve a procesar solo los pendientes (`processQueue`, ya exportado).

**Fase 7 — Header mobile, mapa y pulido (segunda de riesgo medio).** Header mobile reconstruido: blanco de punta a punta, sin título de pantalla duplicado, glifo + finca + campaña (calculada por fecha, mismo criterio que web) + campanita + avatar de contorno (sin el dorado, que era el único elemento oro de la pantalla). La campanita abre el drawer directo en "Notificaciones" — requirió agregarle un handle imperativo a `UserBadge` (cambio de API interno, sin lógica de negocio). **Feedback real en dispositivo, corregido en la misma sesión:** el header quedaba pegado contra la barra de estado del sistema (reloj/batería), sin el `paddingTop` del safe-area (notch/isla dinámica) — corregido con `useSafeAreaInsets()`, y la altura real medida por `onLayout` se pasa a `SyncBar` para que se ancle bien en cualquier dispositivo.

**Mapa — el cambio de mayor riesgo real de toda la sesión, aplicado con autorización explícita.** Causa confirmada en código (no en captura): Leaflet agregaba su control de zoom por defecto en la misma esquina que el botón de modo de color (`#mode-btn`), se superponían — por eso a veces solo se veía el "−". Reubicado abajo a la derecha, en columna con el botón de refrescar nativo. Las dos leyendas duplicadas (panel "Capas" + leyenda "TIPO", mismos 5 ítems de infraestructura repetidos) se fusionaron en un solo panel — **sin agregar ningún filtro nuevo**: la sección de tipos de parcela sigue siendo solo informativa, igual que antes, porque esa función no existe hoy y no se quiso inventar. Los 5 checkboxes de infraestructura siguen prendiendo/apagando capas de verdad, solo reubicados.

Pill de fase fenológica en Inicio: lavanda fijo (fuera de paleta) → color real de cada fase con fondo al 12%, usando `fenologiaColors` (existía en `frontend/lib/theme.ts` pero nunca se había espejado a mobile ni conectado en ningún lado, ni siquiera en web). "✦ Estimado automático" → "Estimado según fecha de campaña", sin símbolo. `EmptyState` nuevo en las dos plataformas. Gráfico de flujo web: presupuesto pasa a área rellena al 12% (antes línea punteada casi indistinguible de la real), egresos `#9a3140`, ingresos `#3f5c3a`.

**Descartado con confirmación explícita de Fausto:** el punto "Hoy registraste" en Inicio (movimientos del día) — requería combinar 4 endpoints de listado que no existían combinados, la única parte del paquete que era una feature real y no solo estilo.

## Verificación

`tsc --noEmit` limpio en ambas plataformas en cada fase. `npm run build` corrido dos veces (fin de Fase 7 y fin de sesión) — limpio, sin warnings nuevos, 33 rutas generadas. Mobile probado en vivo con Expo Go en el celular de Fausto — confirmó explícitamente que el mapa "quedó joya" y el header (tras el fix de safe-area) "se ve bien".

## Merge y deploy

`feature/estetica-v1` (8 commits, uno por fase + 1 de cleanup del `logo-mark.svg` muerto) mergeado a `main` con `--no-ff`. Pusheado a GitHub — Railway redesplegó el backend solo (sin cambios de este paquete, solo la migración de WhatsApp que venía en el commit previo), `vercel --prod` corrido para el frontend. Sin pendientes bloqueantes de este paquete al cierre.

## Pendiente real

1. **Build nuevo de mobile por `react-native-svg`** — los íconos de la Fase 2 no van a llegar a los celulares ya instalados hasta que se haga `eas build` + se resuba a Play Console. Conviene hacerlo junto con el próximo build real (ver la nota de sesión sobre Play Store del mismo día).
2. `docs/DESIGN_SYSTEM.md` tenía 2 menciones viejas a `logo-mark.svg` — corregidas.

## Ver también

- [[Sistema de Gestión Agrícola]]
- [[Bugs Conocidos]]
- [[2026-08-28-play-store-produccion-ios-fix-parcelas]]
