# Prompts para Claude CLI

Uno por fase, en orden. Cada uno asume que el anterior está aplicado y aprobado.
Copiar y pegar tal cual.

---

## 0 · Arranque — leer primero

```
Vamos a hacer una mejora puramente estética de la app. Reglas del trabajo:

1. Leé docs/ESTETICA.md completo antes de tocar nada. Es la especificación.
2. NO cambies lógica de negocio, queries, endpoints, schemas ni migraciones.
   Si un cambio estético requiere tocar lógica, pará y avisame.
3. Podés tocar: tokens, CSS, assets, className, estilos inline, y crear
   componentes de presentación nuevos (Badge, EmptyState, SyncBar, FormError).
4. Trabajamos por fases. Al terminar cada fase, mostrame el diff y esperá mi OK
   antes de seguir. No encadenes fases.
5. Cada hallazgo del documento dice si está VERIFICADO EN CÓDIGO (se leyó el
   archivo en main, los valores son exactos) u OBSERVADO EN CAPTURA (el síntoma
   es visible pero no se confirmó el mecanismo). En los segundos: leé el archivo,
   confirmá que el diagnóstico aplica, y si no aplica avisame en lugar de
   improvisar un arreglo.
6. Antes de empezar, confirmame en una frase qué entendiste de las reglas
   no negociables de la sección 0 del documento.

Rama: git checkout -b feature/estetica-v1
```

---

## 1 · Assets de marca

Riesgo: nulo. No se toca ningún `.tsx`.

```
Fase 1 — Assets de marca. Seguí docs/ESTETICA.md sección 2.

Los SVG ya están resueltos en estetica/assets/. No los dibujes de nuevo:
sólo generá los PNG a partir de ellos.

1. Verificá que estos seis archivos existan en estetica/assets/:
   logo.svg · logo-reducido.svg · logo-glifo.svg · notification.svg
   app-icon.svg · app-icon-sin-wordmark.svg

2. Corré el script de generación:
       pip install cairosvg pillow
       python estetica/scripts/gen_assets.py

   Genera: mobile/assets/{icon,adaptive-icon,notification-icon,splash-icon,favicon}.png
   y frontend/public/{logo,logo-reducido,logo-glifo}.svg + favicon.ico

3. Revisá a ojo los PNG generados. Tres cosas que tienen que cumplirse:
   - adaptive-icon.png con fondo TRANSPARENTE y la marca al 60% como máximo
     (Android recorta en círculo y descarta lo que quede fuera del 66% central)
   - notification-icon.png en blanco puro, sin gris ni antialias de color
   - icon.png lleva el wordmark "LOS LIRIOS"; adaptive-icon.png NO lo lleva

4. Actualizá mobile/app.json siguiendo estetica/mobile/app.json.patch:
   - android.adaptiveIcon.backgroundColor: "#faf8f5" → "#7a1f2c"
   - splash.backgroundColor → "#faf6ec"
   - en el plugin expo-notifications AGREGAR:
       "icon": "./assets/notification-icon.png"

5. En frontend/, buscá los usos de /logo-mark.svg y reemplazalos según el tamaño:
   ≥64px → /logo.svg · 24-64px → /logo-reducido.svg · ≤24px → /logo-glifo.svg
   En dashboard/layout.tsx el <img> del sidebar pasa a /logo-reducido.svg Y
   se le saca el filter: brightness(0) invert(1) — el SVG nuevo ya viene con
   los colores correctos para fondo burdeos.

6. Probá que el frontend levanta: cd frontend && npm run dev

Mostrame el diff de app.json y la lista de PNG con sus dimensiones.
```

---

## 2 · Íconos unificados

Riesgo: bajo.

```
Fase 2 — Sistema de íconos. Seguí docs/ESTETICA.md sección 3.

1. Instalá en mobile:
       cd mobile && npx expo install lucide-react-native react-native-svg

2. Copiá estetica/frontend/lib/icons.ts a frontend/lib/icons.ts y
   estetica/mobile/lib/icons.ts a mobile/lib/icons.ts.
   Los exports de Lucide ya están verificados en esos archivos. NO los cambies
   ni los adivines: si te falta un concepto, buscalo en lucide.dev y agregalo
   EN LOS DOS archivos con la misma clave.

3. IMPORTANTE: no dupliques los íconos de navegación. frontend/lib/navigation.ts
   ya importa LayoutDashboard, Map, Sprout, DollarSign, BookOpen y Settings y los
   usa en ALL_NAV. Esos se quedan exactamente como están.

4. Reemplazá los Ionicons de mobile/app/(tabs)/_layout.tsx por los de Lucide.
   Además:
   - tabBarInactiveTintColor de #a09584 a #5a544c (hoy es 2.4:1, muy bajo
     para uso al sol)
   - el título de la pestaña "Fitosanitario" pasa a "Fito" — es el término
     que usan en el campo y cabe sin apretar a las vecinas
   - size 20, strokeWidth 1.75

5. Buscá el resto de usos de Ionicons en mobile (grep "Ionicons") y reemplazalos
   con el mapa. Si aparece un concepto que no está, agregalo al mapa en los dos
   archivos — no lo importes suelto.

6. En web, revisá que los usos de lucide-react pasen size y strokeWidth explícitos
   según la escala de la sección 3.3.

Mostrame primero el diff de _layout.tsx, después el resto agrupado por archivo.
```

---

## 3 · Formularios y tokens

Riesgo: bajo.

```
Fase 3 — Formularios. Seguí docs/ESTETICA.md sección 4 y
estetica/frontend/app/globals.css.patch.

1. En frontend/app/globals.css agregá el token que falta:
       --color-borde: #e2dbcc;
   y exponelo en @theme inline como --color-border.

2. Corregí .input:
   - border-color de var(--color-hueso) a var(--color-borde)
   - hover: var(--color-niebla)
   - focus: var(--color-burdeos-600) + box-shadow 0 0 0 3px al 12%
   Y .btn--secondary: border-color de var(--color-ink) —demasiado duro— a
   var(--color-borde), con hover en var(--color-niebla).

3. Agregá la neutralización del autofill:
       input:-webkit-autofill,
       input:-webkit-autofill:hover,
       input:-webkit-autofill:focus,
       input:-webkit-autofill:active {
         -webkit-box-shadow: 0 0 0 1000px var(--color-blanco) inset !important;
         -webkit-text-fill-color: var(--color-ink) !important;
         caret-color: var(--color-ink);
         transition: background-color 9999s ease-out 0s;
       }

4. Reemplazo global en frontend/: border-[#fbfaf6] → border-[#e2dbcc]
   Confirmado presente en: app/dashboard/layout.tsx (header del topbar, botón ⌘K,
   barra de sub-nav, spinner), components/Alertas.tsx, components/FincaSwitcher.tsx,
   components/CampanaSwitcher.tsx.

5. Agregá colors.borde a frontend/lib/theme.ts y a mobile/lib/theme.ts.

6. En mobile, los TextInput que usen colors.hueso como borderColor pasan a
   colors.borde.

Mostrame el diff de globals.css primero, después la lista de archivos tocados.
```

---

## 4 · Login web y mobile

Riesgo: bajo.

```
Fase 4 — Login. Seguí docs/ESTETICA.md sección 5.

WEB — frontend/app/login/page.tsx:
1. El panel izquierdo pasa de w-[800px] a w-[46%] max-w-[620px].
2. El contenido deja de estar en justify-between y pasa a un bloque único
   centrado verticalmente: logo (72px, /logo.svg) → título → subtítulo →
   filete de oro de 28x2 → línea de pie. Todo alineado a la izquierda con el
   mismo margen.
3. Franja de 3px en #7a1f2c en el borde superior del panel.
4. Los inputs a border-[#e2dbcc], foco con ring burdeos.
5. El botón de mostrar contraseña usa Eye/EyeOff de lucide a size 18.

COMPARTIDO:
6. Creá frontend/components/ui/FormError.tsx: fondo #fbeced, borde #f3d5d8,
   ícono AlertTriangle 16, título en negrita y descripción.
   Usalo en el login y dejalo listo para el resto de formularios.

MOBILE — mobile/app/(auth)/login.tsx:
   (este archivo no fue leído: revisalo antes y avisame si difiere mucho)
7. Sin header burdeos: blanco de punta a punta.
8. Bloque de marca centrado en el tercio superior: logo 78px, "Los Lirios SA"
   en Fraunces 17, subtítulo en 11.5.
9. Campos de 46px de alto, radio 11, borde colors.borde.
10. Botón Ingresar de 52px, radio 12, burdeos-600.
11. Divisor "O" con líneas a los costados.
12. Biometría SECUNDARIA: borde 1.5 ink, mismo alto, texto "Ingresar con huella"
    (no Face ID — el parque real es Android).
13. Pie con la versión leída de app.json, no hardcodeada.

Un archivo por vez, con diff, esperando OK.
```

---

## 5 · Shell web

Riesgo: medio. Es la fase más delicada.

```
Fase 5 — Shell. Seguí docs/ESTETICA.md sección 6.

Los valores actuales de layout.tsx están verificados contra main. Si no coinciden
con lo que ves, pará y avisame antes de editar.

1. frontend/app/dashboard/layout.tsx — el <aside>:
   - hoy es w-[68px]; pasa a w-[56px]
   - en SidebarItem se elimina el <span> de la etiqueta
   - el Link pasa de "flex flex-col ... w-14 py-2.5" a un cuadrado w-10 h-10
     con rounded-[10px], centrado
   - activo: backgroundColor '#FFFFFF' y el ícono en color '#7a1f2c'
     (hoy es un velo rgba(255,255,255,0.12) que casi no se distingue)
   - inactivo: el ícono de rgba(255,255,255,0.55) a rgba(255,255,255,0.82)
   - el title={item.label} YA ESTÁ en cada Link. Agregá el tooltip visual:
     absolute left-full ml-2, bg #1f1a17, texto blanco 11px, rounded-md,
     px-2 py-1, whitespace-nowrap, 120ms de retardo, invisible por defecto y
     visible en group-hover. Poné "group relative" en el Link.
   - aplicá lo mismo al botón de Cerrar sesión, que repite la estructura

2. Los bordes del shell están en #fbfaf6, invisible sobre blanco. En este archivo
   hay cuatro: el <header> del topbar, el botón de ⌘K, la barra de sub-nav y el
   spinner de carga. Todos a #e2dbcc.

3. El indicador de clima del topbar es texto fijo. Hoy dice literalmente:
       <span className="text-sm text-[#5a544c]" aria-label="Clima">☀ 22°</span>
   Reemplazalo por el ClimateWidget en variante mini, con la finca del
   contextStore. Mientras carga mostrá "—"; si el fetch falla, no renderices
   nada. Esto explica la contradicción con la tarjeta del cuerpo: el topbar
   nunca consultó nada.

4. FincaSwitcher y CampanaSwitcher tienen que verse hermanos. Hoy Finca usa
   border-[#7a1f2c] y Campaña border-[#c89a3a]: mismo tipo de control con dos
   acentos distintos. Los dos pasan a border-[#e2dbcc] con bg-white, texto
   #1f1a17 y chevron #a09584. El hover de bg-[#f0e8d8] a bg-[#fbfaf6].
   El font-mono con tabular-nums del número de campaña se conserva.

5. frontend/app/dashboard/page.tsx — la fecha sale como "Miércoles, 26 De Agosto
   De 2026". Buscá el capitalize de CSS (o el .replace que capitaliza palabra por
   palabra) y reemplazalo por:
       const f = d.toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
       const fecha = f.charAt(0).toUpperCase() + f.slice(1)
   Resultado esperado: "Miércoles, 26 de agosto de 2026".
   Este archivo NO fue leído: confirmá el mecanismo antes de tocarlo.

Mostrame el layout primero.
```

---

## 6 · Notificaciones y estados

Riesgo: bajo.

```
Fase 6 — Notificaciones. Seguí docs/ESTETICA.md sección 8.

Alertas.tsx está leído: ya tiene buzón con descarte de 48h, carencia
fitosanitaria priorizada por seguridad alimentaria, y resumen de 3 + "ver todas".
Esa lógica NO SE TOCA. Los cambios son sólo de presentación.

1. Creá frontend/components/ui/Badge.tsx con tres variantes:
   - dot: 9px, burdeos-600, anillo de 2px del color de fondo
   - count: mínimo 17px de alto, hasta 9 y después "9+"
   - label: texto corto en caps, sólo para estados con nombre
   Props: variant, value, ringColor. Nunca label para conteos.

2. frontend/components/Alertas.tsx — sólo presentación:
   a) Sacá los grises de Tailwind. Cuatro apariciones en AlertasModal:
      border-gray-100 → border-[#e2dbcc]
      hover:bg-gray-100 → hover:bg-[#fbfaf6]
      Los grises de Tailwind son neutros fríos y la paleta es cálida: juntos,
      el gris se ve azulado.
   b) El punto de color de 1.5px no dice nada solo. Agregá al lado del mensaje
      una etiqueta de nivel en caps de 10px:
      nivel 'warn' → "URGENTE" en #a3293a
      nivel 'info' → "PENDIENTE" en #8a6a1f
   c) El borde de la tarjeta y del modal de #fbfaf6 a #e2dbcc.
   d) El "+N más — ver todas" pasa de text-xs #a09584 a 11px peso 600 en
      #7a1f2c: es la acción de la tarjeta, tiene que leerse como acción.
   e) NO agregues navegación por alerta en esta fase. Las alertas se derivan en
      vivo de varios endpoints y el destino de cada tipo no es obvio. Si te
      parece que vale la pena, proponémelo y lo decidimos aparte.

3. Creá mobile/components/SyncBar.tsx — barra de 32px bajo el header, visible
   SÓLO cuando hay estado que mostrar:
   - ok: #eef2ed / #3f5c3a, se auto-oculta a los 3 segundos
   - offline: #f7edd8 / #8a6a1f, persistente, con el conteo en cola
   - syncing: #eaf0f4 / #3d6b86, con barra de avance
   - error: #fbeced / #a3293a, con acción "Reintentar"
   Conectala al estado de cola que ya existe en mobile/lib/cache.
   En estado normal no se muestra nada: un indicador permanente en verde deja
   de leerse a los dos días y ocupa altura donde cada píxel cuenta.

4. En mobile/components/UserBadge.tsx reemplazá el badge de notificaciones del
   drawer por el componente Badge nuevo.

Mostrame Badge primero, después el diff de Alertas, después SyncBar.
```

---

## 7 · Header mobile, mapa y pulido

Riesgo: medio.

```
Fase 7 — Header mobile y pulido. Seguí docs/ESTETICA.md secciones 7 y 9.

HEADER — mobile/app/(tabs)/_layout.tsx:
1. El header pasa a BLANCO: backgroundColor #ffffff, borde inferior #e2dbcc,
   altura ~41px.
2. Se ELIMINA el título de pantalla del header (headerTitle vacío o headerShown
   con un componente propio). Hoy dice "Inicio" arriba mientras la pestaña Inicio
   está resaltada abajo: la misma palabra dos veces, y una cuesta 40px.
3. El header lleva, de izquierda a derecha:
   - glifo de la marca a 20px (/logo-glifo.svg o el componente equivalente)
   - finca activa en 11px peso 700 #1f1a17, y campaña debajo en 8px #5a544c
   - campanita (Bell 17, #5a544c) con Badge variant="dot"
   - avatar
4. AVATAR de contorno: círculo de 26px, fondo transparente, borde 1.5px #ddd6ca,
   iniciales en #1f1a17 peso 800, hitSlop de 12 para llegar al mínimo táctil de 44.
   Se elimina el fondo dorado: era el único elemento oro de la pantalla y por eso
   se leía como un badge de aviso en lugar de un avatar.
5. OBLIGATORIO: la barra de estado también pasa a claro.
   <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
   Si queda en burdeos con iconos claros, aparece una franja de color huérfana
   arriba del header — peor que el problema original.

MAPA — mobile/app/(tabs)/mapa.tsx (archivo NO leído: revisalo primero):
6. Unificar las dos leyendas. Hoy hay un panel "Capas" arriba a la derecha y una
   leyenda "TIPO" abajo a la izquierda que repiten el mismo contenido. Fusionalos
   en un solo panel desplegable donde cada fila tenga checkbox + muestra de color
   + etiqueta, en dos secciones: "Tipos de parcela" (filtro: afecta qué se ve) e
   "Infraestructura" (capa: afecta qué se dibuja encima).
7. Agrupar los controles: arriba a la derecha el botón del panel; abajo a la
   derecha, en columna, zoom + / zoom − / refrescar. Hoy el "−" está solo arriba
   a la izquierda SIN su "+": completá el par.

INICIO — mobile/app/(tabs)/index.tsx (archivo NO leído):
8. El pill de fase fenológica usa un lavanda que no está en la paleta. Mapealo a
   fenologiaColors de lib/theme.ts. Reposo invernal debe usar ink60 con fondo al
   12%, no lavanda.
9. Reemplazá "✦ Estimado automático" por "Estimado según fecha de campaña", sin
   símbolo, en colors.ink60 y tamaño small. El destello se lee como etiqueta de
   IA; en una herramienta donde el dato tiene consecuencias económicas conviene
   un lenguaje más sobrio.
10. La pantalla queda con más de la mitad vacía. Agregá debajo de las tareas
    recomendadas una sección "Hoy registraste" con los movimientos del día, y si
    no hay ninguno un EmptyState sobrio.

COMPARTIDO:
11. Creá EmptyState en las dos plataformas (mobile/components/ui/ y
    frontend/components/ui/): ícono 24 en #a09584, título 15 en #1f1a17,
    descripción 13 en #5a544c, acción opcional. Sin ilustraciones ni emojis.

GRÁFICO — frontend/app/dashboard/page.tsx:
12. El flujo acumulado tiene 4 series y las de presupuesto son punteadas casi
    indistinguibles. Presupuesto pasa a área rellena al 12% de opacidad; real
    queda como línea sólida de 2px encima. Egresos #9a3140, ingresos #3f5c3a.
    Verificá cómo están declaradas las series: esto salió de una captura.

Última fase. Al terminar corré npm run build en frontend y avisame si hay algún
warning nuevo.
```

---

## Checklist antes de mergear

- [ ] `cd frontend && npm run build` sin errores
- [ ] El ícono de la app se distingue en el cajón de apps a 48px
- [ ] La notificación muestra el racimo, no un cuadrado blanco
- [ ] El favicon se reconoce en la pestaña del navegador
- [ ] Los campos del login tienen borde visible
- [ ] El autofill de Chrome no pinta el campo de celeste
- [ ] El clima del topbar coincide con el de la tarjeta del cuerpo
- [ ] La fecha dice "26 de agosto", no "26 De Agosto"
- [ ] El sidebar no trunca ninguna etiqueta
- [ ] El ítem activo del sidebar se distingue sin esforzar la vista
- [ ] Los dos switchers se ven hermanos
- [ ] El header mobile es blanco y la barra de estado también
- [ ] El avatar no es un círculo dorado flotando
- [ ] El tab bar dice "Fito", no "Fitosanitario"
- [ ] No quedan Ionicons en mobile (`grep -r Ionicons mobile/`)
- [ ] No quedan `border-[#fbfaf6]` en frontend
- [ ] No quedan `gray-100` en Alertas.tsx
- [ ] El mapa mobile tiene una sola leyenda
- [ ] El zoom del mapa tiene "+" y "−"

---

## Si algo se rompe

1. Pegale el error a Claude CLI y pedile que diagnostique.
2. Si una pantalla rompe del todo: `git stash` y comparar con main.
3. Los assets se regeneran corriendo el script de nuevo. Nada de la Fase 1 es
   destructivo salvo los PNG, que están en git.
