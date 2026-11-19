# 2026-11-19 — Cierre de sesión y traspaso: mobile Depósitos / egreso / pestañas

Sesión larga del 2026-11-18 (noche). Este documento es el punto de partida de la sesión limpia siguiente: qué quedó hecho, qué correcciones pidió Fausto durante la prueba en el iPhone y qué falta para publicar.

## 1. Estado de las ramas
- `main` (local y remoto, HEAD `14fab03`): alfalfa, anulación (solo super_admin) y mobile paseros/alfalfa ya subidos. Migración `a2a2a2a00001` aplicada en producción.
- Rama `feat/mobile-depositos` (HEAD de código `5d3512c` + este documento): **sin mergear, sin push, sin OTA**. Contiene Depósitos, egreso de insumos, pestañas de Cosecha y la migración `b3e9a1d4c7f2` (aplicada solo en la base LOCAL).
- Backend local: 768 tests pasan (excluido `tests/test_riego_manto_60mm.py::test_cumplimiento_cuenta_1_56_riegos_por_manto`, depende de la fecha). `npx tsc --noEmit` limpio.

## 2. Lo que se hizo en la sesión (resumen)
- Prueba en el iPhone contra backend local: paseros en el mapa y alfalfa mobile aprobados ("anda todo joya la lógica").
- **Depósitos** (menú lateral, debajo de Maquinaria): pestañas Fitosanitarios | Insumos | Paseros | Bodega | Alfalfa; «+ Ingreso» (fito e insumos varios) y «− Egreso» (solo insumos varios).
- **Egreso de insumos varios** (backend + app): tipo `egreso`, campo `destino` obligatorio en texto libre (máquina, tractor o parcela; se clasificará cuando estén cargados todos los insumos), stock puede quedar negativo con aviso, solo encargado y superiores (regador 403), fitosanitarios fuera. Detalle en `Decisiones/2026-11-18-egreso-insumos-destino-libre.md`.
- **Idempotencia** en movimientos de insumo (`idempotency_key`, replay 200, 409 si la clave se reusa para otro insumo/tipo, carrera resuelta con `begin_nested`).
- **Inicio**: acciones rápidas «Ingreso de insumos» y «Egreso de insumos».
- **Cosecha en pestañas**: Uva | Pasa | Alfalfa (`AlfalfaPanel` compartido).
- **Mapa**: los polígonos no se veían por datos locales (`coordenadas` JSON null); se rellenaron solo en la base local desde el KML. No hay cambio de código; producción no está afectada.
- Revisión final del branch (opus) y correcciones en `5d3512c`.
- Documentos: specs y planes `2026-11-18-mobile-depositos*` y `2026-11-18-depositos-egreso-cosecha-tabs*` en `docs/superpowers/`, bitácora `2026-11-18-mobile-depositos.md`, decisión del egreso.

## 3. Correcciones pedidas por Fausto durante la prueba (NO implementadas todavía)
Hacer estas cuatro primero, en la sesión nueva, sobre `feat/mobile-depositos`:

1. **Botones Ingreso/Egreso se pisan entre sí en el medio** (pestaña Insumos de Depósitos; revisar también las acciones rápidas de Inicio). Causa probable: `accionesRow` con dos botones en el encabezado de la tarjeta junto al título (`mobile/app/depositos/index.tsx`, `InsumosCard`). Solución propuesta: mover los botones a su propia fila bajo el título, cada uno con `flex: 1`.
2. **Cosecha → pestaña Alfalfa**: «Alta» pasa a ser un botón flotante «+» abajo a la derecha (mismo estilo que el FAB de Uva); queda **solo** el botón de «Entrega», con un dibujo de fardo como ícono. Supuesto mío a confirmar al mostrarlo: la Entrega queda como botón dentro del panel (no FAB) con el ícono de fardo.
3. **Depósito Paseros**: mostrar **los 3 paseros diferenciados, en orden numérico, aunque alguno no tenga nada** (hoy solo se agrupa por variedad la uva que hay). Requiere listar las parcelas de tipo `pasero` (verificar que sean 3 en la base) y cruzar con el saldo de `getResumenPaseros` (`mobile/lib/depositos.ts`). Mostrar «0 kg» / «Vacío» en los que no tienen uva. Orden por el número del nombre, no alfabético plano.
4. **Cosecha → Alfalfa**: sacar el bloque de **stock** (queda solo en Depósitos → Alfalfa). Cuidado: `AlfalfaPanel` también lo usa la pantalla suelta `/alta-produccion/alfalfa` (botón «Abrir» de Depósitos); decidir si el panel recibe un prop (`mostrarStock`) o se separa el stock. Mi recomendación: prop `mostrarStock` (false en Cosecha, true en la pantalla suelta).

## 4. Pendientes para publicar (cada paso se confirma con Fausto)
1. Probar el resto en el iPhone y cerrar las correcciones de arriba (+ `tsc`, tests si se toca backend).
2. Mergear `feat/mobile-depositos` a `main` (local).
3. **Backup de la base de producción** (`pg_backups/`, no leer el contenido).
4. Push a `main` → Railway aplica `b3e9a1d4c7f2` (`ALTER TYPE ... ADD VALUE 'egreso'`, irreversible). Mirar logs (`npx @railway/cli logs -n 100`) y verificar `alembic current`.
5. Verificar en producción: `POST /insumos/{id}/movimientos` con egreso (con un insumo de prueba y su reversión por ingreso), y que `pdf-link` de alfalfa devuelva URL `https://`.
6. Regenerar `docs/sistema/Modelo de Datos.md` (`python scripts/generate_modelo_datos.py`; lee la base de PRODUCCIÓN, por eso va después de migrar) y `PROJECT_MAP.md`.
7. **Un solo OTA** con alfalfa, paseros, depósitos, egreso y pestañas: `EXPO_PUBLIC_API_URL=https://proyecto-gestion-los-lirios-production.up.railway.app npx eas update --branch production --environment production -m "..."` (PowerShell: `$env:EXPO_PUBLIC_API_URL = "..."`). Verificar que el bundle tenga la URL de producción y ningún `192.168.*` ni `172.20.*`. No tocar `eas.json` ni dependencias nativas. Publicar solo con OK explícito.
8. Verificar si la web de la anulación (Vercel) se desplegó (`npx vercel --prod` es manual). Confirmar el estado antes de asumir.
9. Borrar los workspaces git-ignorados `.superpowers/sdd/2026-11-18-mobile-depositos/` y `.superpowers/sdd/2026-11-18-depositos-egreso-cosecha-tabs/` tras el merge.
10. Actualizar la memoria `project_serie_paseros_manto_alfalfa.md` con el resultado.

**Riesgo a recordar:** si tras migrar alguien carga un egreso y hay que volver al código viejo, ese código falla al listar movimientos (enum desconocido). Antes de cualquier rollback, convertir o borrar esas filas.

## 5. Pendientes abiertos de producto (fuera de este cambio)
- Web: tipos `egreso`, `destino` e `idempotency_key` en `frontend/lib/api/insumos.ts`; detalle por depósito; historial de movimientos; columnas proveedor/remito; clasificar el `destino` de los egresos por máquina/parcela cuando estén cargados los insumos.
- Decisión abierta: anulación de FRE/BOD (hoy 409 por decisión de Fausto).
- Cola offline para alfalfa/movimientos si hay problemas de señal en campo.
- Carrera `stock_actual` (read-modify-write) entre dos movimientos simultáneos del mismo insumo: previa a esta rama.
- Base local con restos de pruebas (usuarios y documentos QA).

## 6. Entorno de prueba local (para retomar o limpiar)
- La IP de la PC cambia con la red (casa `192.168.2.130`, hotspot del iPhone `172.20.10.4`). Metro necesita `REACT_NATIVE_PACKAGER_HOSTNAME=<ip>` y `EXPO_PUBLIC_API_URL=http://<ip>:8000`; si queda un Metro viejo en el 8081 hay que matarlo con `taskkill /PID <pid> /F /T` (TaskStop solo mata el envoltorio).
- Backend local: `uvicorn app.main:app --host 0.0.0.0 --port 8000` sin `--reload` (reiniciar tras cambios de código).
- Regla de firewall de Windows creada: `Lirios dev 8000 8081` (entrada TCP, cualquier perfil). Quitar cuando no se necesite: `Remove-NetFirewallRule -DisplayName 'Lirios dev 8000 8081'` (PowerShell administrador).
- Al cerrar la sesión se detuvieron Metro y el backend local.

## 7. Actualización 2026-11-19: publicado
- Las 4 correcciones quedaron hechas (commit `4f23f93`) y aprobadas por Fausto en el iPhone.
- Merge a `main` (`55a8a68`), backup previo `pg_backups/loslirios_prod_20261119_102914.dump`, 768 tests OK, push a `main`; Railway aplicó `b3e9a1d4c7f2` (`alembic current` en producción = head).
- Verificación en producción (solo lectura): enum con `egreso`, columnas `destino`/`idempotency_key` e índice único presentes; egreso sobre fitosanitario → 422; GET movimientos → 200; sin cambios en `movimientos_stock`. **El egreso real NO se probó**: producción solo tiene 17 insumos fitosanitarios, ningún `vario`. Probar con el primer insumo vario que se cargue.
- OTA único publicado en `production` (iOS 3d4e69b8…, Android 515a0c1c…, commit `55a8a68`); bundle verificado con la URL de producción y sin IPs de la LAN.
- Modelo de Datos y PROJECT_MAP regenerados; workspaces `.superpowers/sdd/2026-11-18-*` borrados.
- Pendiente: confirmar `pdf-link` https en uso real, deploy web (Vercel, manual) de la anulación si no se hizo, y los pendientes de producto de la sección 5.
