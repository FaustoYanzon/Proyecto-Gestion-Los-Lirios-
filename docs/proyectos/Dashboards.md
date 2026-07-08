---
tags: [proyecto, dashboards, frontend]
---

# Dashboards — Plan de Implementación

> Basado en análisis del repo (2026-06-01)

---

## Estado por dashboard

| Dashboard | Ruta | Estado | Qué falta |
|---|---|---|---|
| Finanzas | `/finanzas/dashboard` | Parcial — solo egresos | Ingresos, saldo neto, costo/kg, charts mejorados |
| Producción | `/produccion/dashboard` | Roto — muestra jornales | Rebuild completo: fenología, rendimiento, riego, carencias |
| Mano de Obra | `/produccion/mano-de-obra` | Base sólida | Fix chart semana, stacked area, top trabajadores |

---

## API functions ya disponibles

```typescript
// egresos
getEgresos(), getResumenPorTipo()

// producción
getTrabajos(), getParcelas(), getEstadoActual()
getCiclosCampana(), getResumenPorTrabajador(), getResumenPorTarea()

// flujo
getFlujoAnual(), getFlujoMensual()

// ingresos
getIngresos()

// riego y fito
getRiegos(), getFitosanitarios()
```

---

## Patrones del codebase a respetar

- Componentes locales dentro del mismo `page.tsx` (no archivos separados salvo API functions)
- `useQuery` de TanStack Query para todos los fetches
- Filtros: estado pendiente → botón "Aplicar" → estado `applied` que dispara queries
- `ResponsiveContainer` de Recharts, height fija en px
- Formatters `fmtARS`, `fmtM` como funciones locales
- `'use client'` al inicio de toda page

---

## Prioridad de implementación

1. **Fix dashboard producción** — rebuild completo (alta prioridad, el actual es incorrecto)
2. **Completar dashboard finanzas** — agregar ingresos, saldo, costo/kg
3. **Mejoras mano de obra** — chart semana, stacked area, ranking trabajadores

---

## Ver también

- [[Sistema de Gestión Agrícola]]
- [[Bugs Conocidos]]
- [[Stack Técnico]]
