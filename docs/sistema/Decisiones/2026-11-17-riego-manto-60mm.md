---
fecha: 2026-11-17
tags: [sistema, decision, produccion, riego, manto, migracion]
estado: implementada (desplegada 2026-11-17, PR #11, migración c9b5b6bebbfd en producción)
---

# Decisión: riego a manto = 60 mm fijos por riego, congelado por registro

Sesión en [[2026-11-17-paseros-y-manto-60mm]]. Spec: `docs/superpowers/specs/2026-11-17-riego-manto-60mm-design.md`. Plan: `docs/superpowers/plans/2026-11-17-riego-manto-60mm.md`.

## Contexto

El manto se calculaba como `horas × 1,6 mm × 4` por válvula, y `litros = horas × 16.000 × 0,25 × n_válvulas` (ver [[2026-10-26-riego-manto]]). Así el volumen dependía del tiempo que el riego quedaba abierto. Un manto dejado abierto varios días inflaba los números: Parral 8 tenía un riego de 317 h que contaba 60,8 M L.

El ingeniero considera que un riego a manto entrega **60 mm a la parcela completa, sin importar el tiempo**.

## Opciones consideradas

- **Mantener el cálculo por tiempo y solo corregir los datos.** Descartada: el error viene de la regla. Cada riego largo o abierto por error volvería a inflar el número.
- **Calcular en vivo desde superficie y parámetro, sin columna nueva.** Descartada: editar la superficie o los 60 mm reescribiría todo el historial. La vista SQL y `litros_de_registro` necesitarían un JOIN a `parcelas`.
- **Reutilizar `n_valvulas_manto` como «válvulas de 60 mm».** Descartada: no representa fracciones de hectárea (2,3 ha no son 3 válvulas).
- **Elegida: columna `registros_riego.litros_manto` congelada al terminar.** Es el mismo criterio que ya usa `n_valvulas_manto`. Un cambio posterior de superficie o de parámetro no toca el historial.

## Decisión

1. **Regla:** cada riego a manto **terminado** vale `mm_riego_manto` (default 60) mm sobre toda la parcela.
   - `litros_manto = mm × superficie_ha × 10.000`
   - `mm_aplicados = mm`
2. **Congelado:** el valor se fija al terminar el riego (o al crearlo ya terminado). Un manto en curso vale 0.
3. **Parámetro editable** en Documentación → Parámetros (`parametros_produccion`, como `tara_carro`). Cambiar el parámetro no toca los registros viejos.
4. **Cumplimiento:** un manto cuenta 60 / 38,4 = **1,56 riegos**, igual que el goteo se mide en litros reales sobre la parcela.
5. **Histórico recalculado:** los mantos terminados con superficie se recalculan en la migración (backfill). Los que no tengan superficie quedan en 0 litros y se listan antes de migrar.
6. **Compatibilidad:** `n_valvulas_manto` y `FACTOR_MANTO` se conservan en la API. Un cliente viejo que manda `valvula` o factor en un manto nuevo lo ignora.
7. **Edición:** un riego terminado no se puede reabrir (422). El mm del manto no se puede sobrescribir por PUT. Cambiar la parcela de un manto terminado recalcula los litros con la superficie nueva.

## Reglas que quedan superadas

Esta decisión reemplaza estas reglas. Los documentos viejos se dejan como historial, con un aviso de superado donde corresponde.

- **Manto = 4× goteo por tiempo** (`FACTOR_MANTO = 4.0`, `recalcular_manto_x4.py`) de [[2026-11-06-riego-fito-campana]]. Superada por la regla de 60 mm.
- **Manto = 0,25 × válvulas × tiempo** (`FACTOR_MANTO_SUPERFICIE`, `n_valvulas_manto`) de [[2026-10-26-riego-manto]] y de `docs/superpowers/specs/2026-10-26-riego-manto-design.md`. Superada: el manto ya no depende de tiempo ni de válvulas para los litros.
- **Fórmula de aplicado** en `docs/sistema/Arquitectura.md` (sección de cumplimiento): actualizada en esta sesión para el manto.

## Consecuencias

- **Números que cambian:** litros del manto de 170.239.773 L a 14.676.000 L (−91%) en producción. Cumplimiento de riego baja donde había mantos inflados. Los números del manto ×4 (recalculados el 2026-11-05 y 2026-11-06) ya estaban en uso, así que el reporte de solo lectura mostró el antes y el después por parcela antes de migrar.
- **Mantos en curso sin contar:** 4 mantos en curso en producción no suman hasta terminarse. Si son riegos olvidados, cada uno suma 60 mm al cerrarse.
- **Mobile:** muestra 60 mm fijos mientras el OTA no llegue a los binarios viejos. El servidor guarda el valor real del parámetro.
- **Modelo de Datos:** `Modelo de Datos.md` debe regenerarse (columna `litros_manto` y parámetro nuevo). Pendiente de Fausto.
- **Vista KPI:** `vw_kpi_produccion_parcela` cuenta `COALESCE(litros_manto, 0)` para el manto sin filtrar duración. Hay un follow-up abierto para alinearla con los endpoints Python.

## Pendientes

- Revisar los 4 mantos en curso de producción.
- Mobile: leer `mm_riego_manto` del parámetro en lugar de 60 fijos.
- Regenerar `Modelo de Datos.md` después de la migración.
