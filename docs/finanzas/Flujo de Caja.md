---
tags: [finanzas, flujo]
---

# Flujo de Caja

> Seguimiento mensual y anual de ingresos vs. egresos por finca y moneda

---

## Endpoints disponibles

```typescript
getFlujoAnual()   // flujo agregado por año de campaña
getFlujoMensual() // flujo mes a mes dentro del ciclo
```

---

## Dashboard estado actual

| Panel | Estado |
|---|---|
| Egresos | ✅ Funcionando |
| Ingresos | ⚠️ Falta integrar en el dashboard |
| Saldo neto | ⚠️ Pendiente |
| Costo/kg | ⚠️ Pendiente |

Ver [[Dashboards]] para el plan de implementación completo.

---

## Consideraciones

- Los flujos en USD y ARS se reportan **siempre por separado**. Nunca aplicar conversión automática.
- El año de campaña es **Mayo → Abril**, no enero → diciembre. Los filtros deben respetar esto.

---

## Ver también

- [[Presupuesto Anual]]
- [[Dashboards]]
