---
tags: [finanzas, presupuesto]
---

# Presupuesto Anual

> Ciclo: Mayo → Abril (año de campaña)  
> Monedas: ARS y USD — nunca auto-convertir, siempre separar

---

## Estructura de egresos

Los egresos se clasifican por `TipoEgreso` y `ClasificacionEgreso` en el sistema.

### Tipos de egreso principales

- **Mano de obra** — jornales, tareas de campo (se generan automáticamente desde `produccion.py`)
- **Insumos** — fitosanitarios, fertilizantes, materiales
- **Servicios** — contratistas, maquinaria, fletes
- **Administrativos** — oficina, profesionales, impuestos

### Formas de pago

`FormaPago`: efectivo, transferencia, cheque  
`OrigenPago`: finca específica o general

---

## Seguimiento por finca

| Finca | Referencia en sistema |
|---|---|
| Los Mimbres | `los_mimbres` |
| Media Agua | `media_agua` |
| Caucete | `caucete` |

> ⚠️ **Bug activo:** los egresos de mano de obra de Los Mimbres y Caucete se registran incorrectamente bajo Media Agua. Ver [[Bugs Conocidos]].

---

## Ingresos

`ProductoIngreso`: `uva_fresca` · `pasa` · `mosto` · `otro`

---

## API functions disponibles

```typescript
// lib/api/egresos.ts
getEgresos()
getResumenPorTipo()

// lib/api/ingresos.ts
getIngresos()

// lib/api/flujo.ts
getFlujoAnual()
getFlujoMensual()
```

---

## Ver también

- [[Cuentas por Pagar]]
- [[Flujo de Caja]]
- [[Dashboards]]
