"""Confirmación de órdenes de aplicación por válvula.

Spec: docs/superpowers/specs/2026-10-23-fito-confirmacion-por-valvula-design.md
"""
from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.finanzas import Finca
from app.models.produccion import (
    OrdenAplicacion,
    OrdenAplicacionParcela,
    OrdenAplicacionValvula,
    OrigenOrdenAplicacion,
)
from app.models.parcela import VariedadUva


async def test_orden_valvula_unica_por_parcela_de_orden(
    db_session, create_user, create_insumo, create_parcela, create_valvula,
):
    user = await create_user(email="ger@test.com")
    insumo = await create_insumo(nombre="Azufre")
    parcela = await create_parcela(nombre="Parral 2", variedad="flame", finca=Finca.media_agua)
    valvula = await create_valvula(parcela_id=parcela.id, nombre="21", superficie_ha=1.5)

    session = db_session
    orden = OrdenAplicacion(
        temporada=2026, origen=OrigenOrdenAplicacion.extra, variedad=VariedadUva.flame,
        insumo_id=insumo.id, dosis_por_ha=1.0, objetivo="Oidio", dias_carencia=7,
        dias_reingreso=2, fecha_planificada=date(2026, 10, 15), created_by=user.id,
    )
    item = OrdenAplicacionParcela(parcela_id=parcela.id)
    orden.parcelas.append(item)
    session.add(orden)
    await session.flush()
    session.add(OrdenAplicacionValvula(orden_parcela_id=item.id, valvula_id=valvula.id))
    session.add(OrdenAplicacionValvula(orden_parcela_id=item.id, valvula_id=valvula.id))
    with pytest.raises(IntegrityError):
        await session.flush()
