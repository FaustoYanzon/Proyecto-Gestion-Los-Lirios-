---
tags: [sistema, sesion, feature, fitosanitarios, mobile, trazabilidad]
---

# 2026-09-17 — Órdenes de aplicación fitosanitaria (deploy 2026-09-19)

Pedido inicial de Fausto: la operatoria de fitosanitarios era 100% verbal (ingeniero → encargado → operarios) y abierta a errores de producto/dosis/parcela. Propuso que el plan (o una necesidad puntual fuera de plan) genere **órdenes de aplicación** concretas que los operarios marquen como aplicadas, con producto/dosis/parcela ya fijados por la orden.

## Diseño (acordado con Fausto antes de programar)

- **Alcance de parcelas: ambos modos.** Una orden puede cubrir toda la variedad o parcelas puntuales elegidas al crearla — tanto si nace del plan como si es extra.
- **Confirmación individual, no por el encargado.** Cada operario confirma con su propio usuario/celular lo que efectivamente aplicó — nadie confirma en nombre de otro.
- **Cantidad y producto fijos al confirmar.** El operario no los puede editar; solo agrega observaciones (texto) y fotos opcionales.
- **Pool abierto, sin asignación nominal** (asumido explícitamente y confirmado por Fausto al aprobar el plan): cualquier operario activo de la finca ve todas las órdenes pendientes y confirma lo que aplicó — no hay "orden asignada a Juan". Si esto cambia, hace falta agregar un campo `asignado_a` a `OrdenAplicacionParcela`.

## Arquitectura clave

- La confirmación **no crea una tabla paralela** — genera un `RegistroFitosanitario` real (mismo modelo que ya usa toda la trazabilidad y el cumplimiento del plan), vinculado vía `OrdenAplicacionParcela.registro_fitosanitario_id`. Reusa el descuento de stock y el cálculo de carencia/reingreso ya existentes desde la sesión del 09-08 — cero lógica de negocio duplicada.
- **Consecuencia directa (no requirió ningún desarrollo extra):** la ficha de trazabilidad por parcela y el cumplimiento plan-vs-real (`plan_fitosanitario.py`, `_calcular_cumplimiento`) ya leen `RegistroFitosanitario` por `parcela_id`/fecha — las aplicaciones confirmadas por orden aparecen ahí automáticamente, igual que las cargadas a mano.
- **Los operarios no tenían login propio** (solo una fila en el catálogo `Trabajador`, sin `User`). Se agregó `User.trabajador_id` (FK nullable única) para resolver `responsable_id` sin pedírselo al operario. **Pendiente real, no resuelto en esta sesión:** dar de alta las cuentas `User` de los operarios existentes en `Trabajador` — sin esto no se pueden loguear a confirmar nada.
- Backend: `backend/app/api/ordenes_aplicacion.py` (`POST /desde-plan`, `POST /` extra, `GET /pendientes` con scope por finca, `POST /{orden}/parcelas/{item}/confirmar`, `POST /parcelas/{item}/fotos`). Modelos nuevos en `produccion.py`: `OrdenAplicacion`, `OrdenAplicacionParcela`, `FotoRegistroFitosanitario`.
- Fotos: suben a Cloudinary (mismo patrón que fotos de parcela/avatares — REST firmado, no el SDK sync), carpeta `fotos_ordenes_aplicacion/{orden_parcela_id}/...`; en la base solo se guarda el `secure_url`.
- Mobile: sección "Órdenes pendientes" arriba de la tab Fito (`OrdenesPendientes.tsx`) — carga libre sin orden queda oculta para obrero/regador (ya estaba restringida a `require_encargado_up` del lado del backend).
- Web: `/dashboard/produccion/ordenes-aplicacion` — generar desde plan / orden extra / seguimiento con barra de progreso por orden.

## Verificación

138/138 tests backend (9 nuevos: creación desde plan/extra, RBAC, confirmar descuenta stock y crea el registro, doble confirmación rechazada, finca cruzada rechazada, resolución de responsable vía `trabajador_id`). `tsc --noEmit` limpio en mobile y frontend, `eslint` sin errores nuevos. Probado en vivo en el navegador local (Claude in Chrome) contra Postgres real antes de deployar — regla ya establecida del proyecto.

**Incidente de entorno local (Windows), no de la app:** un proceso zombie quedó escuchando en el puerto 8000 (`netstat` lo mostraba LISTENING pero ni `Get-Process` ni `taskkill /F` lo encontraban) — resuelto pragmáticamente corriendo el backend de verificación en el puerto 8001 en vez de seguir peleando contra el SO. Next.js además rechaza un segundo `next dev` para el mismo proyecto aunque sea en otro puerto — hubo que frenar la instancia ya corriendo de Fausto y levantar una nueva apuntando a `:8001` vía `NEXT_PUBLIC_API_URL` inline. Fausto decidió dejar ese entorno local como quedó ("ya sigo yo").

## Deploy (2026-09-19, sesión aparte de la del diseño/build)

Los tres despliegues se hicieron en el mismo bloque, verificados uno por uno antes de seguir al siguiente:

1. **Backend (Railway):** `git push origin main` (commit `b5a2ff5`). Railway redeployó y corrió la migración sola, como siempre. Verificado sin acceso directo a los logs: `GET /ordenes-aplicacion/pendientes` sin auth devuelve `401` (no `404`) contra producción — confirma que el router quedó registrado.
2. **Frontend (Vercel):** `vercel --prod` desde `frontend/` — build limpio, `/dashboard/produccion/ordenes-aplicacion` aparece en las rutas generadas. Vercel no auto-despliega en este proyecto, hay que correrlo a mano cada vez.
3. **Mobile (EAS Update, sin `eas build` — cambio 100% JS):** `eas update --branch production --environment production` con `EXPO_PUBLIC_API_URL` inline (forma robusta ya documentada en `mobile/AGENTS.md`). Bundle publicado verificado con `grep` sobre el `.hbc` real: contiene la URL de Railway, sin ninguna IP de LAN.

**Pendiente real para que la feature se pueda usar de punta a punta:** dar de alta las cuentas `User` (vinculadas por `trabajador_id`) de los operarios que hoy solo existen como `Trabajador` en el catálogo — sin login propio no pueden confirmar ninguna orden desde el celular.

## Ver también

- [[Sistema de Gestión Agrícola]]
- [[Arquitectura]]
- [[2026-09-08-fertilizantes-stock-fitosanitarios]] (el `RegistroFitosanitario`/stock que esta feature reusa sin duplicar)
