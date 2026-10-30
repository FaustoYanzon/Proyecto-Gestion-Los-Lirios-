"""Shared logic for applied phytosanitary records and the application orders
they came from. Used by both `app.api.produccion` (Eliminar / Reactivar a
RegistroFitosanitario) and `app.api.ordenes_aplicacion` (confirm / deshacer),
so neither router has to import the other.

- Eliminar: the application leaves the system AND the order (its valve row,
  the parcel row if it runs out of valves, the whole order if it runs out of
  parcels). Nothing is left pending.
- Reactivar: the application goes back to pendiente in its order so it can be
  confirmed again (for a valve, exactly what "deshacer" does).

No commits here: `get_db` commits (or rolls back) the whole request.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import and_, func, inspect, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import set_committed_value

from app.core.cloudinary_client import encolar_borrado
from app.models.insumo import Insumo, MovimientoStock
from app.models.produccion import (
    EstadoOrdenAplicacion,
    EstadoOrdenAplicacionParcela,
    FotoRegistroFitosanitario,
    OrdenAplicacion,
    OrdenAplicacionParcela,
    OrdenAplicacionValvula,
    RegistroFitosanitario,
)

_REGISTRO_CON_ORDEN_OPTS = (
    selectinload(RegistroFitosanitario.fotos),
    selectinload(RegistroFitosanitario.orden_parcela).selectinload(OrdenAplicacionParcela.valvulas),
    selectinload(RegistroFitosanitario.orden_valvula).selectinload(OrdenAplicacionValvula.orden_parcela),
)


async def revertir_movimiento_stock(db: AsyncSession, fito: RegistroFitosanitario) -> None:
    """Deshace el egreso de stock asociado a un RegistroFitosanitario (si existe):
    devuelve la cantidad al insumo y borra el movimiento. Usado antes de recalcular
    en un update, y siempre antes de un delete."""
    result = await db.execute(
        select(MovimientoStock).where(MovimientoStock.registro_fitosanitario_id == fito.id)
    )
    movimiento = result.scalar_one_or_none()
    if movimiento is None:
        return
    insumo = await db.get(Insumo, movimiento.insumo_id)
    if insumo is not None:
        insumo.stock_actual = insumo.stock_actual + movimiento.cantidad
    await db.delete(movimiento)
    await db.flush()


async def bloquear_orden(db: AsyncSession, orden_id: str) -> None:
    """Toma el lock (FOR UPDATE) de la fila de la orden antes de confirmar nada.

    Serializa las confirmaciones de una misma orden: un doble toque o un
    reintento de red no confirma (ni descuenta stock) dos veces, y dos operarios
    cerrando a la vez las últimas válvulas de un parral no dejan la parcela o la
    orden trabadas en pendiente (en READ COMMITTED cada uno contaría como
    pendiente la válvula que el otro todavía no commiteó). El commit de `get_db`
    libera el lock. SQLite (tests) ignora el FOR UPDATE.
    """
    await db.execute(
        select(OrdenAplicacion.id).where(OrdenAplicacion.id == orden_id).with_for_update()
    )


async def recalcular_estado_orden(db: AsyncSession, orden: OrdenAplicacion) -> None:
    """completada si todas las parcelas están aplicadas; en_curso si alguna
    parcela o alguna válvula ya se confirmó; pendiente si no hay nada aplicado
    (baja de estado al deshacer una válvula)."""
    await db.refresh(orden, attribute_names=["parcelas"])
    estados = {p.estado for p in orden.parcelas}
    if estados == {EstadoOrdenAplicacionParcela.aplicada}:
        orden.estado = EstadoOrdenAplicacion.completada
        await db.flush()
        return
    valvulas_aplicadas = (
        await db.execute(
            select(func.count(OrdenAplicacionValvula.id))
            .join(OrdenAplicacionParcela)
            .where(
                OrdenAplicacionParcela.orden_id == orden.id,
                OrdenAplicacionValvula.estado == EstadoOrdenAplicacionParcela.aplicada,
            )
        )
    ).scalar_one()
    if EstadoOrdenAplicacionParcela.aplicada in estados or valvulas_aplicadas:
        orden.estado = EstadoOrdenAplicacion.en_curso
    else:
        orden.estado = EstadoOrdenAplicacion.pendiente
    await db.flush()


async def registros_de_fila(
    db: AsyncSession,
    *,
    fila_valvula: OrdenAplicacionValvula | None = None,
    item: OrdenAplicacionParcela | None = None,
) -> list[RegistroFitosanitario]:
    """Todos los registros (uno por producto) de una confirmación: los de la
    válvula, o los de la parcela entera. Exactamente uno de los dos argumentos.

    A fresh query, not the loaded collection: it must see the DB as it is
    after the order lock.

    Also matches the row's legacy `registro_fitosanitario_id`: a registro the
    old backend wrote after the migration carries only that link (its
    orden_valvula_id / orden_parcela_id stay NULL), and it must still be
    refunded and deleted, or a re-confirm would discount the stock twice."""
    if (fila_valvula is None) == (item is None):
        raise ValueError("registros_de_fila needs exactly one of fila_valvula / item")
    fila = fila_valvula if fila_valvula is not None else item
    if fila_valvula is not None:
        condiciones = [RegistroFitosanitario.orden_valvula_id == fila_valvula.id]
    else:
        # Valve registros also carry orden_parcela_id; a whole-parcel
        # confirmation never has orden_valvula_id, so exclude them.
        condiciones = [
            and_(
                RegistroFitosanitario.orden_parcela_id == item.id,
                RegistroFitosanitario.orden_valvula_id.is_(None),
            )
        ]
    if fila.registro_fitosanitario_id is not None:
        condiciones.append(RegistroFitosanitario.id == fila.registro_fitosanitario_id)
    # A single OR query returns each row once, so no dedupe is needed.
    result = await db.execute(
        select(RegistroFitosanitario).where(or_(*condiciones)).order_by(RegistroFitosanitario.id)
    )
    return list(result.scalars().all())


def _quitar_de_coleccion(
    obj: OrdenAplicacionValvula | OrdenAplicacionParcela, borrados: list[RegistroFitosanitario]
) -> None:
    """Drops already deleted records from `obj.registros` if it is loaded,
    without emitting history: a later delete of `obj` must not try to null FKs
    on rows that are gone. An unloaded collection is left unloaded."""
    if "registros" in inspect(obj).unloaded:
        return
    ids = {r.id for r in borrados}
    set_committed_value(obj, "registros", [r for r in obj.registros if r.id not in ids])


async def _borrar_registros(
    db: AsyncSession,
    registros: list[RegistroFitosanitario],
    *,
    fila_valvula: OrdenAplicacionValvula | None = None,
    item: OrdenAplicacionParcela | None = None,
) -> int:
    """Devuelve el stock de cada registro, borra sus fotos (y las de la
    válvula) y borra los registros. Devuelve cuántos registros borró.

    Order matters for the FKs: revert stock -> photos -> detach the legacy
    `registro_fitosanitario_id` shim -> delete registros, flushing in between."""
    for registro in registros:
        await revertir_movimiento_stock(db, registro)

    # Whole-parcel photos hang only from the first-line registro; valve photos
    # hang from the row (always) and, for completa, from that registro too.
    condiciones = []
    ids = [r.id for r in registros]
    if ids:
        condiciones.append(FotoRegistroFitosanitario.registro_fitosanitario_id.in_(ids))
    if fila_valvula is not None:
        condiciones.append(FotoRegistroFitosanitario.orden_valvula_id == fila_valvula.id)
    if condiciones:
        fotos = (
            await db.execute(select(FotoRegistroFitosanitario).where(or_(*condiciones)))
        ).scalars().all()
        for foto in fotos:
            encolar_borrado(db, foto.url)
            await db.delete(foto)

    # Legacy unique FK from the row to the first registro: detach before deleting.
    filas = [f for f in (fila_valvula, item) if f is not None]
    for fila in filas:
        fila.registro_fitosanitario_id = None
    await db.flush()

    for registro in registros:
        await db.delete(registro)
    await db.flush()
    for fila in filas:
        _quitar_de_coleccion(fila, registros)
    return len(registros)


async def deshacer_fila_valvula(
    db: AsyncSession, fila: OrdenAplicacionValvula, orden: OrdenAplicacion
) -> str | None:
    """Revierte la confirmación de una válvula: devuelve el stock de todos sus
    productos, borra sus registros fitosanitarios y sus fotos, y deja la fila
    (y la parcela/orden) en pendiente para poder confirmarla de nuevo.
    Devuelve el id del registro legacy de la fila (el de la primera línea;
    None si la válvula se había confirmado como no_aplicada).

    Requiere `fila.orden_parcela` cargado, la orden bloqueada
    (`bloquear_orden`) y los chequeos de permiso/estado hechos.
    """
    item = fila.orden_parcela
    registro_id = fila.registro_fitosanitario_id
    registros = await registros_de_fila(db, fila_valvula=fila)
    await _borrar_registros(db, registros, fila_valvula=fila)

    fila.estado = EstadoOrdenAplicacionParcela.pendiente
    fila.resultado = None
    fila.responsable_id = None
    fila.responsable = None
    fila.observaciones = None
    fila.confirmada_at = None
    fila.revisada_at = None
    fila.revisada_por = None
    if item.estado == EstadoOrdenAplicacionParcela.aplicada:
        item.estado = EstadoOrdenAplicacionParcela.pendiente
    await db.flush()
    await recalcular_estado_orden(db, orden)
    return registro_id


async def _vincular_registro_legacy(db: AsyncSession, registro_id: str) -> None:
    """Fills `orden_valvula_id` / `orden_parcela_id` of a registro that is
    linked to its order ONLY through the legacy `registro_fitosanitario_id` of
    a valve or parcel row (written by the old backend after the migration).
    Without it Eliminar would treat it as manual and try to delete a row the
    legacy FK still references, and Reactivar would answer 409.

    Runs after the order lock and as a Core UPDATE, so no stale ORM instance
    is left behind; a registro that already has the new links is untouched."""
    vinculos = (
        await db.execute(
            select(
                RegistroFitosanitario.orden_valvula_id, RegistroFitosanitario.orden_parcela_id
            ).where(RegistroFitosanitario.id == registro_id)
        )
    ).first()
    if vinculos is None or vinculos.orden_valvula_id is not None or vinculos.orden_parcela_id is not None:
        return
    # Valve first, mirroring the dispatch in reactivar/eliminar.
    valvula = (
        await db.execute(
            select(OrdenAplicacionValvula.id, OrdenAplicacionValvula.orden_parcela_id).where(
                OrdenAplicacionValvula.registro_fitosanitario_id == registro_id
            )
        )
    ).first()
    if valvula is not None:
        valores = {"orden_valvula_id": valvula.id, "orden_parcela_id": valvula.orden_parcela_id}
    else:
        parcela_id = (
            await db.execute(
                select(OrdenAplicacionParcela.id).where(
                    OrdenAplicacionParcela.registro_fitosanitario_id == registro_id
                )
            )
        ).scalar_one_or_none()
        if parcela_id is None:
            return
        valores = {"orden_parcela_id": parcela_id}
    await db.execute(
        update(RegistroFitosanitario)
        .where(RegistroFitosanitario.id == registro_id)
        .values(**valores)
        .execution_options(synchronize_session=False)
    )


async def cargar_registro_con_orden_bloqueada(
    db: AsyncSession, registro_id: str
) -> RegistroFitosanitario | None:
    """Registro con todo lo que Eliminar/Reactivar necesitan de su orden. Si
    viene de una orden, primero la bloquea (FOR UPDATE, igual que
    confirmar/deshacer) y recién después carga las filas, así un doble toque o
    una confirmación concurrente no devuelve stock dos veces ni trabaja sobre
    estados viejos. None si el registro no existe (o otro request lo borró).

    The pre-lock read selects plain columns on purpose: no ORM instance enters
    the identity map before the lock, so the real load below sees fresh rows."""
    previo = (
        await db.execute(
            select(RegistroFitosanitario.id, RegistroFitosanitario.orden_id).where(
                RegistroFitosanitario.id == registro_id
            )
        )
    ).first()
    if previo is None:
        return None
    if previo.orden_id is not None:
        await bloquear_orden(db, previo.orden_id)
        await _vincular_registro_legacy(db, registro_id)
    result = await db.execute(
        select(RegistroFitosanitario)
        .options(*_REGISTRO_CON_ORDEN_OPTS)
        .where(RegistroFitosanitario.id == registro_id)
    )
    return result.scalar_one_or_none()


async def _quitar_parcela_vacia_u_orden(
    db: AsyncSession, orden: OrdenAplicacion
) -> bool:
    """Tras sacar algo de la orden: si no le quedan parcelas la borra (devuelve
    True); si no, recalcula su estado."""
    # `lineas` too: deleting the order cascades to them and async can't lazy-load.
    await db.refresh(orden, attribute_names=["parcelas", "lineas"])
    if not orden.parcelas:
        await db.delete(orden)
        await db.flush()
        return True
    await recalcular_estado_orden(db, orden)
    return False


async def reactivar_registro(db: AsyncSession, fito: RegistroFitosanitario) -> str:
    """La aplicación (todos los productos de su válvula, o de su parcela
    entera) vuelve a pendiente en su orden. Requiere `fito` cargado con
    `cargar_registro_con_orden_bloqueada` y que venga de una orden. Devuelve el
    id de la orden."""
    # Valve first: valve registros also carry orden_parcela_id.
    fila = fito.orden_valvula
    if fila is not None:
        orden_id = fila.orden_parcela.orden_id
        orden = await db.get(OrdenAplicacion, orden_id)
        await deshacer_fila_valvula(db, fila, orden)
        return orden_id

    item = fito.orden_parcela
    orden_id = item.orden_id
    registros = await registros_de_fila(db, item=item)
    await _borrar_registros(db, registros, item=item)
    item.estado = EstadoOrdenAplicacionParcela.pendiente
    await db.flush()
    orden = await db.get(OrdenAplicacion, orden_id)
    await recalcular_estado_orden(db, orden)
    return orden_id


@dataclass(frozen=True)
class RegistroEliminado:
    """Qué se sacó de la orden al eliminar un registro (para la auditoría)."""

    orden_id: str | None = None
    orden_valvula_quitada: str | None = None
    orden_parcela_quitada: str | None = None
    orden_eliminada: bool = False
    registros_eliminados: int = 0


async def eliminar_registro(db: AsyncSession, fito: RegistroFitosanitario) -> RegistroEliminado:
    """Saca la aplicación del sistema: devuelve el stock, borra el registro
    (y sus hermanos de la misma válvula o parcela entera) y sus fotos y, si
    vino de una orden, también la saca de la orden. Requiere `fito` cargado
    con `cargar_registro_con_orden_bloqueada`."""
    # Valve first: valve registros also carry orden_parcela_id.
    fila = fito.orden_valvula
    if fila is not None:
        return await _eliminar_registro_de_valvula(db, fila)

    item = fito.orden_parcela
    if item is None:
        # Manual registro (not from an order): only itself.
        borrados = await _borrar_registros(db, [fito])
        return RegistroEliminado(registros_eliminados=borrados)

    orden_id = item.orden_id
    item_id = item.id
    registros = await registros_de_fila(db, item=item)
    borrados = await _borrar_registros(db, registros, item=item)
    orden = await db.get(OrdenAplicacion, orden_id)
    await db.delete(item)
    await db.flush()
    orden_eliminada = await _quitar_parcela_vacia_u_orden(db, orden)
    return RegistroEliminado(
        orden_id=orden_id,
        orden_parcela_quitada=item_id,
        orden_eliminada=orden_eliminada,
        registros_eliminados=borrados,
    )


async def _eliminar_registro_de_valvula(
    db: AsyncSession, fila: OrdenAplicacionValvula
) -> RegistroEliminado:
    item = fila.orden_parcela
    orden_id = item.orden_id
    fila_id = fila.id
    registros = await registros_de_fila(db, fila_valvula=fila)
    borrados = await _borrar_registros(db, registros, fila_valvula=fila)
    await db.delete(fila)
    await db.flush()

    # The parcel is resolved by what is left of it: no valves -> it leaves the
    # order; every remaining valve applied -> aplicada; otherwise pendiente.
    await db.refresh(item, attribute_names=["valvulas"])
    item_quitado: str | None = None
    if not item.valvulas:
        item_quitado = item.id
        await db.delete(item)
    elif all(v.estado == EstadoOrdenAplicacionParcela.aplicada for v in item.valvulas):
        item.estado = EstadoOrdenAplicacionParcela.aplicada
    else:
        item.estado = EstadoOrdenAplicacionParcela.pendiente
    await db.flush()

    orden = await db.get(OrdenAplicacion, orden_id)
    orden_eliminada = await _quitar_parcela_vacia_u_orden(db, orden)
    return RegistroEliminado(
        orden_id=orden_id,
        orden_valvula_quitada=fila_id,
        orden_parcela_quitada=item_quitado,
        orden_eliminada=orden_eliminada,
        registros_eliminados=borrados,
    )
