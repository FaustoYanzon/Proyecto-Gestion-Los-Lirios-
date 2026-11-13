# Los Lirios — Sistema de Gestión de Maquinaria

## 1. Objetivo

Módulo del sistema de gestión de Los Lirios para registrar la maquinaria de la empresa, reportar fallas desde el campo y seguir cada reparación (taller externo, presupuesto, aprobación de finanzas, pago y cierre), de modo que gerencia tenga siempre visible el estado de cada equipo.

## 2. Contexto

- Maquinaria inicial: 4 tractores, 2 cosechadoras, 1 enfardadora y varios implementos (a relevar y dar de alta).
- No hay área de mantenimiento propia: todas las reparaciones las hacen talleres externos. Cuando el taller avisa que está listo, se paga y la máquina se reinstala en la empresa.
- Se necesita notificación push en la app/celular. No hacen falta WhatsApp ni mail.

## 3. Roles y permisos

- **Operario / encargado de finca** (después también tractoristas): reporta fallas (máquina, descripción, fotos, gravedad) y confirma la recepción al volver del taller. Al inicio solo el encargado; luego se suman los tractoristas.
- **Gerencia (ingenieros)**: toma la orden, diagnostica, elige taller, pide y carga el presupuesto, actualiza estados (enviada al taller, en reparación, lista para retirar).
- **Finanzas (ingenieros)**: aprueba o rechaza el presupuesto y registra el pago.
- El encargado NO puede aprobar presupuestos ni gestionar la reparación después de generar el reporte.

## 4. Modelo de datos (propuesto)

- **Máquina**: tipo (tractor, cosechadora, enfardadora, implemento), marca, modelo, año, patente/serie, horas de motor (campo opcional para etapa 2), estado, fotos, implemento asociado a tractor (opcional).
- **Orden de trabajo**: máquina, reportada por, fecha/hora, descripción, fotos, gravedad (puede seguir trabajando / parada), estado, taller, fecha estimada de entrega, historial de estados.
- **Presupuesto**: orden, taller, monto, detalle, adjunto, estado (pendiente / aprobado / rechazado), motivo de rechazo, aprobado por, fecha. Una orden puede tener varios presupuestos sucesivos.
- **Pago**: orden, monto real, factura, fecha, registrado por.
- **Notificación**: destinatario por rol, evento, leída o no.

## 5. Estados de la máquina

- Operativa (verde)
- Operativa con observaciones (amarillo)
- Parada / fuera de servicio (rojo)
- En taller (azul)

## 6. Estados de la orden de trabajo

1. Reportada
2. Diagnosticada
3. Presupuesto pendiente de aprobación
4. Presupuesto aprobado (si finanzas rechaza, vuelve a gerencia con el motivo y se pide un nuevo presupuesto; la orden NO se cierra)
5. Enviada al taller
6. En reparación
7. Lista para retirar
8. Pendiente de validación del encargado (la máquina vuelve del taller)
9. Cerrada (el encargado confirma que quedó funcionando; la máquina pasa a operativa)

- Salida alternativa: Cancelada, solo si gerencia decide no reparar.
- Si el encargado detecta que quedó mal, reabre la orden.

## 7. Flujo completo

1. El encargado reporta la falla en la app con descripción, fotos y gravedad. La máquina cambia de estado automáticamente y se notifica a gerencia.
2. Gerencia diagnostica, elige taller y carga el presupuesto.
3. Notificación a finanzas. Finanzas aprueba o rechaza.
4. Si rechaza: vuelve a gerencia con el motivo y se carga un nuevo presupuesto (otro taller o renegociación). Se repite hasta aprobación.
5. Aprobado: se envía la máquina al taller y gerencia actualiza el estado a medida que avanza.
6. Cuando el taller avisa que está lista, gerencia la marca para retirar; finanzas registra el pago.
7. La máquina vuelve a la finca. El encargado valida en la app que llegó y funciona. Recién ahí se cierra la orden y la máquina queda operativa.
8. Cada máquina acumula historial: órdenes, costos, días fuera de servicio.

## 8. Pantallas

- **Pestaña Maquinaria**: lista de equipos con semáforo de estado, filtro por tipo y estado, acceso a la ficha.
- **Ficha de máquina**: datos, estado, historial de órdenes y costos.
- **Reportar falla** (vista simple, pensada para celular y para uso en campo).
- **Órdenes de trabajo**: tablero por estado, con vista según rol.
- **Detalle de orden**: línea de tiempo de estados, fotos, presupuestos, pagos.
- **Notificaciones push** por rol: gerencia recibe fallas y presupuestos rechazados; finanzas recibe presupuestos pendientes y máquinas listas para pagar; encargado recibe cambios de estado y aviso de máquina lista para retirar.

## 9. Fuera de alcance por ahora (etapa 2)

- Mantenimiento preventivo por horas de motor.
- Control de combustible y repuestos.
- Indicadores de costo por hora, MTTR y fallas por máquina.

## 10. Puntos abiertos

- Relevar y cargar los implementos exactos.
- Definir si hay un tope de monto bajo el cual no haga falta aprobación de finanzas.
- Definir cuándo se suman los tractoristas como reportantes.

## 11. Prompt para Claude Code

Trabajá sobre el sistema de gestión existente de Los Lirios. Implementá un módulo de Gestión de Maquinaria siguiendo esta especificación. Respetá el stack y la autenticación por roles que ya tiene el proyecto. Empezá con el modelo de datos y la máquina de estados de la orden de trabajo, incluyendo los permisos por rol (operario reporta y valida; gerencia diagnostica y gestiona; finanzas aprueba y paga). Después construí la pestaña Maquinaria con el semáforo de estados, la vista móvil para reportar fallas con fotos, el tablero de órdenes y las notificaciones push por rol. Antes de escribir código, revisá la estructura actual del proyecto, proponé un plan por etapas y esperá mi confirmación.
