---
tags: [sistema, bugs]
---

# Bugs Conocidos

> Última revisión: 2026-06-01

---

## 🔴 CRÍTICO — Finca hardcodeada en `_build_egreso_for_trabajo`

**Archivo:** `backend/app/api/produccion.py`  
**Impacto:** Todos los egresos de mano de obra de Los Mimbres y Caucete quedan registrados bajo Media Agua. Los reportes de costos por finca están contaminados.

**Causa:**
```python
# produccion.py — BUG
return Egreso(
    finca=Finca.media_agua,  # hardcodeado, debería derivarse de parcela.finca
    ...
)
```

**Fix:** Derivar `finca` desde `parcela.finca` del `RegistroTrabajo` asociado.

---

## 🔴 CRÍTICO — `await db.commit()` en `notificaciones.py`

**Archivo:** `backend/app/api/notificaciones.py`  
**Impacto:** Inconsistente con la convención del proyecto (commit solo en el context manager de `get_db`). Puede generar transacciones parciales si hay error posterior en el mismo request.

**Fix:** Eliminar el `await db.commit()` directo. El session manager lo maneja.

---

## 🔴 CRÍTICO — Widget de clima con datos hardcodeados en frontend

**Archivo:** `frontend/app/dashboard/page.tsx`  
**Impacto:** El `ClimateCard` muestra datos estáticos, no datos reales. Engañoso para el usuario.

**Fix:** Conectar a una API de clima (ej. Open-Meteo, gratuita para uso agro) o remover el widget si no hay integración planificada.

---

## 🟡 Dashboard Producción duplica datos de jornales

**Ruta:** `/produccion/dashboard`  
**Impacto:** El dashboard de producción actualmente muestra datos de jornales en lugar de métricas de producción (fenología, rendimiento, riego). Rebuild completo requerido.

**Estado:** Planificado en [[Dashboards]]

---

## Ver también

- [[Arquitectura]]
- [[Dashboards]]
