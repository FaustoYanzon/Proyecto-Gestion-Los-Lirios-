from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_gerencial_up
from app.models.finanzas import Egreso, MonedaTipo, OrigenPago
from app.models.user import User
from app.models.whatsapp import EstadoMensajeWhatsapp, MensajeWhatsappPendiente
from app.schemas.finanzas import EgresoResponse
from app.schemas.whatsapp import ClasificarEgresoWhatsappRequest, MensajeWhatsappResponse

router = APIRouter(prefix="/finanzas/whatsapp", tags=["Finanzas - WhatsApp"])


@router.get("/pendientes", response_model=list[MensajeWhatsappResponse])
async def list_pendientes_whatsapp(
    estado: EstadoMensajeWhatsapp = Query(EstadoMensajeWhatsapp.pendiente),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> list[MensajeWhatsappPendiente]:
    stmt = (
        select(MensajeWhatsappPendiente)
        .where(MensajeWhatsappPendiente.estado == estado)
        .order_by(MensajeWhatsappPendiente.recibido_at.desc())
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def _get_mensaje_pendiente(db: AsyncSession, mensaje_id: str) -> MensajeWhatsappPendiente:
    result = await db.execute(
        select(MensajeWhatsappPendiente).where(MensajeWhatsappPendiente.id == mensaje_id)
    )
    mensaje = result.scalar_one_or_none()
    if mensaje is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mensaje not found")
    if mensaje.estado != EstadoMensajeWhatsapp.pendiente:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Mensaje ya fue clasificado o descartado"
        )
    return mensaje


@router.post(
    "/{mensaje_id}/clasificar-egreso", response_model=EgresoResponse, status_code=status.HTTP_201_CREATED
)
async def clasificar_mensaje_egreso(
    mensaje_id: str,
    data: ClasificarEgresoWhatsappRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = Depends(require_gerencial_up),
) -> Egreso:
    mensaje = await _get_mensaje_pendiente(db, mensaje_id)

    egreso = Egreso(
        fecha=mensaje.recibido_at.date(),
        tipo=data.tipo,
        clasificacion=data.clasificacion,
        descripcion=data.descripcion or mensaje.descripcion,
        monto=mensaje.monto,
        moneda=MonedaTipo.ars,
        origen=OrigenPago.no_oficial,
        finca=data.finca,
        forma_pago=data.forma_pago,
        parcela_id=data.parcela_id,
        fuente="whatsapp",
        created_by=current_user.id,
    )
    db.add(egreso)
    await db.flush()
    await db.refresh(egreso)

    mensaje.estado = EstadoMensajeWhatsapp.clasificado
    mensaje.egreso_id = egreso.id
    mensaje.clasificado_por = current_user.id
    mensaje.clasificado_at = datetime.now(timezone.utc)
    await db.flush()

    return egreso


@router.post("/{mensaje_id}/descartar", status_code=status.HTTP_204_NO_CONTENT)
async def descartar_mensaje_whatsapp(
    mensaje_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = Depends(require_gerencial_up),
) -> None:
    result = await db.execute(
        select(MensajeWhatsappPendiente).where(MensajeWhatsappPendiente.id == mensaje_id)
    )
    mensaje = result.scalar_one_or_none()
    if mensaje is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mensaje not found")
    if mensaje.estado != EstadoMensajeWhatsapp.pendiente:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Mensaje ya fue clasificado o descartado"
        )
    mensaje.estado = EstadoMensajeWhatsapp.descartado
    mensaje.clasificado_por = current_user.id
    mensaje.clasificado_at = datetime.now(timezone.utc)
    await db.flush()


@router.post("/{mensaje_id}/restaurar", response_model=MensajeWhatsappResponse)
async def restaurar_mensaje_whatsapp(
    mensaje_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> MensajeWhatsappPendiente:
    result = await db.execute(
        select(MensajeWhatsappPendiente).where(MensajeWhatsappPendiente.id == mensaje_id)
    )
    mensaje = result.scalar_one_or_none()
    if mensaje is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mensaje not found")
    if mensaje.estado != EstadoMensajeWhatsapp.descartado:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mensaje no está descartado")
    mensaje.estado = EstadoMensajeWhatsapp.pendiente
    mensaje.clasificado_por = None
    mensaje.clasificado_at = None
    await db.flush()
    await db.refresh(mensaje)
    return mensaje


@router.delete("/{mensaje_id}", status_code=status.HTTP_204_NO_CONTENT)
async def eliminar_mensaje_whatsapp(
    mensaje_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_gerencial_up),
) -> None:
    result = await db.execute(
        select(MensajeWhatsappPendiente).where(MensajeWhatsappPendiente.id == mensaje_id)
    )
    mensaje = result.scalar_one_or_none()
    if mensaje is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mensaje not found")
    if mensaje.estado != EstadoMensajeWhatsapp.descartado:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Solo se pueden borrar mensajes descartados"
        )
    await db.delete(mensaje)
    await db.flush()
