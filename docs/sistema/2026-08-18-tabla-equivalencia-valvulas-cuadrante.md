---
tags: [sistema, sesion]
---

# 2026-08-18 — Tabla de equivalencia de válvulas reales (GeoJSON) + resaltado por cuadrante

Cierra el pendiente identificado el 2026-08-13: el resaltado de riego en curso del mapa solo pintaba a nivel parral porque `RegistroRiego.valvula` era un índice posicional arbitrario ("1","2"), sin relación con el nombre físico real de las válvulas del GeoJSON. Fausto, probando la app en mobile, encontró que el **Parral 2** tiene una válvula real ("21") alimentada por el **Cabezal 2** mientras el resto ("22","23") las alimenta el **Cabezal 1** — combinación que no era seleccionable porque el flujo asumía un único cabezal por parcela.

## Auditoría (antes de tocar código de producción)

`scripts/auditoria_valvulas_geojson.py` (nuevo, reutilizable) cruzó 4 fuentes: `Los Lirios 2026.kml` (polígonos reales de Parral, point-in-polygon), `frontend/public/layers/Valvulas.geojson` y `Cuadrantes de Riego.geojson` (57 válvulas/57 cuadrantes cada uno, ya traían `"Nombre de Valvula"`, `Cabezal` y `"Valvula Correspondiente"` — tomados como fuente de verdad), las 3 tablas hardcodeadas vigentes (`frontend/lib/api/riego.ts`, `mobile/lib/types.ts`) y `Parcela.cabezal_riego` en la DB de producción.

Encontró, además del caso de Fausto:
- **Parral 4 no tenía ninguna válvula dentro de su polígono real** — las 4 válvulas con prefijo "4" (41-44) caían geométricamente en el polígono de **Parral 5**, pegadas al límite compartido entre ambos (error de digitalización en QGIS, no de nomenclatura). Confirmado con Fausto: "41","42" son de Parral 4; "43","44" de Parral 5.
- **"31","32"** no caían dentro de ningún polígono de parral. Confirmado con Fausto: riegan el **Potrero 3** (sin parral/cuadrante asociado — "en stand by" hasta que se les dé cuadrante propio).
- **`"SU3"` duplicado** en `Valvulas.geojson` (fid 3 y 4) — confirmado que fid 4 debía ser `"SU4"` (el Parral Sult. tiene 4 válvulas reales).
- Dos pares de cuadrantes apuntando a la misma válvula (`C163`/`C131` → "131"; `C153`/`C141` → "141") — **no era un bug**: Fausto explicó que son 4 cuadrantes de 0,5 ha que en pares suman 1 ha regada por una sola válvula física. Relación real muchos-a-uno cuadrante↔válvula, no un error de datos. No se tocó nada ahí.

## Decisiones tomadas con Fausto

- La tabla de equivalencia se persiste en el **backend** (nueva fuente de verdad única, reemplaza las 3 listas hardcodeadas y duplicadas de frontend/mobile).
- Los registros de riego **nuevos** guardan el nombre real de válvula del GeoJSON (ej. `"21"`, `"SU4"`) en vez del índice posicional — sin migración retroactiva de los históricos.
- Casos ambiguos resueltos con cruce espacial automático + confirmación explícita de Fausto antes de persistir nada (no se adivinó ninguno).

## Implementación

**Backend:** modelo nuevo `Valvula` (`backend/app/models/valvula.py`, tabla `valvulas`) — `nombre`, `parcela_id` (FK), **`cabezal` como atributo de la válvula, no de la parcela** (cierra el gap real del Parral 2: antes solo existía `Parcela.cabezal_riego`, un único valor por parcela). Migración aditiva `1b05e61f9a8c`. `scripts/seed_valvulas.py` (mismo patrón backup+dry-run+`--commit` del resto del repo) puebla las 57 filas desde el GeoJSON corregido, con las 3 excepciones manuales confirmadas como overrides explícitos en el código (no reglas automáticas). Endpoint nuevo `GET /produccion/valvulas` (filtros `parcela_id`, `cabezal`). 4 tests nuevos, 51/51 pasando.

**Web/mobile — flujo de carga de riego:** `IniciarRiegoForm.tsx`, `RiegoForm.tsx` (web) y el wizard de `riego.tsx` (mobile) ahora traen las válvulas reales del backend por parcela (ya no de `VALVULAS_POR_PARCELA`/`CABEZAL_VALVULAS`, eliminadas). Si el usuario elige válvulas de cabezales distintos dentro de la misma carga, el formulario **bloquea el envío** con un aviso explícito ("cargalas en riegos separados") en vez de guardar un dato ambiguo o silenciosamente incorrecto. Mobile mantiene el flujo cabezal→parral→válvulas (navegación física, útil en el campo) pero ahora filtra válvulas reales por cabezal en vez de listas fijas.

**Mapa — resaltado por cuadrante:** extiende el mecanismo del 08-13 (a nivel parral) a nivel de cuadrante individual, sin reemplazarlo — se componen los dos. Web: nuevo `useEffect` que restylea la capa de cuadrantes ya cargada (`cuadrantesRiegoLayerRef`) matcheando `"Valvula Correspondiente"` contra los nombres de válvula de los riegos activos. Mobile: mismo patrón `injectJavaScript`/`window.setParcelasEnRiego` del 08-13, extendido con `window.setValvulasEnRiego(nombres)` análogo — actualiza un segundo `Set` (`VALVULAS_EN_RIEGO`) y restylea el layer de cuadrantes sin recargar el WebView. Los riegos viejos (formato posicional) no matchean ningún cuadrante — sin efecto, siguen viéndose resaltados a nivel parral igual que antes.

## Verificación

51/51 tests backend, `tsc --noEmit` limpio en frontend y mobile. Seed corrido contra producción con backup previo (`pg_backups/los_lirios_prod_20260818_193329_pre_seed_valvulas.dump`) y verificado por lectura directa (57 filas, casos clave —"21"→cabezal 2, "22"/"23"→cabezal 1, "41"→cabezal 1, "SU4"→cabezal 1— confirmados en la DB real). Fausto probó el flujo completo en el celular en producción y confirmó que funciona bien.

## Deploy

Commit `93c4fcb`, pusheado a `main`. Railway corrió la migración sola (confirmado en logs). `vercel --prod` corrido. `eas update --branch production --environment production` (100% JS, sin build nuevo) — bundle verificado (URL de Railway presente, sin IP LAN).

## Ver también

- [[Sistema de Gestión Agrícola]]
- [[2026-08-13-mejoras-mapa]]
