from dataclasses import dataclass
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool
from starlette.responses import Response

from app.api.deps import get_db, require_any_role, require_encargado_up
from app.core.cloudinary_client import upload_foto_parcela, upload_informe_analisis
from app.core.pdf_carta import generar_pdf_carta
from app.models.parcela import Parcela
from app.models.produccion import (
    CicloCampana,
    RegistroCosecha,
    RegistroFitosanitario,
    RegistroRiego,
    RegistroTrabajo,
)
from app.models.trazabilidad import AnalisisCalidad, EstadoSanitarioAnalisis, Foto, OrigenAnalisis
from app.models.user import User
from app.schemas.trazabilidad import (
    AnalisisCalidadCreate,
    AnalisisCalidadResponse,
    ComplianceFitosanitario,
    FotoCreate,
    FotoResponse,
    HistorialParcelaResponse,
)

router = APIRouter(prefix="/trazabilidad", tags=["Trazabilidad"])


# ── Aggregador ──────────────────────────────────────────────────────────────

@dataclass
class HistorialData:
    """Resultado crudo (objetos ORM) de _fetch_historial -- compartido entre
    el endpoint JSON y el de PDF, para no duplicar las 7 queries + el calculo
    de cumplimiento en dos lugares."""

    parcela: Parcela
    riegos: list[RegistroRiego]
    fitosanitarios: list[RegistroFitosanitario]
    trabajos: list[RegistroTrabajo]
    cosechas: list[RegistroCosecha]
    ciclos_campana: list[CicloCampana]
    fotos: list[Foto]
    analisis_calidad: list[AnalisisCalidad]
    compliance_fitosanitarios: list[ComplianceFitosanitario]


async def _get_parcela_or_404(db: AsyncSession, parcela_id: str) -> Parcela:
    parcela = (await db.execute(
        select(Parcela).where(Parcela.id == parcela_id)
    )).scalar_one_or_none()
    if parcela is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parcela not found")
    return parcela

async def _calcular_compliance(
    db: AsyncSession, parcela_id: str, fitosanitarios: list[RegistroFitosanitario],
) -> list[ComplianceFitosanitario]:
    """Para cada aplicacion fitosanitaria, compara su fecha_habilitacion_cosecha
    contra las cosechas reales de la parcela (sin acotar por el rango
    consultado -- una cosecha posterior igual define si la aplicacion se
    cumplio). A diferencia de /produccion/fitosanitarios/alertas/carencia
    (que solo compara contra la fecha de hoy), esto evalua el resultado real.
    """
    resultado: list[ComplianceFitosanitario] = []
    for fito in fitosanitarios:
        cosechas = (await db.execute(
            select(RegistroCosecha)
            .where(
                RegistroCosecha.parcela_id == parcela_id,
                RegistroCosecha.fecha >= fito.fecha,
            )
            .order_by(RegistroCosecha.fecha)
        )).scalars().all()

        conflictivas = [c for c in cosechas if c.fecha < fito.fecha_habilitacion_cosecha]
        if conflictivas:
            estado = "incumplido"
            conflictiva = conflictivas[0]
            conflictiva_id, conflictiva_fecha = conflictiva.id, conflictiva.fecha
        elif cosechas:
            estado = "cumplido"
            conflictiva_id, conflictiva_fecha = None, None
        else:
            estado = "pendiente"
            conflictiva_id, conflictiva_fecha = None, None

        resultado.append(ComplianceFitosanitario(
            fitosanitario_id=fito.id,
            fecha_aplicacion=fito.fecha,
            producto_nombre=fito.producto_nombre,
            fecha_habilitacion_cosecha=fito.fecha_habilitacion_cosecha,
            estado=estado,
            cosecha_conflictiva_id=conflictiva_id,
            cosecha_conflictiva_fecha=conflictiva_fecha,
        ))
    return resultado


async def _fetch_historial(
    db: AsyncSession, parcela: Parcela, desde: date, hasta: date,
) -> HistorialData:
    parcela_id = parcela.id

    # Consultas directas al ORM, sin limit -- los endpoints de lista de
    # /produccion truncan en 100 (max 1000) filas incluso filtrados por
    # parcela, no sirven para traer el historial completo de una campaña.
    # Excluye riegos en curso (fin IS NULL) -- mismo criterio que GET
    # /produccion/riego/, duracion_horas/litros_aplicados no tienen sentido
    # todavia para un registro sin terminar.
    riegos = (await db.execute(
        select(RegistroRiego)
        .where(
            RegistroRiego.parcela_id == parcela_id,
            RegistroRiego.fecha.between(desde, hasta),
            RegistroRiego.fin.is_not(None),
        )
        .order_by(RegistroRiego.fecha)
    )).scalars().all()

    fitosanitarios = (await db.execute(
        select(RegistroFitosanitario)
        .where(
            RegistroFitosanitario.parcela_id == parcela_id,
            RegistroFitosanitario.fecha.between(desde, hasta),
        )
        .order_by(RegistroFitosanitario.fecha)
    )).scalars().all()

    trabajos = (await db.execute(
        select(RegistroTrabajo)
        .where(RegistroTrabajo.parcela_id == parcela_id, RegistroTrabajo.fecha.between(desde, hasta))
        .order_by(RegistroTrabajo.fecha)
    )).scalars().all()

    cosechas = (await db.execute(
        select(RegistroCosecha)
        .where(RegistroCosecha.parcela_id == parcela_id, RegistroCosecha.fecha.between(desde, hasta))
        .order_by(RegistroCosecha.fecha)
    )).scalars().all()

    ciclos = (await db.execute(
        select(CicloCampana)
        .where(CicloCampana.parcela_id == parcela_id, CicloCampana.fecha_estado.between(desde, hasta))
        .order_by(CicloCampana.fecha_estado)
    )).scalars().all()

    fotos = (await db.execute(
        select(Foto)
        .where(Foto.parcela_id == parcela_id, Foto.fecha.between(desde, hasta))
        .order_by(Foto.fecha)
    )).scalars().all()

    analisis = (await db.execute(
        select(AnalisisCalidad)
        .where(AnalisisCalidad.parcela_id == parcela_id, AnalisisCalidad.fecha.between(desde, hasta))
        .order_by(AnalisisCalidad.fecha)
    )).scalars().all()

    compliance = await _calcular_compliance(db, parcela_id, list(fitosanitarios))

    return HistorialData(
        parcela=parcela,
        riegos=list(riegos),
        fitosanitarios=list(fitosanitarios),
        trabajos=list(trabajos),
        cosechas=list(cosechas),
        ciclos_campana=list(ciclos),
        fotos=list(fotos),
        analisis_calidad=list(analisis),
        compliance_fitosanitarios=compliance,
    )


@router.get("/parcela/{parcela_id}/historial", response_model=HistorialParcelaResponse)
async def historial_parcela(
    parcela_id: str,
    desde: date = Query(...),
    hasta: date = Query(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any_role),
) -> HistorialParcelaResponse:
    parcela = await _get_parcela_or_404(db, parcela_id)
    data = await _fetch_historial(db, parcela, desde, hasta)
    return HistorialParcelaResponse(
        parcela_id=data.parcela.id,
        parcela_nombre=data.parcela.nombre,
        desde=desde,
        hasta=hasta,
        riegos=data.riegos,
        fitosanitarios=data.fitosanitarios,
        trabajos=data.trabajos,
        cosechas=data.cosechas,
        ciclos_campana=data.ciclos_campana,
        fotos=data.fotos,
        analisis_calidad=data.analisis_calidad,
        compliance_fitosanitarios=data.compliance_fitosanitarios,
    )


@router.get("/parcela/{parcela_id}/carta-pdf")
async def carta_pdf_parcela(
    parcela_id: str,
    desde: date = Query(...),
    hasta: date = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_any_role),
) -> Response:
    parcela = await _get_parcela_or_404(db, parcela_id)
    data = await _fetch_historial(db, parcela, desde, hasta)

    # xhtml2pdf/reportlab son sincronicos y CPU-bound -- correrlos inline
    # bloquearia el event loop async para todas las demas requests mientras
    # se genera el PDF. Mismo cuidado que el proyecto ya tiene con Cloudinary
    # (httpx async en vez del SDK sincronico).
    pdf_bytes = await run_in_threadpool(
        generar_pdf_carta,
        parcela=data.parcela,
        riegos=data.riegos,
        fitosanitarios=data.fitosanitarios,
        trabajos=data.trabajos,
        cosechas=data.cosechas,
        fotos=data.fotos,
        analisis=data.analisis_calidad,
        compliance=data.compliance_fitosanitarios,
        desde=desde,
        hasta=hasta,
        generado_por=current_user.full_name,
    )

    filename = f"trazabilidad-{data.parcela.nombre}-{desde}_{hasta}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Fotos ───────────────────────────────────────────────────────────────────

@router.post("/fotos/", response_model=FotoResponse, status_code=status.HTTP_201_CREATED)
async def create_foto(
    parcela_id: str = Form(...),
    fecha: date = Form(...),
    categoria: str = Form(...),
    descripcion: str | None = Form(None),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_up),
) -> Foto:
    data = FotoCreate(
        parcela_id=parcela_id, fecha=fecha, categoria=categoria, descripcion=descripcion,
    )
    raw = await file.read()
    secure_url = await upload_foto_parcela(raw, file.content_type or "", data.parcela_id)

    foto = Foto(**data.model_dump(), url=secure_url, created_by=current_user.id)
    db.add(foto)
    await db.flush()
    await db.refresh(foto)
    return foto


@router.get("/fotos/", response_model=list[FotoResponse])
async def list_fotos(
    parcela_id: str | None = Query(None),
    desde: date | None = Query(None),
    hasta: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any_role),
) -> list[Foto]:
    stmt = select(Foto)
    if parcela_id is not None:
        stmt = stmt.where(Foto.parcela_id == parcela_id)
    if desde is not None:
        stmt = stmt.where(Foto.fecha >= desde)
    if hasta is not None:
        stmt = stmt.where(Foto.fecha <= hasta)
    stmt = stmt.order_by(Foto.fecha.desc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.delete("/fotos/{foto_id}", response_model=FotoResponse)
async def delete_foto(
    foto_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> Foto:
    foto = (await db.execute(select(Foto).where(Foto.id == foto_id))).scalar_one_or_none()
    if foto is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Foto not found")
    await db.delete(foto)
    await db.flush()
    return foto


# ── Analisis de Calidad ───────────────────────────────────────────────────────

@router.post("/analisis/", response_model=AnalisisCalidadResponse, status_code=status.HTTP_201_CREATED)
async def create_analisis(
    parcela_id: str = Form(...),
    fecha: date = Form(...),
    origen: OrigenAnalisis = Form(...),
    brix: float | None = Form(None),
    acidez: float | None = Form(None),
    ph: float | None = Form(None),
    estado_sanitario: EstadoSanitarioAnalisis | None = Form(None),
    laboratorio_nombre: str | None = Form(None),
    observaciones: str | None = Form(None),
    file: UploadFile | None = File(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_encargado_up),
) -> AnalisisCalidad:
    data = AnalisisCalidadCreate(
        parcela_id=parcela_id, fecha=fecha, origen=origen, brix=brix, acidez=acidez, ph=ph,
        estado_sanitario=estado_sanitario, laboratorio_nombre=laboratorio_nombre,
        observaciones=observaciones,
    )
    analisis = AnalisisCalidad(**data.model_dump(), created_by=current_user.id)
    db.add(analisis)
    # flush sin commit para obtener el id -- el informe se sube a Cloudinary
    # con public_id = analisis.id, no existe todavia antes de este punto.
    await db.flush()

    if file is not None:
        raw = await file.read()
        analisis.informe_url = await upload_informe_analisis(
            raw, file.content_type or "", analisis.id,
        )
        await db.flush()

    await db.refresh(analisis)
    return analisis


@router.get("/analisis/", response_model=list[AnalisisCalidadResponse])
async def list_analisis(
    parcela_id: str | None = Query(None),
    desde: date | None = Query(None),
    hasta: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_any_role),
) -> list[AnalisisCalidad]:
    stmt = select(AnalisisCalidad)
    if parcela_id is not None:
        stmt = stmt.where(AnalisisCalidad.parcela_id == parcela_id)
    if desde is not None:
        stmt = stmt.where(AnalisisCalidad.fecha >= desde)
    if hasta is not None:
        stmt = stmt.where(AnalisisCalidad.fecha <= hasta)
    stmt = stmt.order_by(AnalisisCalidad.fecha.desc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.delete("/analisis/{analisis_id}", response_model=AnalisisCalidadResponse)
async def delete_analisis(
    analisis_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_encargado_up),
) -> AnalisisCalidad:
    analisis = (await db.execute(
        select(AnalisisCalidad).where(AnalisisCalidad.id == analisis_id)
    )).scalar_one_or_none()
    if analisis is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analisis not found")
    await db.delete(analisis)
    await db.flush()
    return analisis
