---
tags: [sistema, sesion]
---

# 2026-08-12 — Notificaciones push (pantalla web) y responsividad mobile

Quinta tanda del día. Cierra los dos puntos "no bloqueantes" que habían quedado anotados en el roadmap.

## Alcance acordado con Fausto

- Notificaciones: solo la pantalla manual de envío (título/cuerpo/destinatarios). Los triggers automáticos desde Alertas quedan como decisión de diseño aparte, no se tocó.
- Responsividad: las 13 páginas identificadas, todas en esta sesión (no solo las de uso diario del campo).

## Notificaciones push

`/dashboard/admin/notificaciones` (nuevo). Compone título (máx. 100) y cuerpo (máx. 300), elige destinatarios: "Todos los usuarios" (cualquier gerencial+) o "Usuarios específicos" (checkbox por usuario, solo visible para `super_admin` porque `GET /users/` que lista para elegir es `require_super_admin` en el backend — no se tocó ese endpoint). Llama a `POST /notificaciones/enviar`, que ya existía desde antes pero no tenía ninguna UI que lo usara. Maneja el caso "sin tokens registrados" (404) con un mensaje claro en vez de un error genérico. Sin cambios de backend — endpoint y lógica de token ya estaban completos.

## Responsividad — 13 páginas

Auditoría más fina que el conteo original de "12/51 con breakpoints": varias páginas (`flujo`, `flujo/desglose/[tipo]`, `presupuesto`, `campana`) ya resolvían el ancho correctamente con `flex-wrap` en el header + `overflow-x-auto` en las tablas (patrón correcto para tablas tipo planilla con muchas columnas — forzar un layout de tarjetas ahí sería peor, no mejor). Esas quedaron confirmadas, no tocadas.

El problema real, repetido en 6 páginas (`admin/parcelas`, `admin/usuarios`, `admin/trabajadores`, `finanzas/cheques`, `finanzas/egresos`, `finanzas/ingresos`, `produccion/{riego,fitosanitarios,tareas}`): el header (`título + botones de acción`) usaba `flex items-center justify-between` sin wrap — con 2-3 botones (CSV, Nuevo Registro, Iniciar riego...) se superponían en una pantalla angosta. Cambiado a `flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3` (apila en mobile, fila en desktop) en las 9 páginas afectadas.

**Hallazgo real en el mapa:** `FincaMapInner.tsx`, el panel de detalle de parcela (se abre al tocar un parral) tenía `w-72` (288px) fijo — en un celular angosto eso tapa casi toda la pantalla sin dejar margen utilizable. Corregido a `w-full sm:w-72` (ocupa toda la pantalla en mobile, vuelve a ser un panel lateral en desktop).

Las tablas de datos (`TareasTable`, `RiegoTable`, `FitosanitariosTable`, `EgresosTable`, `IngresosTable`) ya tenían `overflow-x-auto` desde antes — no fue necesario tocarlas, el problema nunca fue la tabla en sí, sino los headers y (en el mapa) el panel fijo.

**Alcance dejado fuera a propósito:** los grids de 2 columnas dentro de los modales de formulario (ej. Tipo/Variedad en Parcelas, DNI/Teléfono en Trabajadores) — son campos cortos dentro de un modal que ya achica a `max-w-md`, funcionan razonablemente incluso en 2 columnas en un celular. No se tocaron para no scope-creepear más allá de las 13 páginas pedidas.

## Verificación

`tsc --noEmit` limpio. `eslint` sobre todos los archivos tocados: 0 errores (mismos 2 warnings preexistentes de `watch()`/React Compiler que ya aparecen en el resto del código, no introducidos por estos cambios).

## Deploy

Commit `5cf4da4`, pusheado. `vercel --prod` corrido — pantalla de notificaciones y fixes de responsividad en producción.

## Ver también

- [[2026-08-12-catalogo-trabajadores-vacio-y-fix]]
- [[Sistema de Gestión Agrícola]]
