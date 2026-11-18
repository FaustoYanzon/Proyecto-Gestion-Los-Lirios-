---
fecha: 2026-11-18
tags: [sistema, decision, mobile, alfalfa, offline]
estado: implementada en rama feat/mobile-alfalfa (sin mergear ni desplegar)
---

# Decisión: alfalfa en mobile solo con conexión

Spec: `docs/superpowers/specs/2026-11-18-mobile-paseros-alfalfa-design.md`. Paso 5 de la serie paseros → manto → alfalfa → anulación → mobile.

## Decisión (Fausto, 2026-11-18)

Opción A: el alta y la entrega de alfalfa en mobile **requieren conexión**. No hay cola offline. Si aparecen problemas de señal en el campo, se agrega una cola offline después (el backend ya es idempotente por `idempotency_key`, así que no hay que cambiarlo).

## Alcance

- Mobile: pantalla de Alfalfa con alta a un potrero y entrega a un comprador, más panel de pasero en el mapa (los paseros salen de los selectores de riego y fito).
- **La entrega de pasa en mobile no se toca.**
- **La anulación sigue solo en la web.** Solo `super_admin` puede anular; un `encargado` no puede, por eso el paso de revisión antes de guardar le advierte que un documento mal cargado lo tiene que anular un super_admin desde la web.
- PDF: el documento se abre con un link firmado de corta vida (`POST /alfalfa/documentos/{id}/pdf-link`), mismo patrón que remitos.

## Por qué

Es el flujo más simple y sin riesgo de duplicados. La cola offline agrega estados (pendiente, fallido, reintento) y conflictos de stock que hoy no se justifican sin evidencia de mala señal.
