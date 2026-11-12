---
fecha: 2026-11-11
tags: [sistema, decision, maquinaria, roles, finanzas, mobile]
estado: implementada en rama, pendiente de deploy
---

# Decisión: Módulo de Maquinaria

Sesión en [[2026-11-11-modulo-maquinaria]]. Spec: `docs/superpowers/specs/2026-11-11-maquinaria-design.md`. Especificación funcional original: `docs/proyectos/Sistema de Gestión de Maquinaria.md`.

## Contexto

No hay área de mantenimiento propia: todas las reparaciones las hace un taller externo. Hoy no existe registro de qué máquina está parada, en qué taller está, cuánto costó ni cuántos días estuvo fuera. El reporte de la falla lo hace el encargado de finca desde el campo, muchas veces sin señal. Gerencia y Finanzas son las mismas personas.

## Opciones consideradas

- **Rol nuevo para Finanzas de maquinaria.** Descartado: como gerencia y finanzas son las mismas personas, un rol separado solo agrega administración sin separar funciones reales.
- **Pestaña nueva en la barra inferior de mobile.** Descartada: la barra ya está llena y el módulo lo usan pocas personas. Se eligió un pin en el header que abre la hoja «Finca y módulos».
- **Bandeja de notificaciones con leída/no leída en v1.** Descartada: la línea de tiempo de la orden hace de bandeja, y las push usan `core/push.py`. Leída/no leída queda para la etapa 2.
- **Estado de la máquina almacenado.** Descartado: se calcula desde sus órdenes abiertas para que nunca se desincronice.

## Decisión

1. **Sin rol nuevo.** Aprobar presupuestos y registrar pagos requieren `gerencial` o `super_admin`.
2. **Visibilidad:** el módulo lo ven `encargado` y superiores (`require_encargado_estricto`). Regador y obrero no. Los tractoristas se suman más adelante.
3. **Máquinas entre fincas:** la máquina tiene una finca actual, editable por gerencial. Cada orden guarda la **finca snapshot** al momento del reporte, así que el historial no cambia si la máquina se traslada. El encargado ve solo las órdenes de su finca; gerencial y super_admin ven todas.
4. **Moneda:** presupuestos y pagos solo en ARS.
5. **Estado derivado:** el estado de la máquina es el peor de sus órdenes abiertas. Prioridad: En taller (`enviada_taller`, `en_reparacion`, `lista_retirar`) > Parada (orden abierta con gravedad `parada`) > Operativa con observaciones (cualquier otra orden abierta, incluida `pendiente_validacion`) > Operativa.
6. **Cancelación** solo hasta `enviada_taller` inclusive, con motivo.
7. **Reabrir:** el encargado puede reabrir desde `pendiente_validacion` hacia `en_reparacion`, con motivo obligatorio. El pago registrado se conserva.
8. **Presupuestos:** todos pasan por aprobación, sin tope por monto. Un presupuesto pendiente a la vez por orden; los rechazados quedan en historial. Gerencia puede aprobar o rechazar también desde mobile.
9. **Pago y Egreso:** registrar el pago crea un `Egreso` con `fuente=maquinaria`, `tipo=repuestos_reparacion`, `origen=no_oficial` y `forma_pago=transferencia` por defecto (editables al cargar). Finanzas **no puede editar ni borrar** ese egreso (responde 409 y remite a la orden); se gestiona solo desde la orden. Anular el pago borra el egreso.
10. **Reporte offline:** la falla se encola en `offlineQueue` con `idempotency_key` (unique en `maquinaria_ordenes`), así un reenvío no duplica la orden. Las fotos no viajan en la cola; se suben después a `POST /ordenes/{id}/fotos`. Máximo 2 por reporte.
11. **Push:** el tap abre la orden directamente.
12. **Mobile:** entrada por pin en el header que abre «Finca y módulos». El selector de finca se movió desde el drawer de perfil a esa hoja.

## Consecuencias

- Los egresos de maquinaria aparecen en Finanzas con `fuente=maquinaria`; el registro de pago es la única vía de carga.
- El encargado depende de la finca snapshot: si una máquina cambia de finca, sus órdenes viejas siguen en la finca original.
- Un teléfono compartido puede cambiar la finca asignada a un encargado (`loadFinca`, preexistente). Sin resolver.
- Los drawers de maquinaria se renderizan con portal a body (`7ddeba1`). El `Sheet` de `finanzas/ingresos` tiene el mismo problema de z-index/portal y sigue sin corregir.
- Cámara en mobile requiere build nativo: `expo-image-picker` no tiene config plugin en `app.json`. Hoy solo galería.
- Deploy: la migración `60332c8268d5` requiere confirmación explícita antes de aplicarse en producción. `Modelo de Datos.md` se regenera después de ese deploy.

## Ver también

- [[2026-11-11-modulo-maquinaria]]
- [[Arquitectura]]
- [[Bugs Conocidos]]
