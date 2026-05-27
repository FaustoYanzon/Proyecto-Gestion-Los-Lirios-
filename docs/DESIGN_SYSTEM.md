# Los Lirios — Design System

> Especificación maestra del rediseño. Esta es la fuente de verdad. Cuando dudes entre lo que diga acá y lo que diga el código existente, gana este documento.

---

## 0 · Filosofía

**Tres principios, en orden de prioridad:**

1. **Calma y seriedad antes que ruido.** El usuario es un gerente (web) o un trabajador del campo (mobile). Los dos quieren la información rápido, sin glitter, sin emojis decorativos.
2. **El campo manda.** Si una decisión hace la vida más fácil al obrero/regador en su teléfono bajo el sol con guantes, gana, aunque sea menos elegante.
3. **Consistencia obsesiva.** El mismo botón se ve igual en login, en una tabla y en un modal. Los formularios siempre tienen 3 pasos. La crema no se mezcla con el blanco.

---

## 1 · Marca

### Logo
- Se usa el logo **actual** (lirio dorado + Andes + racimo + wordmark serif).
- Vectorizar el PNG en `frontend/public/logo.svg` y guardar también una variante `logo-mark.svg` que sea **sólo el racimo** (para favicon, sidebar slim y notificaciones push).
- Para mobile Expo: `mobile/assets/icon.png` (1024×1024 con padding) + `mobile/assets/splash.png` (logo centrado sobre fondo crema).

### Aplicaciones (cuándo cuál)
| Superficie | Variante | Tamaño |
|---|---|---|
| Web · login | lockup completo | ~140px alto |
| Web · sidebar slim | sólo mark | 22×22 |
| Web · topbar | lockup horizontal | 32px alto |
| Web · favicon | sólo mark | 16/32/64 |
| Web · reporte PDF | lockup completo | header del documento |
| Mobile · splash | lockup completo | centrado |
| Mobile · header | wordmark mini | 14px alto |
| Mobile · push notification | sólo mark | 34×34 |

**Nunca** girar, distorsionar, recolorear o poner el logo sobre fondos burdeos puros.

---

## 2 · Color

Sistema vino. Fondo **blanco puro**, burdeos lleva la marca, oro como acento ocasional.

### Tokens primarios

| Token | Hex | Uso |
|---|---|---|
| `--color-burdeos-700` | `#5a1320` | Acciones primarias hover, marcas |
| `--color-burdeos-600` | `#7a1f2c` | **Primary** — botones, links, headings de marca |
| `--color-burdeos-500` | `#9a3140` | Hover de elementos burdeos, charts |
| `--color-burdeos-200` | `#e6c8cd` | Soft fills, badges en estado activo |

### Tokens neutros

| Token | Hex | Uso |
|---|---|---|
| `--color-ink` | `#1f1a17` | Texto principal (body) |
| `--color-ink-60` | `#5a544c` | Texto secundario |
| `--color-niebla` | `#a09584` | Hints, dividers, labels |
| `--color-blanco` | `#ffffff` | **★ Fondo principal de la app** |
| `--color-hueso` | `#fbfaf6` | Fondo alterno (zebra, hovers sutiles) |
| `--color-crema` | `#faf6ec` | Tarjetas destacadas, modales |

### Tokens dominio

| Token | Hex | Uso |
|---|---|---|
| `--color-oro` | `#c89a3a` | Accent, dorado del logo. Usar **mínimamente** |
| `--color-verde-campo` | `#3f5c3a` | Estado parrales · OK · positivo |
| `--color-tierra` | `#8a5a2b` | Estado paseros |
| `--color-cielo` | `#3d6b86` | Riego, clima, frío |
| `--color-sangre` | `#a3293a` | Danger, alertas críticas |

### Tipos de parcela (mapa + filtros)

| Tipo | Color |
|---|---|
| `parral` | `--color-burdeos-600` |
| `potrero` | `--color-verde-campo` |
| `pasero` | `--color-tierra` |
| `cabezal` | `--color-cielo` |

> El sistema **actual** usa azul/verde/naranja/cyan; vamos a reemplazarlo por estos tokens. Buscar `TIPO_COLORS` en `mobile/app/(tabs)/index.tsx` y `mobile/app/(tabs)/mapa.tsx` + equivalentes web.

---

## 3 · Tipografía

### Familias

| Familia | Cuándo | Origen |
|---|---|---|
| **Public Sans** | Workhorse — UI completa, body, tablas | Google Fonts |
| **Fraunces** | Display — login hero, page titles selectos | Google Fonts |
| **JetBrains Mono** | Números, montos, código, IDs | Google Fonts |

**Reemplaza a:** Arial / Helvetica / system-ui actuales.

### Escala

| Nivel | Tamaño / Line | Weight | Uso |
|---|---|---|---|
| Display | 48 / 52 | 600 | Login hero, marketing |
| H1 | 32 / 36 | 700 | Page titles de dashboard |
| H2 | 22 / 28 | 700 | Section headings |
| H3 | 16 / 22 | 600 | Card titles |
| Body | 14 / 20 | 400 | Cuerpo, tablas |
| Small | 13 / 18 | 500 | Labels, captions |
| Micro | 11 / 14 | 700 | Pills, uppercase tags |

### Reglas

- **Números monetarios + cantidades + IDs siempre en JetBrains Mono** con `font-variant-numeric: tabular-nums`. No bailan al actualizar.
- **Mobile** sube cuerpo a **15 / 22** (cuerpo) y mantiene 18+ para inputs de carga (regla de tap target visible).
- Permitir `text-wrap: pretty` en titulares.

---

## 4 · Espaciado

Escala de 4px. Tokens nombrados:

```css
--space-0: 0;
--space-1: 4px;     /* xs - icon gap */
--space-2: 8px;     /* sm - dense rows */
--space-3: 12px;    /* base inline gap */
--space-4: 16px;    /* card padding sm */
--space-5: 20px;    /* card padding md */
--space-6: 24px;    /* section gap */
--space-8: 32px;    /* page padding */
--space-12: 48px;   /* section to section */
--space-16: 64px;
```

---

## 5 · Border radius

```css
--radius-sm: 6px;    /* pills, small inputs */
--radius-md: 10px;   /* cards, inputs */
--radius-lg: 14px;   /* modals, sheets, top of bottom-sheet */
--radius-pill: 999px;
```

Botones: `--radius-md`. Inputs: `--radius-md`. Cards: `--radius-md`. Modales: `--radius-lg`.

---

## 6 · Sombras

```css
--shadow-sm: 0 1px 2px rgba(31,26,23,0.06);
--shadow-md: 0 4px 12px rgba(31,26,23,0.08);
--shadow-lg: 0 12px 32px rgba(31,26,23,0.12);
```

Tarjetas en reposo: `--shadow-sm`. Modales / floating panels: `--shadow-md`. Bottom-sheet móvil: `--shadow-lg` arriba.

---

## 7 · Componentes base

### Buttons

| Variante | Cuándo | Tokens |
|---|---|---|
| **Primary** | Acción principal | bg `--color-burdeos-600` · text `--color-blanco` · hover `--color-burdeos-700` |
| **Secondary** | Acción secundaria | bg `--color-blanco` · border `--color-ink` · text `--color-ink` · hover bg `--color-hueso` |
| **Ghost** | Acción terciaria, inline | text `--color-ink-60` · hover bg `--color-hueso` |
| **Danger** | Eliminar, cancelar destructivo | bg `--color-sangre` · text `--color-blanco` |
| **Link** | Inline link en texto | text `--color-burdeos-600` · underline en hover |

**Sizes:** sm (32px alto, 12px text), md (40px, 14px), lg (48px, 14px). **Mobile lg = 56px (regla campo).**

### Inputs

- 40px alto (web) / 48px (mobile).
- Border `--color-hueso` 1.2px, hover `--color-niebla`, focus `--color-burdeos-600` (2px) + offset 2px.
- Padding `12px 14px`. Text 14px.
- Placeholder en `--color-niebla`.
- Label arriba, 11px uppercase, weight 600, color `--color-ink-60`.
- Error: border `--color-sangre`, mensaje abajo en 12px.

### Cards

- Padding 20px (web), 16px (mobile).
- bg `--color-blanco`, border `1px solid --color-hueso`, `--radius-md`, `--shadow-sm`.
- Tarjetas destacadas: bg `--color-crema`.

### Pills / badges

- Padding `2px 10px`, font 11px, weight 700, uppercase, letter-spacing 0.4px.
- Default: bg `--color-hueso` / text `--color-ink-60`.
- Accent: bg `--color-burdeos-200` / text `--color-burdeos-700`.
- Estados domain: usar verde/tierra/cielo/sangre con tinte al 12% bg + color full text.

### Tables

- Header: 11px uppercase, weight 700, color `--color-ink-60`, border-bottom 1.5px solid `--color-ink`.
- Row: 13px, hover bg `--color-hueso`.
- Zebra opcional con `--color-hueso` alternado.
- Acciones a la derecha (ghost icon buttons).
- Empty state: ilustración placeholder + frase corta + CTA primario.

### Modals / Sheets

- Web modal: max 560px ancho, centrado, padding 24px, `--radius-lg`, `--shadow-lg`. Overlay `rgba(31,26,23,0.4)`.
- Mobile bottom-sheet: 100% ancho, `--radius-lg` superior solamente, max 80vh, handle gris arriba de 4×40px.

---

## 8 · Wizard 3 pasos (formularios)

**Patrón único para todos los formularios de carga.** Aplica a tarea, riego, fito, estado de campaña, y a cualquier formulario futuro (cosecha, finanzas, etc).

### Reglas

1. **3 pasos siempre.** Paso 1: *qué*. Paso 2: *dónde / cuánto*. Paso 3: *confirmar*. Si no entra en 3, se divide en dos formularios.
2. **Una pregunta por pantalla.** Un solo título grande arriba, un solo grupo de inputs abajo.
3. **Selección antes que tipeo.** Chips, tarjetas grandes (mín 56px alto), stepper +/− para números. Tipear sólo en observaciones libres.
4. **Defaults inteligentes.** Fecha = hoy, finca = activa, encargado = user logueado, top 5 opciones más usadas arriba.
5. **Validación dura.** Botón "Siguiente / Confirmar" deshabilitado si falta algo. Errores abajo del campo, en rojo, con la solución.
6. **Offline transparente.** Sin señal → guarda local, muestra "1 registro en cola", nunca bloquea.

### Componente

```tsx
// mobile/components/Wizard.tsx
type Step = {
  title: string;
  // Cada paso es un componente que renderiza inputs y reporta su estado
  Component: React.ComponentType<{ value: any; onChange: (v: any) => void }>;
  // Predicate: ¿puede avanzar?
  canAdvance: (value: any) => boolean;
};

interface WizardProps {
  steps: Step[];
  initialValue?: any;
  onConfirm: (value: any) => Promise<void>;
  onCancel?: () => void;
  title: string;  // mostrado en header
}
```

El Wizard renderiza el header `1/3`, el stepper visual arriba, y los botones "← Atrás · Siguiente →" / "✓ Confirmar" abajo. Los componentes de cada paso son tontos: reciben valor + onChange.

### Mapeo de los 4 formularios actuales

| Form | Paso 1 (qué) | Paso 2 (dónde/cuánto) | Paso 3 (confirmar) |
|---|---|---|---|
| **Tarea (jornal)** | Chip tipo de tarea | Parcela + nº jornales | Resumen + ✓ |
| **Riego** | Cabezal (1·2·3·4 / manto) | Cronómetro + parcelas regadas | Resumen + ✓ |
| **Fitosanitario** | Producto + parcela | Dosis + caldo (auto-calculado) | Condiciones de aplicación + ✓ |
| **Estado de campaña** | Parral | Fase fenológica + foto opcional | Resumen + ✓ |

---

## 9 · Patrones específicos

### 9.1 · Switcher de finca + campaña (topbar web + drawer mobile)

Globales. Cambiar dispara refetch de queries de TanStack, no recarga la app. Persistencia en Zustand + localStorage (web) / AsyncStorage (mobile).

Estados:
- Pill con 📍 + nombre finca, borde 1.5px burdeos, bg crema.
- Click abre dropdown con: 3 fincas, contador (parcelas · jornales) en cada una, y al pie "Comparar las 3".

### 9.2 · Avatar de usuario + drawer

En el extremo **derecho** de:
- Topbar (web)
- Header de cada pantalla (mobile)

Círculo 24×24 (mobile) / 32×32 (web), bg `--color-oro`, texto `--color-burdeos-600`, weight 800. Iniciales del `full_name`.

Al tocar → drawer lateral derecho con:
- Card usuario (avatar grande + nombre + rol)
- Finca activa (con switcher inline)
- Campaña activa
- Items: Mi perfil · Notificaciones (badge) · Preferencias · Modo offline · Cerrar sesión

Implementación: `mobile/components/UserBadge.tsx`, inyectado via `options.headerRight` en `(tabs)/_layout.tsx`. En web: componente fijo en topbar.

### 9.3 · Widget de clima

3 tamaños — todos consumen el mismo endpoint `/clima/actual` y `/clima/pronostico`.

| Tamaño | Dónde | Contenido |
|---|---|---|
| **Mini** | Topbar web · header móvil | ☀ 24° + finca |
| **Card** | Inicio web · 2da fila mobile | Temp grande + min/max + 4 metrics (HR, viento, lluvia, ET₀) + forecast 7d |
| **Full** | Ruta /clima dedicada | Gráfico + recomendaciones agro contextuales |

Fuente: **open-meteo.com** (gratis, sin API key). Cache server-side 30min.

### 9.4 · Mapa con acciones rápidas (web + mobile)

Leaflet motor.

- Web: panel lateral derecho, colapsable. Al seleccionar polígono → muestra detalle parcela + 3 botones (+ riego · + tarea · + fito). Capas toggleables (días desde riego, fenología, jornales 7d).
- Mobile: pantalla completa, sin panel. Al tocar polígono → bottom-sheet sube con datos + 3 acciones rápidas. Filtros como chips arriba.

### 9.5 · Comunicación de moneda

- **ARS y USD nunca se suman.** Regla del backend, replicada en UI.
- En Finanzas el tab activo (ARS / USD) cambia toda la pantalla.
- Mostrar cotización informativa como subtítulo, **nunca** guardada en BD.
- Números: JetBrains Mono, separadores AR (`$ 18.420.000,00`).

### 9.6 · Estados offline / sync

Banner persistente en mobile (top de cada pantalla, debajo del header) con 4 estados:

| Estado | bg | Texto |
|---|---|---|
| ok | `--color-verde-campo` | "✓ Sincronizado · hace Nm" |
| offline | `--color-oro` | "⚡ Sin conexión · N registros en cola" |
| syncing | `--color-cielo` | "↻ Sincronizando N registros…" |
| error | `--color-sangre` | "! Falló sync · N registros · reintentar" |

Default oculto en `ok` (sólo aparece si hay novedad reciente).

---

## 10 · Shell web (layout principal)

```
┌─────┬─────────────────────────────────────────────┐
│     │ TOPBAR · finca ▾  campaña ▾  ⌘K  ☀ 24°  ●FY │
│ SIDE├─────────────────────────────────────────────┤
│ BAR │                                              │
│ 44px│           CANVAS (white)                     │
│     │                                              │
│  ●  │                                              │
│  ●  │                                              │
│  ●  │                                              │
└─────┴─────────────────────────────────────────────┘
```

### Sidebar slim (44px)

- bg `--color-burdeos-600`, text `--color-blanco`.
- 6 items, iconos 20×20, label sólo en hover (tooltip a la derecha).
- Items: Inicio · Mapa · Producción · Finanzas · Registros · Admin.
- Logo mark arriba (32px), avatar usuario abajo (en este modo el avatar duplica del topbar — opcional).

### Topbar (56px alto)

- bg `--color-blanco`, border-bottom 1px `--color-hueso`.
- Izquierda: finca switcher + campaña switcher.
- Centro: Cmd+K search (atajo visible).
- Derecha: widget clima mini · notificaciones · avatar usuario.

### Sin sub-menús desplegables.

Cada item del sidebar es un módulo. Submódulos (egresos / ingresos / flujo) viven como **tabs dentro de la página** del módulo, no en el sidebar.

---

## 11 · Shell mobile

```
┌─────────────────────────┐
│ STATUS BAR              │
├─────────────────────────┤
│ HEADER (burdeos)        │
│ Nombre pantalla   ●FY   │
├─────────────────────────┤
│                         │
│   CONTENT (white)       │
│                         │
├─────────────────────────┤
│ TABBAR (white)          │
│  ⌂ ⊟ ⛆ ◴ ☘                │
└─────────────────────────┘
```

### Tabbar inferior

5 tabs: Inicio · Tareas · Riego · Mapa · Campaña. (Perfil se accede via avatar; está hoy en tabbar y debe salir.)

### Header

bg `--color-burdeos-600`, text `--color-blanco`. Altura 48px.
- Izquierda: título pantalla (16px, weight 700)
- Derecha: avatar usuario (24×24)

### Tap targets

Mínimo 56px de alto en cualquier botón / chip / lista interactiva. Mínimo 44×44 en íconos pequeños.

---

## 12 · Adaptación por rol

| Rol | Shell | Acceso | Default home |
|---|---|---|---|
| `super_admin` / `gerencial` | Web completo + Mobile | Todo | Dashboard mapa-first |
| `encargado` | Web (4 items: sin Admin, sin Finanzas) + Mobile completo | Producción · Mapa · Registros · Estado campaña | Dashboard producción |
| `regador` / `obrero` | **Sólo mobile** | Inicio (task-first) + sus formularios + mapa | "Mi día" |

Implementación: filtrar `navItems` en `dashboard/layout.tsx` por `user.role`. Routes protegidas con guard server-side también (no sólo UI).

---

## 13 · Iconografía

Usar **lucide-react** (ya está). Reglas:
- Tamaño 16px en líneas de texto, 18px en botones, 22px en sidebar, 24px en headers.
- Stroke 1.5–1.75.
- Color: heredado del texto. Nunca colores semánticos hardcoded; usar tokens.

Emojis: **no** en la UI productiva. Sí permitidos en mensajes del banner offline (☀ ⚡ ↻) y en placeholders de demos.

---

## 14 · Movimiento

- Hover/transition: 150ms ease-out.
- Modal/sheet entry: 200ms ease-out, fade + slide 8px.
- Page transitions: ninguna (navegación instantánea es preferible a animación).
- Drawer mobile: 240ms ease-out desde la derecha.

---

## 15 · Reglas no negociables

- ✅ Fondo de app = **blanco puro** `#ffffff`. Crema sólo en tarjetas destacadas y modales.
- ✅ Botón primario = burdeos `#7a1f2c`. No verdes, no azules.
- ✅ ARS y USD nunca se suman. Tab arriba en finanzas.
- ✅ Formularios = wizard 3 pasos.
- ✅ Logo: no rotar, no recolorear, no distorsionar.
- ✅ Tap target mobile ≥ 56px en botones de carga.
- ✅ Numeros monetarios + cantidades en JetBrains Mono `tabular-nums`.
- ❌ Sin emojis decorativos en UI productiva.
- ❌ Sin gradientes saturados (sólo el sutil de la tarjeta de marca).
- ❌ Sin sub-menús desplegables en el sidebar.

---

## 16 · Archivos a tocar

| Archivo | Cambio |
|---|---|
| `frontend/app/globals.css` | Reescribir con @theme tokens |
| `frontend/lib/theme.ts` | NUEVO — exportar tokens y helpers |
| `frontend/public/logo.svg` | NUEVO — vectorizar PNG actual |
| `frontend/public/logo-mark.svg` | NUEVO — sólo racimo |
| `frontend/app/layout.tsx` | Cargar fonts (Public Sans, Fraunces, JetBrains Mono) |
| `frontend/app/login/page.tsx` | Reescribir con layout split |
| `frontend/app/dashboard/layout.tsx` | Reescribir: sidebar slim + topbar |
| `frontend/app/dashboard/page.tsx` | Reescribir: mapa-first |
| `frontend/components/FincaSwitcher.tsx` | NUEVO |
| `frontend/components/CampanaSwitcher.tsx` | NUEVO |
| `frontend/components/ClimateWidget.tsx` | NUEVO |
| `frontend/components/UserBadge.tsx` | NUEVO |
| `frontend/components/CommandPalette.tsx` | NUEVO (cmdk) |
| `mobile/lib/theme.ts` | NUEVO — espejo del web |
| `mobile/assets/icon.png` | Reemplazar con logo nuevo |
| `mobile/assets/splash.png` | Reemplazar |
| `mobile/app/(auth)/login.tsx` | Reescribir |
| `mobile/app/(tabs)/_layout.tsx` | Header burdeos + UserBadge |
| `mobile/app/(tabs)/index.tsx` | Task-first |
| `mobile/components/Wizard.tsx` | NUEVO — wizard único |
| `mobile/components/UserBadge.tsx` | NUEVO |
| `mobile/components/ClimateCard.tsx` | NUEVO |
| `mobile/app/(tabs)/tareas.tsx` | Refactor a Wizard |
| `mobile/app/(tabs)/riego.tsx` | Refactor a Wizard |
| `mobile/app/(tabs)/campana.tsx` | Implementar con Wizard |
| `backend/app/api/clima.py` | NUEVO |
| `backend/app/services/clima.py` | NUEVO |
| `backend/app/models/clima_cache.py` | NUEVO |
| `backend/app/main.py` | Registrar router de clima |

**Sin** cambios en BD existente. **Sin** alembic migrations sobre lo que ya hay. Sólo se agrega `clima_cache` (no es crítico, puede ser hasta una tabla in-memory simple si querés evitar migration).

---

## 17 · Implementación por fases

| Fase | Tiempo estimado | Qué entrega |
|---|---|---|
| **1 · Tokens + fonts** | 1 sesión | App con los nuevos colores y tipos cargados |
| **2 · Shell + nav** | 2–3 sesiones | Sidebar + topbar + switchers + Cmd+K |
| **3 · Login + Inicio + Mapa (web)** | 2 sesiones | Pantallas principales rediseñadas |
| **4 · Mobile flows** | 3 sesiones | Wizard único + 4 formularios refactorizados |
| **5 · Backend clima** | 1 sesión | Endpoint + cache + integración en frontend/mobile |

Total: **9–10 sesiones de Claude Code**, sin tocar BD existente.

---

> **Próximo paso:** abrir VS Code, ejecutar Claude Code y seguir los prompts en `CLAUDE_CODE_PROMPTS.md`.
