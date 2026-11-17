# Auditoría de permisos: páginas Insumos y Producto Terminado (2026-11-17)

Contexto: el rol `encargado` pasa a ver Inventarios (solo la pestaña Alfalfa). El menú oculta Insumos y Producto Terminado, pero solo oculta; no hay guard de ruta. Esta auditoría lista qué endpoints consumen esas dos páginas y quién puede llamarlos. No se cambió código de backend.

Guards (`backend/app/api/deps.py`): `require_encargado_up` = super_admin + gerencial + encargado + regador. `require_gerencial_up` = super_admin + gerencial.

| Endpoint | Método | Guard | Roles que pueden llamarlo | ¿Encargado lo alcanza por URL? |
|---|---|---|---|---|
| `/insumos/` (`getInsumos`) | GET | `require_encargado_up` | super_admin, gerencial, encargado, regador | Sí |
| `/insumos/` (`createInsumo`) | POST | `require_encargado_up` | ídem | Sí |
| `/insumos/{id}` (`updateInsumo`) | PUT | `require_encargado_up` | ídem | Sí |
| `/insumos/{id}/movimientos` (`registrarMovimiento`) | POST | `require_encargado_up` | ídem | Sí |
| `/plan-fitosanitario/necesidad-stock` (`getNecesidadStock`) | GET | `require_encargado_up` | ídem | Sí |
| `/lotes-pasa/` (`getLotesPasa`) | GET | `require_encargado_up` | ídem | Sí |
| `/alta-produccion/depositos` (`getDepositos`) | GET | `require_encargado_up` | ídem | Sí |

Hallazgo: los 7 endpoints consumidos son alcanzables por `encargado` (y `regador`). Un encargado que escriba la URL `/dashboard/inventarios/insumos` o `/producto-terminado` ve la página y puede crear/editar insumos y registrar movimientos de stock. Es coherente con el acceso actual del backend, pero la UI de Insumos antes solo la veía gerencial.

Decisión pendiente (Fausto): si se quiere restringir, cambiar a `require_gerencial_up` en las escrituras de `insumos.py` (POST/PUT/movimientos) y/o agregar guard de ruta en el frontend. Ojo: `/insumos/` GET, `/lotes-pasa/` y `/depositos` los usan también otros módulos (órdenes de aplicación, alta de producción, mobile), así que restringirlos rompería esos flujos.
