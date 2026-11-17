"""Alfalfa inventory: derived stock plus alta/salida documents.

Business rules live in `app.services.alfalfa`; this router only translates
HTTP. It never commits: `get_db` does.
"""
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_encargado_estricto
from app.core.pdf_alfalfa import DatosAlfalfaPdf, generar_pdf_alfalfa
from app.models.alfalfa import DocumentoAlfalfa, ProductoAlfalfa, TipoDocumentoAlfalfa
from app.models.alta_produccion import Comprador
from app.models.parcela import Parcela
from app.models.user import User
from app.schemas.alfalfa import (
    DocumentoAlfalfaCreate,
    DocumentoAlfalfaOut,
    StockProductoOut,
)
from app.services.alfalfa import crear_documento, stock_alfalfa

router = APIRouter(prefix="/alfalfa", tags=["Alfalfa"])

# Spanish PDF labels; fardo/rollo are counted in units, semilla in kg.
_PRODUCTO_PDF_LABEL = {
    ProductoAlfalfa.fardo: "Fardo (unidades)",
    ProductoAlfalfa.rollo: "Rollo (unidades)",
    ProductoAlfalfa.semilla: "Semilla (kg)",
}


@router.get("/stock", response_model=list[StockProductoOut])
async def get_stock(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_estricto),
) -> list[StockProductoOut]:
    return [StockProductoOut.model_validate(s) for s in await stock_alfalfa(db)]


@router.get("/documentos", response_model=list[DocumentoAlfalfaOut])
async def list_documentos(
    tipo: TipoDocumentoAlfalfa | None = Query(None),
    fecha_desde: date | None = Query(None),
    fecha_hasta: date | None = Query(None),
    potrero_id: str | None = Query(None),
    comprador_id: str | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_estricto),
) -> list[DocumentoAlfalfaOut]:
    stmt = (
        select(DocumentoAlfalfa)
        .options(selectinload(DocumentoAlfalfa.lineas))
        .order_by(DocumentoAlfalfa.fecha.desc(), DocumentoAlfalfa.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    if tipo is not None:
        stmt = stmt.where(DocumentoAlfalfa.tipo == tipo)
    if fecha_desde is not None:
        stmt = stmt.where(DocumentoAlfalfa.fecha >= fecha_desde)
    if fecha_hasta is not None:
        stmt = stmt.where(DocumentoAlfalfa.fecha <= fecha_hasta)
    if potrero_id is not None:
        stmt = stmt.where(DocumentoAlfalfa.potrero_id == potrero_id)
    if comprador_id is not None:
        stmt = stmt.where(DocumentoAlfalfa.comprador_id == comprador_id)
    documentos = (await db.execute(stmt)).scalars().all()
    return [DocumentoAlfalfaOut.model_validate(d) for d in documentos]


@router.post(
    "/documentos",
    response_model=DocumentoAlfalfaOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_documento(
    data: DocumentoAlfalfaCreate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_estricto),
) -> DocumentoAlfalfaOut:
    try:
        documento, creado = await crear_documento(db, data, current_user.id)
    except ValidationError as exc:
        # Defensive: any schema violation raised below the request layer is
        # a client error, never a 500. HTTPException (404/409/422) passes through.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.errors(include_url=False, include_context=False, include_input=False),
        ) from exc
    if not creado:
        # Idempotent replay of an earlier request with the same key.
        response.status_code = status.HTTP_200_OK
    return DocumentoAlfalfaOut.model_validate(documento)


@router.get("/documentos/{documento_id}", response_model=DocumentoAlfalfaOut)
async def get_documento(
    documento_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_estricto),
) -> DocumentoAlfalfaOut:
    documento = (
        await db.execute(
            select(DocumentoAlfalfa)
            .options(selectinload(DocumentoAlfalfa.lineas))
            .where(DocumentoAlfalfa.id == documento_id)
        )
    ).scalars().first()
    if documento is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Documento not found")
    return DocumentoAlfalfaOut.model_validate(documento)


@router.get("/documentos/{documento_id}/pdf")
async def get_documento_pdf(
    documento_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_estricto),
) -> Response:
    documento = (
        await db.execute(
            select(DocumentoAlfalfa)
            .options(selectinload(DocumentoAlfalfa.lineas))
            .where(DocumentoAlfalfa.id == documento_id)
        )
    ).scalars().first()
    if documento is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Documento not found")

    # DocumentoAlfalfaOut is ids-only, so resolve the counterpart name here.
    if documento.tipo == TipoDocumentoAlfalfa.alta:
        titulo, label = "Alta de alfalfa", "Potrero"
        potrero = await db.get(Parcela, documento.potrero_id) if documento.potrero_id else None
        nombre = potrero.nombre if potrero else "—"
    else:
        titulo, label = "Entrega de alfalfa", "Comprador"
        comprador = await db.get(Comprador, documento.comprador_id) if documento.comprador_id else None
        nombre = comprador.nombre if comprador else "—"

    lineas = [(_PRODUCTO_PDF_LABEL[ln.producto], ln.cantidad, ln.kg) for ln in documento.lineas]
    pdf = generar_pdf_alfalfa(
        DatosAlfalfaPdf(
            titulo=titulo,
            numero=documento.numero,
            fecha=documento.fecha,
            contraparte_label=label,
            contraparte_nombre=nombre,
            vehiculo_patente=documento.vehiculo_patente,
            observaciones=documento.observaciones,
            lineas=lineas,
            kg_total=sum((ln.kg for ln in documento.lineas), Decimal("0")),
        )
    )
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="alfalfa-{documento.numero}.pdf"',
            "Cache-Control": "no-store",
        },
    )
