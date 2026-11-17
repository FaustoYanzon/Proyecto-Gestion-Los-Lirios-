"""Alfalfa inventory service: numbering, derived stock and document creation.

Stock is never stored: it is the sum of alta lines minus the sum of salida
lines per product. Nothing here commits; `get_db` does.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException, status
from sqlalchemy import case, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.alfalfa import (
    DEPOSITO_ALFA,
    DocumentoAlfalfa,
    DocumentoAlfalfaLinea,
    ProductoAlfalfa,
    TipoDocumentoAlfalfa,
)
from app.models.alta_produccion import Comprador, Deposito
from app.models.parcela import Parcela, TipoParcela
from app.schemas.alfalfa import DocumentoAlfalfaCreate
from app.services.alta_produccion import Parametros, get_parametros

__all__ = [
    "DEPOSITO_ALFA",
    "PREFIJO_DOCUMENTO_ALFALFA",
    "StockProducto",
    "crear_documento",
    "get_deposito_alfa",
    "siguiente_numero",
    "stock_alfalfa",
]

PREFIJO_DOCUMENTO_ALFALFA: dict[TipoDocumentoAlfalfa, str] = {
    TipoDocumentoAlfalfa.alta: "ALF-ALT",
    TipoDocumentoAlfalfa.salida: "ALF-SAL",
}

CENTAVO = Decimal("0.01")
# Largest value a Numeric(14,2) column holds.
MAX_NUMERIC_14_2 = Decimal("999999999999.99")


@dataclass
class StockProducto:
    producto: ProductoAlfalfa
    unidades: Decimal
    kg: Decimal


def _422(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


async def get_deposito_alfa(db: AsyncSession, for_update: bool = False) -> Deposito:
    """Resolve the fictitious depot by name, creating it if missing (the
    migration seeds it; tests start from an empty schema). `for_update`
    serializes salidas: stock is derived, so there is no row of its own to lock."""
    query = select(Deposito).where(Deposito.nombre == DEPOSITO_ALFA).order_by(Deposito.created_at)
    if for_update:
        query = query.with_for_update()
    deposito = (await db.execute(query)).scalars().first()
    if deposito is None:
        deposito = Deposito(nombre=DEPOSITO_ALFA)
        db.add(deposito)
        await db.flush()
        await db.refresh(deposito)
    return deposito


async def siguiente_numero(db: AsyncSession, tipo: TipoDocumentoAlfalfa) -> str:
    # Same scheme as siguiente_numero_remito: two concurrent documents of the
    # same tipo would compute the same number, so Postgres serializes them per
    # tipo with a transaction-scoped advisory lock. SQLite (tests) needs none.
    if db.get_bind().dialect.name == "postgresql":
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:clave))"),
            {"clave": f"alfalfa_numero:{tipo.value}"},
        )
    cantidad = await db.scalar(
        select(func.count()).select_from(DocumentoAlfalfa).where(DocumentoAlfalfa.tipo == tipo)
    )
    secuencia = int(cantidad) + 1
    while True:
        numero = f"{PREFIJO_DOCUMENTO_ALFALFA[tipo]}-{secuencia:06d}"
        existe = await db.scalar(
            select(func.count())
            .select_from(DocumentoAlfalfa)
            .where(DocumentoAlfalfa.tipo == tipo, DocumentoAlfalfa.numero == numero)
        )
        if not existe:
            return numero
        secuencia += 1


async def stock_alfalfa(db: AsyncSession) -> list[StockProducto]:
    """Altas minus salidas per product; always the three products, in enum order."""
    signo = case((DocumentoAlfalfa.tipo == TipoDocumentoAlfalfa.salida, -1), else_=1)
    filas = (
        await db.execute(
            select(
                DocumentoAlfalfaLinea.producto,
                func.coalesce(func.sum(DocumentoAlfalfaLinea.cantidad * signo), 0),
                func.coalesce(func.sum(DocumentoAlfalfaLinea.kg * signo), 0),
            )
            .join(DocumentoAlfalfa, DocumentoAlfalfa.id == DocumentoAlfalfaLinea.documento_id)
            .group_by(DocumentoAlfalfaLinea.producto)
        )
    ).all()
    # str() first: SQLite returns floats for Numeric arithmetic.
    saldos = {
        producto: (_cuantizar(Decimal(str(unidades))), _cuantizar(Decimal(str(kg))))
        for producto, unidades, kg in filas
    }
    resultado: list[StockProducto] = []
    for producto in ProductoAlfalfa:
        unidades, kg = saldos.get(producto, (Decimal("0.00"), Decimal("0.00")))
        resultado.append(StockProducto(producto=producto, unidades=unidades, kg=kg))
    return resultado


def _cuantizar(valor: Decimal) -> Decimal:
    return valor.quantize(CENTAVO, rounding=ROUND_HALF_UP)


def _kg_linea(producto: ProductoAlfalfa, cantidad: Decimal, parametros: Parametros) -> Decimal:
    if producto == ProductoAlfalfa.fardo:
        kg = cantidad * parametros.kg_fardo
    elif producto == ProductoAlfalfa.rollo:
        kg = cantidad * parametros.kg_rollo
    else:
        kg = cantidad  # semilla is already in kg
    kg = _cuantizar(kg)
    if kg > MAX_NUMERIC_14_2:
        raise _422(f"Los kg de {producto.value} exceden el máximo admitido")
    return kg


async def _buscar_por_key(db: AsyncSession, key: str) -> DocumentoAlfalfa | None:
    return (
        await db.execute(select(DocumentoAlfalfa).where(DocumentoAlfalfa.idempotency_key == key))
    ).scalars().first()


async def _validar_potrero(db: AsyncSession, potrero_id: str) -> None:
    potrero = await db.get(Parcela, potrero_id)
    if potrero is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Potrero not found")
    if potrero.tipo != TipoParcela.potrero:
        raise _422("La parcela de origen debe ser un potrero")
    if not potrero.is_active:
        raise _422("El potrero está inactivo")


async def _validar_comprador(db: AsyncSession, comprador_id: str) -> None:
    comprador = await db.get(Comprador, comprador_id)
    if comprador is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comprador not found")
    if not comprador.is_active:
        raise _422("El comprador está inactivo")


async def _validar_stock(db: AsyncSession, data: DocumentoAlfalfaCreate) -> None:
    disponible = {s.producto: s.unidades for s in await stock_alfalfa(db)}
    for linea in data.lineas:
        saldo = disponible[linea.producto]
        if linea.cantidad > saldo:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Stock insuficiente de {linea.producto.value}: "
                    f"disponible {saldo.normalize():f}, pedido {linea.cantidad.normalize():f}"
                ),
            )


async def crear_documento(
    db: AsyncSession, data: DocumentoAlfalfaCreate, user_id: str
) -> tuple[DocumentoAlfalfa, bool]:
    """Validate and create an alta or salida. Returns `(documento, creado)`;
    `creado` is False when an earlier document with the same idempotency_key
    exists, which is returned as-is regardless of the new payload."""
    if data.idempotency_key:
        existente = await _buscar_por_key(db, data.idempotency_key)
        if existente is not None:
            return existente, False

    if data.tipo == TipoDocumentoAlfalfa.alta:
        assert data.potrero_id is not None  # guaranteed by the schema
        await _validar_potrero(db, data.potrero_id)
        deposito = await get_deposito_alfa(db)
    else:
        assert data.comprador_id is not None  # guaranteed by the schema
        await _validar_comprador(db, data.comprador_id)
        # Lock first, then read stock: concurrent salidas cannot both pass.
        deposito = await get_deposito_alfa(db, for_update=True)
        await _validar_stock(db, data)

    parametros = await get_parametros(db)
    lineas = [
        DocumentoAlfalfaLinea(
            producto=linea.producto,
            cantidad=linea.cantidad,
            kg=_kg_linea(linea.producto, linea.cantidad, parametros),
        )
        for linea in data.lineas
    ]
    documento = DocumentoAlfalfa(
        tipo=data.tipo,
        numero=await siguiente_numero(db, data.tipo),
        fecha=data.fecha,
        potrero_id=data.potrero_id,
        comprador_id=data.comprador_id,
        deposito_id=deposito.id,
        vehiculo_patente=data.vehiculo_patente,
        observaciones=data.observaciones,
        idempotency_key=data.idempotency_key,
        created_by=user_id,
        lineas=lineas,
    )
    try:
        # SAVEPOINT: if a concurrent retry with the same key wins the race,
        # only this INSERT is discarded and the session stays usable.
        async with db.begin_nested():
            db.add(documento)
            await db.flush()
    except IntegrityError as exc:
        existente = await _buscar_por_key(db, data.idempotency_key) if data.idempotency_key else None
        if existente is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="No se pudo registrar el documento; reintentá",
            ) from exc
        return existente, False

    await db.refresh(documento, attribute_names=["lineas", "created_at"])
    return documento, True
