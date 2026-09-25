"""Aviso diario de cheques por Fecha de Pago -- ver app/core/scheduler.py
(quién lo llama automáticamente) y POST /notificaciones/cheques/ejecutar
(vía manual).

- Cheques/echeques recibidos (Ingreso) cuya Fecha de Pago ya llegó: "ya se
  pueden cobrar". Solo los que siguen en cartera (uso_cheque vacío) -- uno ya
  endosado a un tercero no lo cobra la finca.
- Cheques/echeques emitidos (Egreso) cuya Fecha de Pago ya llegó: "se
  debitan hoy".

Va a super_admin y gerencial. Idempotente vía aviso_pago_enviado_at: si el
proceso estuvo caído el día exacto, el aviso sale igual la próxima vez que
corra (f_pago <= hoy, no == hoy).
"""

import logging
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.birthdays import FINCA_TZ
from app.core.push import send_expo_push
from app.models.finanzas import Egreso, FormaPago, Ingreso, MonedaTipo
from app.models.push_token import PushToken
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)

_FORMAS_CHEQUE = (FormaPago.cheque, FormaPago.echeque)


def _formato_montos(items: list[Ingreso] | list[Egreso]) -> str:
    totales: dict[MonedaTipo, Decimal] = {}
    for item in items:
        totales[item.moneda] = totales.get(item.moneda, Decimal("0")) + item.monto
    partes = []
    for moneda in (MonedaTipo.ars, MonedaTipo.usd):
        if moneda in totales:
            numero = f"{totales[moneda]:,.0f}".replace(",", ".")
            partes.append(f"{'US$' if moneda == MonedaTipo.usd else '$'}{numero}")
    return " + ".join(partes)


def _cuerpo_recibidos(cheques: list[Ingreso]) -> str:
    n = len(cheques)
    compradores = sorted({c.comprador.strip() for c in cheques if c.comprador})
    detalle = ", ".join(compradores[:3]) + ("…" if len(compradores) > 3 else "")
    plural = "cheques ya se pueden" if n > 1 else "cheque ya se puede"
    return f"{n} {plural} cobrar: {_formato_montos(cheques)} ({detalle})."


def _cuerpo_emitidos(cheques: list[Egreso]) -> str:
    n = len(cheques)
    plural = "cheques emitidos se debitan" if n > 1 else "cheque emitido se debita"
    return f"{n} {plural} desde hoy: {_formato_montos(cheques)}."


async def check_and_notify_cheques(db: AsyncSession) -> dict[str, int]:
    hoy = datetime.now(FINCA_TZ).date()

    recibidos = list((await db.execute(
        select(Ingreso).where(
            Ingreso.forma_pago.in_(_FORMAS_CHEQUE),
            Ingreso.f_pago.is_not(None),
            Ingreso.f_pago <= hoy,
            Ingreso.aviso_pago_enviado_at.is_(None),
        )
    )).scalars().all())
    emitidos = list((await db.execute(
        select(Egreso).where(
            Egreso.forma_pago.in_(_FORMAS_CHEQUE),
            Egreso.f_pago.is_not(None),
            Egreso.f_pago <= hoy,
            Egreso.aviso_pago_enviado_at.is_(None),
        )
    )).scalars().all())

    en_cartera = [c for c in recibidos if not (c.uso_cheque or "").strip()]

    mensajes: list[tuple[str, str]] = []
    if en_cartera:
        mensajes.append(("Cheques para cobrar 💰", _cuerpo_recibidos(en_cartera)))
    if emitidos:
        mensajes.append(("Cheques emitidos 🏦", _cuerpo_emitidos(emitidos)))

    if mensajes:
        tokens = list((await db.execute(
            select(PushToken.token)
            .join(User, User.id == PushToken.user_id)
            .where(
                User.is_active.is_(True),
                or_(User.role == UserRole.super_admin, User.role == UserRole.gerencial),
            )
        )).scalars().all())
        if not tokens:
            # Sin nadie a quien avisar: no se marcan, así salen cuando haya
            # un celular registrado.
            logger.warning("Aviso de cheques: sin tokens de super_admin/gerencial")
            return {"recibidos": 0, "emitidos": 0}
        payload = [
            {"to": token, "title": titulo, "body": cuerpo, "sound": "default"}
            for token in tokens
            for titulo, cuerpo in mensajes
        ]
        status = await send_expo_push(payload)
        logger.info(
            "Aviso de cheques: %d recibidos, %d emitidos -> %d tokens (status %s)",
            len(en_cartera), len(emitidos), len(tokens), status,
        )

    ahora = datetime.now(timezone.utc)
    for item in [*recibidos, *emitidos]:
        item.aviso_pago_enviado_at = ahora
    await db.flush()
    return {"recibidos": len(en_cartera), "emitidos": len(emitidos)}
