---
fecha: 2026-10-26
tags: [sistema, bitacora, produccion, riego, manto, trazabilidad, fitosanitarios, auditoria]
---

# Bitácora 2026-10-26: riego a manto por superficie

El registro de riego ahora empieza preguntando goteo o manto. El manto se elige por parral o potrero completo y se calcula por superficie. Spec: `docs/superpowers/specs/2026-10-26-riego-manto-design.md`. Rama `feat/riego-manto` (sin push al cierre de esta nota).

## Decisiones

- **Válvulas = `max(1, ceil(round(superficie_ha, 4)))`** (superficie redondeada a 4 decimales, mínimo 1; por ejemplo 0.4 ha → 1 válvula). La parcela se divide en cuadrantes de 1 ha con una válvula cada uno; la fracción cuenta como un cuadrante más.
- **Factor 0.25 por válvula** (`FACTOR_MANTO_SUPERFICIE`): `litros = horas × 16 000 × 0.25 × n_valvulas`; `mm = horas × 1.6 × 0.25` (0.4 mm/h, no depende del tamaño). Ejemplos con 2 h: Parral 2 (3 ha, 3 válvulas) = 24 000 L y 0.8 mm; Potrero 23 (2.3 ha, 3 válvulas) = 24 000 L y 0.8 mm.
- **El histórico no se toca.** El manto viejo (`n_valvulas_manto IS NULL`) conserva factor 0.4 y sus válvulas salen del CSV del campo `valvula`. No se recalcula ningún registro viejo.
- **`n_valvulas_manto` congela el cálculo** del momento: si la superficie cambia después, el historial no se mueve. Solo se llena en manto nuevo.
- **Manto sin cabezal, sin válvulas y sin fertirriego.** `cabezal` y `valvula` pasan a nullable; el schema rechaza fertilizante en manto (422) y exige cabezal/válvula en goteo (422). Si un cliente viejo manda cabezal/válvula en manto, se ignoran.
- **Un solo manto en curso por parcela** (`fin IS NULL`): 409 si ya hay otro, validado en el endpoint.
- **Potrero 23 = 2.3 ha** (estaba en 23 ha en seed y base; único potrero con error, confirmado por Fausto). Se corrige el seed y se agrega script para prod.
- `PUT` revalida con la misma regla; cambiar `tipo` o `parcela_id` recalcula `n_valvulas_manto`. Un histórico editado sin cambiar de tipo conserva su regla vieja. Eficiencia hídrica usa la misma regla que `RegistroRiego.litros_aplicados` (sin duplicarla).

## Archivos tocados por capa

- **Modelo y migración:** `backend/app/models/produccion.py`; migración `b92967a1486b_riego_manto_por_superficie.py` (columna `registros_riego.n_valvulas_manto`, `cabezal` y `valvula` nullable).
- **Backend:** `backend/app/api/produccion.py`, `backend/app/schemas/produccion.py`, `backend/app/core/pdf_carta.py` (carta/PDF muestra manto sin cabezal, "Manto · N válvulas"). Tests: `test_riego_manto.py`, `test_trazabilidad_enlaces.py`.
- **Datos:** `backend/app/api/seed_parcelas.py` y `scripts/corregir_superficie_potrero_23.py` (dry-run por defecto, `--aplicar`, `--db prod`).
- **Web:** `frontend/lib/api/riego.ts`, componentes `produccion/` (`RiegoForm`, `IniciarRiegoForm`, `TipoRiegoSelector`, `RiegoTable`, `RiegosEnCurso`), `Timeline.tsx`, `FincaMap.tsx`, `NotificacionesBell.tsx`, página de riego. El manto histórico solo permite editar horario y responsable.
- **Mobile:** `mobile/app/(tabs)/riego.tsx` (paso 0 goteo/manto), `mapa.tsx`, `lib/api.ts`, `lib/types.ts`. Sin cambios en `app.json`/`eas.json`/`package.json`: el fingerprint no cambia por esto.

## Aparte: pedidos "completadas vuelven a pendientes"

El reporte de órdenes completadas que volvían a pendientes se explicó: los registros fitosanitarios se habían borrado desde "Aplicaciones realizadas" el 2026-10-25 ~12:28 (hora AR), y borrar un registro que vino de una orden baja la parcela y la orden a pendiente por diseño. El commit `6f14493` (misma rama, sesión anterior) agrega un log de auditoría y confirmación escribiendo `ELIMINAR` al borrar ese tipo de registro.

## Pendientes y riesgos antes de desplegar

- **Chequeo previo en prod:** filas de goteo en `registros_riego` con `cabezal=''` o `valvula=''` darían 422 en cualquier `PUT` (goteo exige ambos). Contarlas antes del push.
- **Sin índice único en BD** para "un manto en curso por parcela": queda una ventana de carrera entre dos requests simultáneos.
- **Sin prueba con click real** en web ni en dispositivo. Hay que probar en local (uvicorn + `npm run dev`: goteo, manto retroactivo, "iniciar ahora" y terminar, segundo manto en la misma parcela = 409, editar un riego viejo) y en un teléfono antes de publicar.
- **Mobile "Iniciar ahora" sin cola offline** (preexistente).
- **Historial mobile** ya no muestra cabezal/válvula en los manto históricos.
- El filtro `cabezal` de `GET /riego/` no devuelve los manto nuevos (esperado).

## Orden de despliegue

1. Backup de prod.
2. `scripts/corregir_superficie_potrero_23.py --db prod`: primero dry-run, luego `--aplicar`.
3. Push a `main` (Railway corre la migración `b92967a1486b`).
4. **Regenerar `docs/sistema/Modelo de Datos.md`** (`python scripts/generate_modelo_datos.py`). No se regeneró hoy: el generador lee el esquema de prod y la migración todavía no está aplicada, el doc saldría desactualizado. `PROJECT_MAP.md` sí se regeneró.
5. `vercel --prod`.
6. `fingerprint:compare` y `eas update` para Android e iOS.
