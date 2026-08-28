# Los Lirios — paquete de mejoras estéticas

Mejoras visuales para la app web y mobile. **Ningún cambio de lógica de negocio.**

Generado a partir de la auditoría estética: 22 hallazgos sobre el estado actual
de `main`, cada uno con la causa técnica y el archivo donde vive.

---

## Cómo empezar

1. `git checkout -b feature/estetica-v1`
2. Copiá los archivos a su lugar (tabla de abajo).
3. Abrí Claude CLI en la raíz del repo.
4. Pegá el **prompt 0** de `PROMPTS.md`. Después el 1, el 2, y así.
5. Al terminar cada fase, revisá el diff antes de aprobar.

---

## Mapeo de archivos

| De este paquete | Al repo |
|---|---|
| `ESTETICA.md` | `docs/ESTETICA.md` |
| `assets/*.svg` | `estetica/assets/` (los usa el script; los tres logos terminan en `frontend/public/`) |
| `frontend/lib/icons.ts` | `frontend/lib/icons.ts` |
| `mobile/lib/icons.ts` | `mobile/lib/icons.ts` |
| `scripts/gen_assets.py` | `estetica/scripts/gen_assets.py` |
| `frontend/app/globals.css.patch` | instrucciones, no se copia |
| `mobile/app.json.patch` | instrucciones, no se copia |

---

## Decisiones ya tomadas

| Tema | Decisión |
|---|---|
| Colores del logo | Oro `#c89a3a` + uva `#5a1320` (antes `#b08d3f` y `#4a2145`, fuera de paleta) |
| Escalado de la marca | Tres niveles: completa ≥64px, reducida 24–64px, glifo ≤24px |
| Familia de íconos | Lucide en las dos plataformas (mobile deja Ionicons) |
| Ícono de la app | Monograma **M4**: racimo en triángulo invertido al 28% + LL en Fraunces + "LOS LIRIOS" |
| Header mobile | **Blanco** con borde inferior, sin título duplicado |
| Avatar | **Contorno**: círculo transparente con borde `#ddd6ca` |
| Modo oscuro | No |

---

## Las 7 fases

| # | Fase | Riesgo |
|---|---|---|
| 1 | Assets de marca | nulo |
| 2 | Íconos unificados | bajo |
| 3 | Formularios y tokens | bajo |
| 4 | Login web y mobile | bajo |
| 5 | Shell web | medio |
| 6 | Notificaciones y estados | bajo |
| 7 | Mapa mobile y pulido | medio |

---

## Los tres hallazgos críticos

1. **El ícono de Android se lava.** `backgroundColor: "#faf8f5"` es casi blanco
   y encima va una marca en dorado claro. Android la recorta en círculo, la achica
   al 66% y la muestra a 48px: deja de existir.
2. **No hay ícono de notificación declarado.** Sin `icon` en el plugin, Android
   aplana el ícono de la app a un cuadrado blanco en la barra de estado.
3. **El clima del topbar está escrito a mano.** En `dashboard/layout.tsx` es
   literalmente `<span aria-label="Clima">☀ 22°</span>`. Veintidós grados fijos,
   en cualquier finca y cualquier estación. Por eso contradice a la tarjeta del
   cuerpo, que sí consulta el endpoint.

---

## Sobre la procedencia de cada hallazgo

Cada uno está marcado como **verificado en código** (leí el archivo en `main`,
los valores son exactos) u **observado en captura** (el síntoma es visible pero
no confirmé el mecanismo).

En los segundos, el prompt le pide a Claude CLI leer el archivo y confirmar antes
de editar. Con permiso de escritura, un número inventado es un edit equivocado.

**Sin leer todavía**, y necesarios antes de las fases 5 y 7:
`frontend/app/dashboard/page.tsx`, `mobile/app/(tabs)/index.tsx`,
`mobile/app/(tabs)/mapa.tsx`.
