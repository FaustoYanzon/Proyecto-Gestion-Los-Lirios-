---
tags: [finanzas, proveedores, AP]
---

# Cuentas por Pagar

> Gestión de pagos a proveedores e invoices

---

## Flujo de trabajo actual

1. Recepción de remito/factura del proveedor
2. Registro como `Egreso` en el sistema (tipo + clasificación + finca)
3. Seguimiento de vencimiento y forma de pago
4. Pago y confirmación

---

## Campos clave en el sistema

- `referencia_id` — ID de la factura o remito (agregado en migración `1cac1b6d2e3d`)
- `forma_pago` — efectivo / transferencia / cheque
- `origen_pago` — finca que abona
- `moneda` — ARS o USD (nunca mezclar)

---

## Proveedores

Ver carpeta [[04 - Proveedores]] para fichas individuales de cada proveedor.

---

## Ver también

- [[Presupuesto Anual]]
- [[Flujo de Caja]]
