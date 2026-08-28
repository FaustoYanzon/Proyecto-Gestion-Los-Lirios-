import re

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_super_admin
from app.models.user import User
from app.models.whatsapp import TelefonoUsuarioWhatsapp
from app.schemas.telefonos_whatsapp import TelefonoUsuarioWhatsappCreate, TelefonoUsuarioWhatsappResponse

router = APIRouter(prefix="/admin/telefonos-whatsapp", tags=["Admin - Teléfonos WhatsApp"])

_SOLO_DIGITOS = re.compile(r"\D")


def _normalizar_telefono(telefono: str) -> str:
    return _SOLO_DIGITOS.sub("", telefono)


@router.get("/", response_model=list[TelefonoUsuarioWhatsappResponse])
async def list_telefonos_whatsapp(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_super_admin),
) -> list[TelefonoUsuarioWhatsapp]:
    result = await db.execute(
        select(TelefonoUsuarioWhatsapp).order_by(TelefonoUsuarioWhatsapp.created_at.desc())
    )
    return list(result.scalars().all())


@router.post("/", response_model=TelefonoUsuarioWhatsappResponse, status_code=status.HTTP_201_CREATED)
async def crear_telefono_whatsapp(
    data: TelefonoUsuarioWhatsappCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = Depends(require_super_admin),
) -> TelefonoUsuarioWhatsapp:
    telefono = _normalizar_telefono(data.telefono)
    if len(telefono) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Teléfono inválido")

    usuario_result = await db.execute(select(User).where(User.id == data.user_id))
    if usuario_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario not found")

    existente = await db.execute(
        select(TelefonoUsuarioWhatsapp).where(TelefonoUsuarioWhatsapp.telefono == telefono)
    )
    if existente.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Ese teléfono ya está vinculado a un usuario"
        )

    vinculo = TelefonoUsuarioWhatsapp(
        telefono=telefono, user_id=data.user_id, created_by=current_user.id
    )
    db.add(vinculo)
    await db.flush()
    await db.refresh(vinculo)
    return vinculo


@router.delete("/{telefono_id}", status_code=status.HTTP_204_NO_CONTENT)
async def eliminar_telefono_whatsapp(
    telefono_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_super_admin),
) -> None:
    result = await db.execute(
        select(TelefonoUsuarioWhatsapp).where(TelefonoUsuarioWhatsapp.id == telefono_id)
    )
    vinculo = result.scalar_one_or_none()
    if vinculo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vínculo not found")
    await db.delete(vinculo)
    await db.flush()
