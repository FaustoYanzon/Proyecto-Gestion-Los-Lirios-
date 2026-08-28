# Los Lirios — Especificación estética

Fuente de verdad para las mejoras visuales de la app web y mobile.
Ante una discrepancia entre este documento y el código, gana este documento.

**Alcance: sólo estética.** Ningún cambio de lógica de negocio, endpoints,
schemas, migraciones, queries ni reglas de permisos.

---

## 0 · Invariantes

### Prohibido tocar

- Endpoints, rutas y contratos de la API.
- Modelos, schemas y migraciones de Alembic.
- Queries de TanStack, claves de cache, lógica de invalidación.
- Stores de Zustand: forma del estado y acciones.
- Reglas de negocio: cálculos, validaciones, permisos por rol.
- La cola de sincronización offline de `mobile/lib/cache`.
- La lógica de `derivarAlertas` y el descarte de 48h de `Alertas.tsx`.
- Cualquier archivo dentro de `backend/`.

### Permitido

- Tokens de color, tipografía, espaciado, radio y sombra.
- `globals.css` y los dos `theme.ts`.
- Assets: SVG, PNG, favicon, íconos de Expo.
- `className`, estilos inline y `StyleSheet`.
- Reordenar elementos visuales dentro de una pantalla.
- Componentes de presentación nuevos: Badge, EmptyState, SyncBar, FormError, Skeleton.
- Textos de interfaz: etiquetas, títulos, mensajes de estado vacío.

### La regla de oro

Si un cambio estético obliga a tocar algo de la lista prohibida: **parar y preguntar.**
No resolverlo por cuenta propia.

---

## 1 · Procedencia de los hallazgos

Cada hallazgo de este documento está marcado:

- **Verificado en código** — se leyó el archivo en `main`, los valores son exactos.
- **Observado en captura** — el síntoma es visible pero no se confirmó el mecanismo.
  En estos casos: leer el archivo, confirmar que el diagnóstico aplica, y si no aplica,
  avisar en lugar de improvisar.

Archivos leídos en `main`: `frontend/app/globals.css`, `frontend/lib/theme.ts`,
`frontend/app/layout.tsx`, `frontend/app/login/page.tsx`,
`frontend/app/dashboard/layout.tsx`, `frontend/lib/navigation.ts`,
`frontend/components/Alertas.tsx`, `frontend/components/FincaSwitcher.tsx`,
`frontend/components/CampanaSwitcher.tsx`, `frontend/public/logo-mark.svg`,
`mobile/app.json`, `mobile/app/(tabs)/_layout.tsx`.

**Sin leer**: `frontend/app/dashboard/page.tsx`, `mobile/app/(tabs)/index.tsx`,
`mobile/app/(tabs)/mapa.tsx`, `mobile/app/(auth)/login.tsx`.

---

## 2 · Marca

### 2.1 · Colores

El SVG actual usa `#b08d3f` (dorado) y `#4a2145` (violeta). Ninguno de los dos
está en el design system, que define oro `#c89a3a` y burdeos `#7a1f2c`.
El `#4a2145` lee ciruela, no vino: contra el sidebar burdeos la mezcla se enturbia.

**Decisión:** repintar a los tokens oficiales, sin tocar una sola coordenada.

| Antes | Después | Rol |
|---|---|---|
| `#b08d3f` | `#c89a3a` | oro — pétalos y tallo |
| `#4a2145` | `#5a1320` | uva — bayas |
| `#8a5580` | `#9a3140` | brillo de las bayas |

### 2.2 · Tres niveles de detalle

`logo-mark.svg` tiene 12 formas en un lienzo de 80×100. En el favicon y en el
header del sidebar se convierte en una mancha.

| Nivel | Tamaño | Formas | Archivo | Dónde |
|---|---|---|---|---|
| Completa | ≥64px | 12 | `logo.svg` | login, splash, reportes, membrete |
| Reducida | 24–64px | 8 | `logo-reducido.svg` | sidebar, topbar, header mobile |
| Glifo | ≤24px | 5 | `logo-glifo.svg` | favicon, pestaña, badges |

La reducida elimina los brillos, el zarcillo, el estambre y el cuarto pétalo.
El glifo es sólo el racimo y el cabito: a ese tamaño la flor no se lee.

### 2.3 · Ícono de la aplicación

**Monograma M4.** Racimo en triángulo invertido (5·4·3·2·1 bayas, r=18) al 28%
de opacidad, con el cabito visible arriba. LL en Fraunces 92 sobre fondo burdeos
con degradado. Filete de oro y "LOS LIRIOS" al pie.

**Dos variantes, no una:**

- `app-icon.svg` — con wordmark. Para `icon.png` (1024) y tamaños ≥64px.
- `app-icon-sin-wordmark.svg` — sin wordmark, LL más grande. Para
  `adaptive-icon.png` y ≤48px, donde "LOS LIRIOS" es una mancha y no un texto.

**El lirio no está en el ícono.** El logo completo lo conserva en login, splash
y reportes, así que la marca no lo pierde — pero conviene saberlo.

### 2.4 · Ícono de notificación

Android descarta todos los canales de color y usa sólo el alfa. Sin un ícono
declarado, aplana el de la app y muestra un cuadrado blanco en la barra de estado.

`notification-icon.png`: 96×96, sólo el racimo, blanco puro `#ffffff` sobre
transparente, sin antialias de color. El `color: "#7a1f2c"` del plugin tiñe el
círculo de la notificación expandida.

---

## 3 · Íconos

### 3.1 · Una sola familia

Web usa `lucide-react` (grilla 24, trazo 2). Mobile usa Ionicons (grilla 512,
trazo variable, estilo iOS). El mismo concepto se dibuja distinto en cada plataforma:
el portapapeles de Tareas en mobile lee como un rectángulo vacío.

**Decisión: Lucide en las dos.** Existe `lucide-react-native` con la misma grilla
y el mismo set. Phosphor es más elegante, pero migrar el web entero tiene costo
sin beneficio proporcional.

    npx expo install lucide-react-native react-native-svg

### 3.2 · Vocabulario

Los nombres son los **exports reales** de Lucide. Verificar contra lucide.dev
antes de escribir el archivo: no adivinar.

Los siete de navegación son los que `frontend/lib/navigation.ts` ya declara en
`ALL_NAV`. **Se adoptan tal cual, no se reemplazan.**

| Clave | Export | Concepto |
|---|---|---|
| `inicio` | `LayoutDashboard` | Inicio |
| `mapa` | `Map` | Mapa |
| `produccion` | `Sprout` | Producción |
| `finanzas` | `DollarSign` | Finanzas |
| `documentacion` | `BookOpen` | Documentación |
| `admin` | `Settings` | Admin |
| `salir` | `LogOut` | Cerrar sesión |
| `tarea` | `ClipboardList` | Tarea / jornal |
| `riego` | `Droplet` | Riego |
| `fitosanitario` | `FlaskConical` | Fitosanitario |
| `cosecha` | `ShoppingBasket` | Cosecha |
| `campana` | `Grape` | Estado de campaña |
| `parcela` | `Wheat` | Parcela |
| `notificacion` | `Bell` | Notificaciones |
| `usuario` | `User` | Usuario |
| `buscar` | `Search` | Buscar |
| `capas` | `Layers` | Capas del mapa |
| `dashboard` | `BarChart3` | Dashboard |
| `alerta` | `AlertTriangle` | Alerta |
| `clima` | `Sun` | Clima |
| `termografo` | `Gauge` | Termógrafo |

### 3.3 · Calibración

| Tamaño | Grosor | Uso |
|---|---|---|
| 16 | 1.75 | dentro de texto, celdas de tabla |
| 18 | 1.75 | botones, chips, inputs |
| 20 | 1.75 | tab bar mobile, ítems de lista |
| 22 | 1.75 | sidebar web, headers |
| 24 | 1.5 | encabezados de sección, estados vacíos |

**Color:** hereda del texto que acompaña. Activo `#7a1f2c`, inactivo `#5a544c`.
El tab bar hoy usa `#a09584` para el inactivo: 2.4:1, muy bajo para uso al sol.

---

## 4 · Formularios

### 4.1 · Bordes invisibles — verificado en código

Los bordes usan `--color-hueso` (`#fbfaf6`) sobre fondo blanco: ~1.5% de
diferencia de luminancia. En la práctica el campo no tiene borde.

Token nuevo: `--color-borde: #e2dbcc`.

| Estado | Color |
|---|---|
| Reposo | `#e2dbcc` |
| Hover | `#a09584` |
| Foco | `#7a1f2c` + halo de 3px al 12% |
| Error | `#a3293a` |

Presente también en el shell: header del topbar, botón ⌘K, barra de sub-nav,
spinner de carga, y los dropdowns de los dos switchers.

### 4.2 · Autofill de Chrome — verificado en captura

El campo Contraseña aparece con fondo celeste: es el autofill pisando el
background con su color del sistema. Rompe la paleta en la primera pantalla.

Se neutraliza con `-webkit-box-shadow` inset y `-webkit-text-fill-color`.

---

## 5 · Login

### 5.1 · Web

El panel izquierdo está fijado en `w-[800px]`: en un monitor de 1440px eso es
el 55% de la pantalla para tres líneas de texto y un logo de 40px. No lee como
minimalismo sino como una pantalla sin terminar.

- Panel al **46%** con tope de **620px**.
- Contenido en un bloque único centrado verticalmente: logo 72px → título →
  subtítulo → filete de oro 28×2 → línea de pie.
- Franja de 3px en `#7a1f2c` en el borde superior del panel.
- El logo usa `/logo.svg` (marca completa), no `logo-mark.svg`.

### 5.2 · Mobile

- Sin header burdeos: blanco de punta a punta. El color entra al ingresar.
- Marca a 78px centrada en el tercio superior.
- Campos de 46px, botón de 52px.
- Biometría como acción **secundaria** con borde, no botón lleno.
- Texto: "Ingresar con huella" — el parque real es Android, no Face ID.
- Versión al pie leída de `app.json`, no hardcodeada.

### 5.3 · Errores

`FormError`: fondo `#fbeced`, borde `#f3d5d8`, ícono `AlertTriangle` 16,
título en negrita y descripción. Mismo componente en las dos plataformas.
Nunca un `alert` nativo.

---

## 6 · Shell web

### 6.1 · Sidebar — verificado en código

Estado actual: `w-[68px]`, ítems de `w-14` (56px) con `py-2.5` y `rounded-xl`,
ícono `size={20} strokeWidth={1.5}`, etiqueta `text-[9px] font-bold uppercase
tracking-wide`. Activo `rgba(255,255,255,0.12)`, inactivo `rgba(255,255,255,0.55)`.

Problemas:

1. `item.short` de "Producción" es `"Prod."` — no entra en 56px.
2. Siete etiquetas en caps de 9px con tracking, apiladas en vertical.
3. El activo es un velo del 12% de blanco: el elemento más importante de la
   navegación es el peor señalado.
4. El inactivo al 55% sobre texto de 9px queda al límite de lo legible.

Solución: **sólo íconos con tooltip.** El `title={item.label}` ya está puesto
en cada `Link`; falta el tooltip visual.

- `w-[56px]`, ítems de `w-10 h-10` con `rounded-[10px]`.
- Activo: fondo `#FFFFFF` pleno, ícono `#7a1f2c`.
- Inactivo: ícono a `rgba(255,255,255,0.82)`.
- Tooltip: `absolute left-full ml-2`, fondo `#1f1a17`, texto blanco 11px,
  `rounded-md px-2 py-1 whitespace-nowrap`, 120ms de retardo, `group-hover`.
- El logo del tope pasa a `/logo-reducido.svg` y se elimina el
  `filter: brightness(0) invert(1)`: el SVG nuevo ya trae los colores correctos.

### 6.2 · Clima del topbar — verificado en código, crítico

Es texto fijo:

    <span className="text-sm text-[#5a544c]" aria-label="Clima">☀ 22°</span>

Veintidós grados, para siempre, en cualquier finca y cualquier estación. Por eso
contradice a la tarjeta del cuerpo, que sí consulta `/clima/actual`.

Reemplazar por `ClimateWidget` en variante mini, con la finca del `contextStore`.
Mientras carga, un guion. Si falla, no renderizar nada. **Un dato inventado es
peor que ningún dato.**

### 6.3 · Switchers — verificado en código

`FincaSwitcher` usa `border-[#7a1f2c]` y `CampanaSwitcher` `border-[#c89a3a]`.
Son el mismo tipo de control, uno al lado del otro, con dos acentos distintos:
el color sugiere una jerarquía que no existe, y el oro queda gastado donde no
hace falta.

Los dos: `border-[#e2dbcc]`, `bg-white`, texto `#1f1a17`, chevron `#a09584`,
hover `bg-[#fbfaf6]`. El `font-mono` con `tabular-nums` del número de campaña
se conserva: está bien.

### 6.4 · Fecha — observado en captura

Sale como "Miércoles, 26 De Agosto De 2026". En castellano los meses y las
preposiciones van en minúscula. La forma en que se rompe es la firma de un
`capitalize` de CSS sobre una fecha ya formateada.

    const f = d.toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
    const fecha = f.charAt(0).toUpperCase() + f.slice(1)

Confirmar el mecanismo antes de editar: el archivo no fue leído.

---

## 7 · Header mobile

### 7.1 · El problema

Barra de estado teñida más header: ~90px del color más saturado del sistema.
Cinco problemas, en orden de peso:

1. **El título repite la pestaña activa.** Dice "Inicio" arriba y abajo la pestaña
   Inicio está resaltada. La misma palabra dos veces, y una cuesta 40px.
2. **El círculo dorado no tiene hermanos.** Es el único elemento dorado de la
   pantalla. Un color que aparece una sola vez no se lee como sistema: se lee
   como aviso.
3. **Oro sobre burdeos es la firma del logo.** Usarla para el avatar le quita a
   la marca su gesto distintivo y se lo da a un elemento secundario.
4. **90px sin información.** No dice la finca activa, ni la campaña, ni si hay
   notificaciones.
5. **En el mapa pelea con la imagen satelital.**

### 7.2 · Header blanco

- Fondo `#ffffff`, borde inferior `#e2dbcc`, altura ~41px.
- Izquierda: glifo de la marca a 20px.
- Centro: finca activa (11px, peso 700) y campaña debajo (8px, `#5a544c`).
- Derecha: campanita con badge de punto, y el avatar.
- **El título de pantalla se elimina del header.** La pestaña activa ya lo dice.
- El burdeos pasa a aparecer sólo donde significa algo: pestaña activa, botones
  de acción, tarjetas destacadas.

**Consecuencia obligatoria:** la barra de estado también pasa a claro
(`barStyle="dark-content"`, fondo blanco). Si queda en burdeos con iconos claros,
aparece una franja de color huérfana arriba del header — peor que el problema original.

### 7.3 · Avatar de contorno

Círculo transparente con borde `#ddd6ca` de 1.5px e iniciales en `#1f1a17`,
peso 800. Tamaño 26px con `hitSlop` de 12 para llegar al mínimo táctil de 44.

El oro desaparece del header, que era el origen del problema.

---

## 8 · Notificaciones y estados

### 8.1 · Alertas — verificado en código

`Alertas.tsx` **ya tiene** buzón con descarte de 48h, carencia fitosanitaria
priorizada por seguridad alimentaria, y resumen de 3 + "ver todas".
**Esa lógica no se toca.** Los cambios son sólo de presentación:

1. Sacar los grises de Tailwind. Cuatro apariciones en `AlertasModal`:
   `border-gray-100` → `border-[#e2dbcc]`, `hover:bg-gray-100` → `hover:bg-[#fbfaf6]`.
   Los grises de Tailwind son neutros fríos; la paleta es cálida.
2. El punto de color de 1.5px no dice nada solo. Agregar etiqueta de nivel en
   caps de 10px: `warn` → "URGENTE" en `#a3293a`, `info` → "PENDIENTE" en `#8a6a1f`.
3. Bordes de `#fbfaf6` a `#e2dbcc`.
4. El "+N más — ver todas" pasa a 11px peso 600 en `#7a1f2c`: es la acción de
   la tarjeta, tiene que leerse como acción.

**No agregar navegación por alerta.** Las alertas se derivan en vivo de varios
endpoints y el destino correcto de cada tipo no es obvio. Se decide aparte.

### 8.2 · Badges

| Variante | Cuándo | Anatomía |
|---|---|---|
| `dot` | hay novedad, no importa cuánta | 9px, `#7a1f2c`, anillo de 2px del fondo |
| `count` | conteo, hasta 9 y después "9+" | mín. 17px de alto |
| `label` | estados con nombre | texto corto en caps |

Nunca `label` para conteos.

### 8.3 · Sincronización

Barra de 32px bajo el header, **sólo visible cuando hay algo que decir.**

| Estado | Fondo | Texto | Comportamiento |
|---|---|---|---|
| ok | `#eef2ed` | `#3f5c3a` | se auto-oculta a los 3s |
| offline | `#f7edd8` | `#8a6a1f` | persistente, con conteo en cola |
| syncing | `#eaf0f4` | `#3d6b86` | con barra de avance |
| error | `#fbeced` | `#a3293a` | con acción "Reintentar" |

**En estado normal no se muestra nada.** Un indicador permanente en verde deja de
leerse a los dos días y ocupa altura donde cada píxel cuenta.

---

## 9 · Pulido

### 9.1 · Mapa mobile — observado en captura

Dos leyendas simultáneas con contenido duplicado: el panel "Capas" arriba a la
derecha lista Acequias, Línea eléctrica, Cañerías, Válvulas y Cuadrantes; la
leyenda "TIPO" abajo a la izquierda lista lo mismo otra vez más los tipos de parcela.

Un solo panel con checkbox + muestra de color + etiqueta, en dos secciones:
"Tipos de parcela" (filtro: afecta qué se ve) e "Infraestructura" (capa: afecta
qué se dibuja encima).

Controles agrupados en dos zonas: arriba a la derecha el panel; abajo a la derecha
zoom + / zoom − / refrescar. Hoy el "−" está solo arriba a la izquierda **sin su "+"**.

### 9.2 · Colores fuera de paleta — observado en captura

El pill "REPOSO INVERNAL" usa un lavanda que no corresponde a ningún token.
Mapear los diez estados fenológicos a `fenologiaColors` de `lib/theme.ts`.
Reposo debería usar `ink60` con fondo al 12%.

### 9.3 · Lenguaje

"✦ Estimado automático" → "Estimado según fecha de campaña", sin símbolo,
en `ink60`. El destello se lee como etiqueta de IA; en una herramienta donde el
dato tiene consecuencias económicas conviene un lenguaje más sobrio.

### 9.4 · Estados vacíos

`EmptyState` en las dos plataformas: ícono 24 en `#a09584`, título 15 en `#1f1a17`,
descripción 13 en `#5a544c`, acción opcional. **Sin ilustraciones ni emojis.**

### 9.5 · Gráfico de flujo — observado en captura

Cuatro series donde presupuesto y real se distinguen sólo por el patrón de línea,
y a ese grosor punteado y sólido casi no se diferencian.

Presupuesto pasa a área rellena al 12% de opacidad; real queda como línea sólida
de 2px encima. Egresos en `#9a3140`, ingresos en `#3f5c3a`.

Verificar cómo están declaradas las series: esto salió de la captura, no del archivo.

---

## 10 · Reglas no negociables

- Fondo de app = blanco puro `#ffffff`. La crema `#faf6ec` sólo en tarjetas
  destacadas y modales.
- Botón primario = burdeos `#7a1f2c`.
- Bordes = `#e2dbcc`. Nunca `#fbfaf6`, que es invisible.
- Íconos = Lucide, con el export real verificado.
- El oro `#c89a3a` es acento: si aparece una sola vez en una pantalla, está mal usado.
- Números monetarios y cantidades en JetBrains Mono con `tabular-nums`.
- Tap target mobile ≥ 44px, y ≥ 56px en botones de carga.
- Sin emojis decorativos en UI productiva.
- Sin grises de Tailwind: la paleta es cálida.
- Sin modo oscuro.
