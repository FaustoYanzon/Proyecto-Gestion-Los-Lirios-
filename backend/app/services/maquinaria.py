"""Maquinaria: state machine of the repair orders, derived machine state,
payment -> Egreso bookkeeping and push notifications.

Everything that mutates an order goes through `transicionar` so the role check,
the preconditions, the timeline event and the push stay in one place. The
`TRANSICIONES` table is declarative so the role x transition matrix can be
generated in tests straight from it.
"""
from __future__ import annotations

import enum
import logging
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.push import lanzar_aviso, notificar_tokens
from app.models.finanzas import (
    ClasificacionEgreso,
    Egreso,
    FormaPago,
    MonedaTipo,
    OrigenPago,
    TipoEgreso,
)
from app.models.maquinaria import (
    EstadoOrdenMaquinaria as E,
    EstadoPresupuestoMaquinaria,
    EventoOrdenMaquinaria,
    GravedadFalla,
    Maquina,
    ORDEN_NUMERO_SEQ,
    OrdenMaquinaria,
    PagoMaquinaria,
    PresupuestoMaquinaria,
)
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)

# Max photos attached to an order (the "report" ones); the offline report syncs
# its photos after the order exists, so the limit is per order, not per request.
MAX_FOTOS_REPORTE = 2

# Source tag of the Egreso created when an order is paid.
FUENTE_EGRESO = "maquinaria"

ESTADOS_ABIERTOS: frozenset[E] = frozenset(e for e in E if e not in (E.cerrada, E.cancelada))
# The machine is physically at the workshop (or waiting there to be picked up).
ESTADOS_EN_TALLER: frozenset[E] = frozenset({E.enviada_taller, E.en_reparacion, E.lista_retirar})
# Orders that can still be cancelled (decision 7: up to "enviada al taller").
ESTADOS_CANCELABLES: tuple[E, ...] = (
    E.reportada,
    E.diagnosticada,
    E.presupuesto_pendiente,
    E.presupuesto_aprobado,
    E.enviada_taller,
)

ROLES_ENCARGADO_UP: frozenset[UserRole] = frozenset(
    {UserRole.encargado, UserRole.gerencial, UserRole.super_admin}
)
ROLES_GERENCIAL_UP: frozenset[UserRole] = frozenset({UserRole.gerencial, UserRole.super_admin})


def es_gerencial_up(usuario: User) -> bool:
    return usuario.role in ROLES_GERENCIAL_UP


# ── Derived machine state (assumption A1) ─────────────────────────────────────

class EstadoMaquina(str, enum.Enum):
    operativa = "operativa"  # green
    operativa_con_observaciones = "operativa_con_observaciones"  # yellow
    parada = "parada"  # red
    en_taller = "en_taller"  # blue


SEMAFORO: dict[EstadoMaquina, str] = {
    EstadoMaquina.operativa: "verde",
    EstadoMaquina.operativa_con_observaciones: "amarillo",
    EstadoMaquina.parada: "rojo",
    EstadoMaquina.en_taller: "azul",
}


def estado_maquina(ordenes: Iterable[tuple[E, GravedadFalla]]) -> EstadoMaquina:
    """Worst state among the open orders. `ordenes` = (estado, gravedad) pairs;
    closed/cancelled ones are ignored.

    Interpretation of A1: `pendiente_validacion` never makes a machine "parada"
    even if the failure was `parada`: the machine already came back and only
    waits for the encargado to validate.
    """
    abiertas = [(e, g) for e, g in ordenes if e in ESTADOS_ABIERTOS]
    if any(e in ESTADOS_EN_TALLER for e, _ in abiertas):
        return EstadoMaquina.en_taller
    if any(g == GravedadFalla.parada and e != E.pendiente_validacion for e, g in abiertas):
        return EstadoMaquina.parada
    if abiertas:
        return EstadoMaquina.operativa_con_observaciones
    return EstadoMaquina.operativa


def _fuera_de_servicio(estado: E, gravedad: GravedadFalla) -> bool:
    return estado_maquina([(estado, gravedad)]) in (EstadoMaquina.en_taller, EstadoMaquina.parada)


def _utc(dt: datetime) -> datetime:
    # SQLite (tests) returns naive datetimes; Postgres returns aware ones.
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def dias_fuera_servicio(
    creada_at: datetime,
    gravedad: GravedadFalla,
    eventos: Iterable[EventoOrdenMaquinaria],
    ahora: datetime | None = None,
) -> Decimal:
    """Days (1 decimal) one order kept its machine parada/en taller, walking the
    timeline. Overlapping orders of the same machine are summed, not merged."""
    ahora = _utc(ahora or datetime.now(timezone.utc))
    puntos: list[tuple[datetime, E]] = [(_utc(creada_at), E.reportada)]
    puntos += sorted(((_utc(ev.created_at), ev.estado_hasta) for ev in eventos
                      if ev.estado_desde is not None), key=lambda p: p[0])
    total = 0.0
    for (inicio, estado), (fin, _) in zip(puntos, puntos[1:] + [(ahora, E.cerrada)]):
        if _fuera_de_servicio(estado, gravedad):
            total += max((fin - inicio).total_seconds(), 0.0)
    return (Decimal(str(total)) / Decimal(86400)).quantize(Decimal("0.1"))


# ── State machine table ───────────────────────────────────────────────────────

class NivelRol(str, enum.Enum):
    encargado = "encargado"  # encargado, gerencial, super_admin
    gerencial = "gerencial"  # gerencial, super_admin


ROLES_POR_NIVEL: dict[NivelRol, frozenset[UserRole]] = {
    NivelRol.encargado: ROLES_ENCARGADO_UP,
    NivelRol.gerencial: ROLES_GERENCIAL_UP,
}


@dataclass(frozen=True)
class Transicion:
    desde: E
    hacia: E
    nivel: NivelRol
    # Key into PRECONDICIONES (None = no precondition).
    precondicion: str | None = None
    requiere_nota: bool = False

    @property
    def roles_permitidos(self) -> frozenset[UserRole]:
        return ROLES_POR_NIVEL[self.nivel]


TRANSICIONES: tuple[Transicion, ...] = (
    Transicion(E.reportada, E.diagnosticada, NivelRol.gerencial, "taller_definido"),
    Transicion(E.diagnosticada, E.presupuesto_pendiente, NivelRol.gerencial, "presupuesto_pendiente"),
    Transicion(E.presupuesto_pendiente, E.presupuesto_aprobado, NivelRol.gerencial, "presupuesto_aprobado"),
    Transicion(E.presupuesto_pendiente, E.diagnosticada, NivelRol.gerencial, "presupuesto_rechazado"),
    Transicion(E.presupuesto_aprobado, E.enviada_taller, NivelRol.gerencial),
    Transicion(E.enviada_taller, E.en_reparacion, NivelRol.gerencial),
    Transicion(E.en_reparacion, E.lista_retirar, NivelRol.gerencial),
    Transicion(E.lista_retirar, E.pendiente_validacion, NivelRol.gerencial, "pago_registrado"),
    Transicion(E.pendiente_validacion, E.cerrada, NivelRol.encargado),
    # Reopen (assumption A6): mandatory reason.
    Transicion(E.pendiente_validacion, E.en_reparacion, NivelRol.encargado, requiere_nota=True),
    *(
        Transicion(desde, E.cancelada, NivelRol.gerencial, requiere_nota=True)
        for desde in ESTADOS_CANCELABLES
    ),
)

TRANSICIONES_POR_PAR: dict[tuple[E, E], Transicion] = {(t.desde, t.hacia): t for t in TRANSICIONES}


def transiciones_desde(estado: E) -> list[Transicion]:
    return [t for t in TRANSICIONES if t.desde == estado]


# ── Preconditions ─────────────────────────────────────────────────────────────

Precondicion = Callable[[AsyncSession, OrdenMaquinaria], Awaitable[str | None]]


async def _count_presupuestos(
    db: AsyncSession, orden_id: str, estado: EstadoPresupuestoMaquinaria
) -> int:
    res = await db.execute(
        select(func.count(PresupuestoMaquinaria.id)).where(
            PresupuestoMaquinaria.orden_id == orden_id,
            PresupuestoMaquinaria.estado == estado,
        )
    )
    return res.scalar_one()


async def _pre_taller_definido(db: AsyncSession, orden: OrdenMaquinaria) -> str | None:
    if not (orden.taller or "").strip():
        return "Elegí el taller antes de diagnosticar la orden."
    return None


async def _pre_presupuesto_pendiente(db: AsyncSession, orden: OrdenMaquinaria) -> str | None:
    if await _count_presupuestos(db, orden.id, EstadoPresupuestoMaquinaria.pendiente) == 0:
        return "Cargá un presupuesto antes de pedir su aprobación."
    return None


async def _pre_presupuesto_aprobado(db: AsyncSession, orden: OrdenMaquinaria) -> str | None:
    if (
        await _count_presupuestos(db, orden.id, EstadoPresupuestoMaquinaria.pendiente) > 0
        or await _count_presupuestos(db, orden.id, EstadoPresupuestoMaquinaria.aprobado) == 0
    ):
        return "El presupuesto todavía no fue aprobado."
    return None


async def _pre_presupuesto_rechazado(db: AsyncSession, orden: OrdenMaquinaria) -> str | None:
    res = await db.execute(
        select(PresupuestoMaquinaria).where(PresupuestoMaquinaria.orden_id == orden.id)
    )
    presupuestos = res.scalars().all()
    estados = {p.estado for p in presupuestos}
    rechazados_con_motivo = [
        p for p in presupuestos
        if p.estado == EstadoPresupuestoMaquinaria.rechazado and (p.motivo_rechazo or "").strip()
    ]
    if (
        EstadoPresupuestoMaquinaria.pendiente in estados
        or EstadoPresupuestoMaquinaria.aprobado in estados
        or not rechazados_con_motivo
    ):
        return "El presupuesto todavía no fue rechazado con un motivo."
    return None


async def _pre_pago_registrado(db: AsyncSession, orden: OrdenMaquinaria) -> str | None:
    res = await db.execute(
        select(func.count(PagoMaquinaria.id)).where(PagoMaquinaria.orden_id == orden.id)
    )
    if res.scalar_one() == 0:
        return "Registrá el pago antes de pasar la orden a validación."
    return None


PRECONDICIONES: dict[str, Precondicion] = {
    "taller_definido": _pre_taller_definido,
    "presupuesto_pendiente": _pre_presupuesto_pendiente,
    "presupuesto_aprobado": _pre_presupuesto_aprobado,
    "presupuesto_rechazado": _pre_presupuesto_rechazado,
    "pago_registrado": _pre_pago_registrado,
}


# ── Push notifications (spec section 6) ───────────────────────────────────────

_TITULOS: dict[E, str] = {
    E.reportada: "Falla reportada",
    E.diagnosticada: "Orden diagnosticada",
    E.presupuesto_pendiente: "Presupuesto pendiente de aprobación",
    E.presupuesto_aprobado: "Presupuesto aprobado",
    E.enviada_taller: "Máquina enviada al taller",
    E.en_reparacion: "Máquina en reparación",
    E.lista_retirar: "Máquina lista para retirar",
    E.pendiente_validacion: "Validar recepción de la máquina",
    E.cerrada: "Orden cerrada",
    E.cancelada: "Orden cancelada",
}
# States that also notify gerencial/super_admin (they are the same people as finance).
_ESTADOS_AVISO_GERENCIA: frozenset[E] = frozenset(
    {E.reportada, E.presupuesto_pendiente, E.lista_retirar}
)


async def _destinatarios(
    db: AsyncSession, orden: OrdenMaquinaria, hacia: E, actor: User
) -> list[str]:
    ids: set[str] = set()
    if hacia in _ESTADOS_AVISO_GERENCIA:
        res = await db.execute(
            select(User.id).where(User.is_active.is_(True), User.role.in_(ROLES_GERENCIAL_UP))
        )
        ids.update(res.scalars().all())
    # The encargado of the order's finca hears about every state change.
    res = await db.execute(
        select(User.id).where(
            User.is_active.is_(True),
            User.role == UserRole.encargado,
            User.finca == orden.finca,
        )
    )
    ids.update(res.scalars().all())
    ids.discard(actor.id)
    return sorted(ids)


async def _notificar(
    db: AsyncSession, orden: OrdenMaquinaria, hacia: E, actor: User, nota: str | None
) -> None:
    # A failed notification must never break the operation that triggered it.
    try:
        destinatarios = await _destinatarios(db, orden, hacia, actor)
        if not destinatarios:
            return
        maquina = await db.get(Maquina, orden.maquina_id)
        nombre = f"{maquina.marca} {maquina.modelo}" if maquina else "Máquina"
        cuerpo = f"{nombre} · {orden.descripcion[:80]}"
        if nota and hacia in (E.cancelada, E.en_reparacion):
            cuerpo += f" ({nota[:80]})"
        lanzar_aviso(
            notificar_tokens(
                _TITULOS[hacia],
                cuerpo,
                user_ids=destinatarios,
                data={"tipo": "maquinaria_orden", "orden_id": orden.id, "estado": hacia.value},
            )
        )
    except Exception:
        logger.exception("Fallo al notificar la orden de maquinaria %s", orden.id)


# ── Operations ────────────────────────────────────────────────────────────────

def _registrar_evento(
    db: AsyncSession,
    orden: OrdenMaquinaria,
    desde: E | None,
    hasta: E,
    usuario: User,
    nota: str | None,
) -> EventoOrdenMaquinaria:
    evento = EventoOrdenMaquinaria(
        orden_id=orden.id,
        estado_desde=desde,
        estado_hasta=hasta,
        usuario_id=usuario.id,
        nota=nota,
    )
    db.add(evento)
    return evento


def puede_ver_finca(usuario: User, finca: object) -> bool:
    """Encargado sees only their own finca; gerencial/super_admin see all."""
    return es_gerencial_up(usuario) or usuario.finca == finca


async def lock_orden(db: AsyncSession, orden: OrdenMaquinaria) -> None:
    """Row-lock the order (SELECT ... FOR UPDATE; a no-op on SQLite) and reload its
    columns, so concurrent mutations serialize and see the latest `estado`.
    Relationships of `orden` are left unloaded: re-query them after mutating."""
    await db.execute(
        select(OrdenMaquinaria)
        .where(OrdenMaquinaria.id == orden.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


async def siguiente_numero_orden(db: AsyncSession) -> int:
    """Next global order number. Postgres: sequence (concurrency-safe, gaps on
    rollback are fine). Other dialects (SQLite tests): max+1."""
    if db.get_bind().dialect.name == "postgresql":
        return (await db.execute(select(ORDEN_NUMERO_SEQ.next_value()))).scalar_one()
    actual = (await db.execute(select(func.max(OrdenMaquinaria.numero)))).scalar_one()
    return (actual or 0) + 1


async def crear_orden(
    db: AsyncSession,
    maquina: Maquina,
    usuario: User,
    descripcion: str,
    gravedad: GravedadFalla,
    idempotency_key: str | None = None,
) -> OrdenMaquinaria:
    """Create an order in `reportada` plus its first timeline event and push."""
    if usuario.role not in ROLES_ENCARGADO_UP:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="No tenés permiso para reportar fallas."
        )
    if not puede_ver_finca(usuario, maquina.finca):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La máquina no pertenece a tu finca.",
        )
    orden = OrdenMaquinaria(
        numero=await siguiente_numero_orden(db),
        maquina_id=maquina.id,
        finca=maquina.finca,
        reportada_por=usuario.id,
        descripcion=descripcion,
        gravedad=gravedad,
        estado=E.reportada,
        idempotency_key=idempotency_key,
    )
    db.add(orden)
    await db.flush()
    _registrar_evento(db, orden, None, E.reportada, usuario, None)
    await db.flush()
    await _notificar(db, orden, E.reportada, usuario, None)
    return orden


async def transicionar(
    db: AsyncSession,
    orden: OrdenMaquinaria,
    a_estado: E,
    usuario: User,
    nota: str | None = None,
) -> OrdenMaquinaria:
    """Validate role / finca / preconditions, move the order, write the timeline
    event and fire the push. Raises HTTPException on any violation."""
    await lock_orden(db, orden)
    transicion = TRANSICIONES_POR_PAR.get((orden.estado, a_estado))
    if transicion is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"No se puede pasar de '{orden.estado.value}' a '{a_estado.value}'.",
        )
    if usuario.role not in transicion.roles_permitidos:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tu rol no puede realizar este cambio de estado.",
        )
    if not puede_ver_finca(usuario, orden.finca):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La orden no pertenece a tu finca.",
        )
    nota_limpia = (nota or "").strip() or None
    if transicion.requiere_nota and nota_limpia is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este cambio de estado requiere un motivo.",
        )
    if transicion.precondicion is not None:
        error = await PRECONDICIONES[transicion.precondicion](db, orden)
        if error is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=error)

    desde = orden.estado
    orden.estado = a_estado
    if a_estado == E.cancelada:
        # A pending budget cannot outlive its order.
        await db.execute(
            update(PresupuestoMaquinaria)
            .where(
                PresupuestoMaquinaria.orden_id == orden.id,
                PresupuestoMaquinaria.estado == EstadoPresupuestoMaquinaria.pendiente,
            )
            .values(
                estado=EstadoPresupuestoMaquinaria.rechazado,
                motivo_rechazo="Orden cancelada",
                resuelto_por=usuario.id,
                resuelto_at=datetime.now(timezone.utc),
            )
        )
    _registrar_evento(db, orden, desde, a_estado, usuario, nota_limpia)
    await db.flush()
    await _notificar(db, orden, a_estado, usuario, nota_limpia)
    return orden


async def registrar_presupuesto(
    db: AsyncSession,
    orden: OrdenMaquinaria,
    usuario: User,
    taller: str | None,
    monto: Decimal,
    detalle: str | None,
    adjunto_url: str | None,
) -> PresupuestoMaquinaria:
    """Load a budget (ARS) on a `diagnosticada` order and move it to
    `presupuesto_pendiente`. One pending budget at a time (assumption A4)."""
    if not es_gerencial_up(usuario):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Solo gerencia carga presupuestos."
        )
    await lock_orden(db, orden)
    if orden.estado != E.diagnosticada:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Solo se puede cargar un presupuesto en una orden diagnosticada.",
        )
    taller_final = (taller or orden.taller or "").strip()
    if not taller_final:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Indicá el taller del presupuesto."
        )
    presupuesto = PresupuestoMaquinaria(
        orden_id=orden.id,
        taller=taller_final,
        monto=monto,
        detalle=detalle,
        adjunto_url=adjunto_url,
        created_by=usuario.id,
    )
    try:
        async with db.begin_nested():
            db.add(presupuesto)
            await db.flush()
    except IntegrityError as exc:
        # uq_maquinaria_presupuesto_pendiente: one pending budget per order.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La orden ya tiene un presupuesto pendiente.",
        ) from exc
    await transicionar(db, orden, E.presupuesto_pendiente, usuario)
    return presupuesto


async def resolver_presupuesto(
    db: AsyncSession,
    orden: OrdenMaquinaria,
    presupuesto: PresupuestoMaquinaria,
    usuario: User,
    aprobar: bool,
    motivo: str | None,
) -> PresupuestoMaquinaria:
    """Approve (-> presupuesto_aprobado) or reject (-> back to diagnosticada)."""
    if not es_gerencial_up(usuario):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Solo gerencia resuelve presupuestos."
        )
    await lock_orden(db, orden)
    await db.refresh(presupuesto)
    if presupuesto.estado != EstadoPresupuestoMaquinaria.pendiente:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="El presupuesto ya fue resuelto."
        )
    motivo_limpio = (motivo or "").strip() or None
    if not aprobar and motivo_limpio is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Indicá el motivo del rechazo.",
        )
    presupuesto.estado = (
        EstadoPresupuestoMaquinaria.aprobado if aprobar else EstadoPresupuestoMaquinaria.rechazado
    )
    presupuesto.motivo_rechazo = None if aprobar else motivo_limpio
    presupuesto.resuelto_por = usuario.id
    presupuesto.resuelto_at = datetime.now(timezone.utc)
    await db.flush()
    if aprobar:
        orden.taller = presupuesto.taller
        await transicionar(db, orden, E.presupuesto_aprobado, usuario, motivo_limpio)
    else:
        await transicionar(db, orden, E.diagnosticada, usuario, f"Presupuesto rechazado: {motivo_limpio}")
    return presupuesto


async def registrar_pago(
    db: AsyncSession,
    orden: OrdenMaquinaria,
    usuario: User,
    monto_real: Decimal,
    fecha: date,
    factura_url: str | None,
    origen: OrigenPago = OrigenPago.no_oficial,
    forma_pago: FormaPago = FormaPago.transferencia,
) -> PagoMaquinaria:
    """Register the single payment of an order (only in `lista_retirar`) and
    create the linked Egreso (same pattern as trabajo_diario)."""
    if not es_gerencial_up(usuario):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Solo gerencia registra pagos."
        )
    await lock_orden(db, orden)
    if orden.estado != E.lista_retirar:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El pago se registra cuando la máquina está lista para retirar.",
        )
    existente = await db.execute(select(PagoMaquinaria).where(PagoMaquinaria.orden_id == orden.id))
    if existente.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="La orden ya tiene un pago registrado."
        )
    maquina = await db.get(Maquina, orden.maquina_id)
    pago = PagoMaquinaria(
        orden_id=orden.id,
        monto_real=monto_real,
        factura_url=factura_url,
        fecha=fecha,
        registrado_por=usuario.id,
    )
    try:
        async with db.begin_nested():
            db.add(pago)
            await db.flush()
    except IntegrityError as exc:
        # unique(orden_id): a concurrent request registered the payment first.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="La orden ya tiene un pago registrado."
        ) from exc

    partes = ["Reparación", f"{maquina.marca} {maquina.modelo}" if maquina else "máquina"]
    if orden.taller:
        partes.append(orden.taller)
    egreso = Egreso(
        fecha=fecha,
        tipo=TipoEgreso.repuestos_reparacion,
        clasificacion=ClasificacionEgreso.rep_repuestos_maquinaria,
        descripcion=" | ".join(partes)[:500],
        monto=monto_real,
        moneda=MonedaTipo.ars,
        origen=origen,
        finca=orden.finca,
        forma_pago=forma_pago,
        fuente=FUENTE_EGRESO,
        referencia_id=pago.id,
        created_by=usuario.id,
    )
    db.add(egreso)
    await db.flush()
    pago.egreso_id = egreso.id
    await db.flush()
    return pago


async def anular_pago(db: AsyncSession, orden: OrdenMaquinaria, usuario: User) -> None:
    """Delete the payment and its Egreso. Only while the order is still in
    `lista_retirar`; after that the payment is part of the closed history."""
    if not es_gerencial_up(usuario):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Solo gerencia anula pagos."
        )
    await lock_orden(db, orden)
    res = await db.execute(select(PagoMaquinaria).where(PagoMaquinaria.orden_id == orden.id))
    pago = res.scalar_one_or_none()
    if pago is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="La orden no tiene pago.")
    if orden.estado != E.lista_retirar:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El pago solo se puede anular mientras la máquina está lista para retirar.",
        )
    egreso_res = await db.execute(
        select(Egreso).where(Egreso.fuente == FUENTE_EGRESO, Egreso.referencia_id == pago.id)
    )
    egreso = egreso_res.scalar_one_or_none()
    # Drop the FK reference first so the Egreso delete is not blocked.
    pago.egreso_id = None
    await db.flush()
    if egreso is not None:
        await db.delete(egreso)
    await db.delete(pago)
    await db.flush()
