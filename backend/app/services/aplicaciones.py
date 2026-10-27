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

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

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
    selectinload(RegistroFitosanitario.orden_valvula).selectinload(
        OrdenAplicacionValvula.registro_fitosanitario
    ),
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


async def _fotos_de_valvula(
    db: AsyncSession, fila: OrdenAplicacionValvula, registro_id: str | None
) -> list[FotoRegistroFitosanitario]:
    # Photos hang from the registro (completa) or only from the row (no_aplicada).
    condiciones = [FotoRegistroFitosanitario.orden_valvula_id == fila.id]
    if registro_id is not None:
        condiciones.append(FotoRegistroFitosanitario.registro_fitosanitario_id == registro_id)
    return list(
        (await db.execute(select(FotoRegistroFitosanitario).where(or_(*condiciones)))).scalars().all()
    )


async def _borrar_registro_de_valvula(
    db: AsyncSession, fila: OrdenAplicacionValvula
) -> str | None:
    """Devuelve el stock y borra el registro de la válvula (si lo tiene) y
    todas sus fotos. Requiere `fila.registro_fitosanitario` cargado."""
    registro = fila.registro_fitosanitario
    registro_id = registro.id if registro is not None else None
    fotos = await _fotos_de_valvula(db, fila, registro_id)

    if registro is not None:
        await revertir_movimiento_stock(db, registro)
        for foto in fotos:
            await db.delete(foto)
        # Unique FK from the row to the registro: detach it before deleting the registro.
        fila.registro_fitosanitario = None
        fila.registro_fitosanitario_id = None
        await db.flush()
        await db.delete(registro)
    else:
        for foto in fotos:
            await db.delete(foto)
    return registro_id


async def deshacer_fila_valvula(
    db: AsyncSession, fila: OrdenAplicacionValvula, orden: OrdenAplicacion
) -> str | None:
    """Revierte la confirmación de una válvula: devuelve el stock, borra el
    registro fitosanitario y sus fotos, y deja la fila (y la parcela/orden) en
    pendiente para poder confirmarla de nuevo. Devuelve el id del registro
    borrado (None si la válvula se había confirmado como no_aplicada).

    Requiere `fila.orden_parcela` y `fila.registro_fitosanitario` cargados, la
    orden bloqueada (`bloquear_orden`) y los chequeos de permiso/estado hechos.
    """
    item = fila.orden_parcela
    registro_id = await _borrar_registro_de_valvula(db, fila)

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
    await db.refresh(orden, attribute_names=["parcelas"])
    if not orden.parcelas:
        await db.delete(orden)
        await db.flush()
        return True
    await recalcular_estado_orden(db, orden)
    return False


async def reactivar_registro(db: AsyncSession, fito: RegistroFitosanitario) -> str:
    """La aplicación vuelve a pendiente en su orden. Requiere `fito` cargado con
    `cargar_registro_con_orden_bloqueada` y que venga de una orden. Devuelve el
    id de la orden."""
    fila = fito.orden_valvula
    if fila is not None:
        orden_id = fila.orden_parcela.orden_id
        orden = await db.get(OrdenAplicacion, orden_id)
        await deshacer_fila_valvula(db, fila, orden)
        return orden_id

    item = fito.orden_parcela
    orden_id = item.orden_id
    await revertir_movimiento_stock(db, fito)
    for foto in fito.fotos:
        await db.delete(foto)
    item.estado = EstadoOrdenAplicacionParcela.pendiente
    # Unique FK from the parcel row to the registro: detach before deleting it.
    item.registro_fitosanitario_id = None
    await db.flush()
    await db.delete(fito)
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


async def eliminar_registro(db: AsyncSession, fito: RegistroFitosanitario) -> RegistroEliminado:
    """Saca la aplicación del sistema: devuelve el stock, borra el registro y
    sus fotos y, si vino de una orden, también la saca de la orden. Requiere
    `fito` cargado con `cargar_registro_con_orden_bloqueada`."""
    fila = fito.orden_valvula
    if fila is not None:
        return await _eliminar_registro_de_valvula(db, fila)

    item = fito.orden_parcela
    await revertir_movimiento_stock(db, fito)
    for foto in fito.fotos:
        await db.delete(foto)
    if item is None:
        await db.delete(fito)
        await db.flush()
        return RegistroEliminado()

    orden_id = item.orden_id
    item_id = item.id
    item.registro_fitosanitario_id = None
    await db.flush()
    await db.delete(fito)
    await db.flush()
    orden = await db.get(OrdenAplicacion, orden_id)
    await db.delete(item)
    await db.flush()
    orden_eliminada = await _quitar_parcela_vacia_u_orden(db, orden)
    return RegistroEliminado(
        orden_id=orden_id, orden_parcela_quitada=item_id, orden_eliminada=orden_eliminada,
    )


async def _eliminar_registro_de_valvula(
    db: AsyncSession, fila: OrdenAplicacionValvula
) -> RegistroEliminado:
    item = fila.orden_parcela
    orden_id = item.orden_id
    fila_id = fila.id
    await _borrar_registro_de_valvula(db, fila)
    await db.flush()
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
    )
