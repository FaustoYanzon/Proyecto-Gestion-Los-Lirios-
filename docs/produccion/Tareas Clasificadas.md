---
tags: [produccion, tareas]
---

# Tareas por Clasificación

> La clasificación se deriva automáticamente del dict `CLASIFICACION_POR_TAREA` en `produccion.py`.  
> No se ingresa manualmente — es inferida por el sistema.

---

## Verano

`Cosecha` · `Tractor Cosecha` · `Pasero` · `Levantar Pasa` · `Control Cosecha` · `Amontonar Pasa`

## Invierno

`Poda` · `Atada` · `Tejido`

## Primavera

`Verde` · `Brote` · `Raleo` · `Polainas` · `Descole`

## Otoño

`Murones`

## General (todo el año)

`Jornal Comun` · `Tractor Comun` · `Riego` · `Mochila` · `Limpieza Acequia` · *(otros)*

---

## Modelos relacionados

- `Tarea` — registro de trabajo por parcela
- `Riego` — eventos de riego por parcela
- `Fitosanitario` — aplicaciones de agroquímicos
- `EstadoCampana` — estado actual de la campaña

## API functions

```typescript
// lib/api/produccion.ts
getTrabajos()
getEstadoActual()
getCiclosCampana()
getResumenPorTrabajador()
getResumenPorTarea()
getRiegos()
getFitosanitarios()
```

## Ver también

- [[Parcelas y Fincas]]
- [[Campaña 2026]]
