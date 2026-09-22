---
tags: [produccion, parcelas, fincas]
---

# Parcelas y Fincas

## Fincas

| Nombre | ID en sistema |
|---|---|
| Los Mimbres | `los_mimbres` |
| Media Agua | `media_agua` |
| Caucete | `caucete` |

## Tipos de parcela

| Tipo | Descripción |
|---|---|
| `parral` | Viñedo con espaldera |
| `potrero` | Campo abierto |
| `pasero` | Zona de secado de uva pasa |
| `cabezal` | Cabeza de riego |

## Campos del modelo `Parcela`

```
id            UUID
nombre        string
tipo          parral | potrero | pasero | cabezal
finca         los_mimbres | media_agua | caucete
variedad_uva  string (nullable — solo parcelas parral)
superficie    Decimal (hectáreas)
```

## API functions

```typescript
// lib/api/produccion.ts
getParcelas()
```

## Ver también

- [[Tareas Clasificadas]]
- [[Campaña 2026]]
- [[Arquitectura]]
