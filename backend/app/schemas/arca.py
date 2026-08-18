from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.arca import EstadoComprobanteArca, TipoArchivoArca
from app.models.finanzas import ClasificacionEgreso, DestinoIngreso, Finca, FormaPago, TipoEgreso


class ComprobanteArcaResponse(BaseModel):
    id: str
    lote_id: str
    tipo_archivo: TipoArchivoArca
    fecha_emision: date
    tipo_comprobante: int
    tipo_comprobante_desc: str
    es_nota_credito: bool
    punto_venta: int
    numero_desde: int
    numero_hasta: int
    cod_autorizacion: str | None
    cuit_contraparte: str
    denominacion_contraparte: str
    moneda: str
    tipo_cambio: Decimal
    total_iva: Decimal
    imp_total: Decimal
    estado: EstadoComprobanteArca
    egreso_id: str | None
    ingreso_id: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class LoteImportacionArcaResponse(BaseModel):
    id: str
    tipo_archivo: TipoArchivoArca
    nombre_archivo: str
    cantidad_filas: int
    cantidad_nuevas: int
    cantidad_duplicadas: int
    importado_por: str
    importado_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ImportarArcaResponse(BaseModel):
    lote: LoteImportacionArcaResponse
    nuevos: int
    duplicados: int
    errores: list[str]


class ClasificarEgresoRequest(BaseModel):
    tipo: TipoEgreso
    clasificacion: ClasificacionEgreso
    finca: Finca
    forma_pago: FormaPago
    parcela_id: str | None = None
    descripcion: str | None = None


class ClasificarIngresoRequest(BaseModel):
    destino: DestinoIngreso
    comprador: str | None = None
    finca: Finca
    forma_pago: FormaPago
    cuenta_destino: str | None = None
    descripcion: str | None = None


class ResumenIvaResponse(BaseModel):
    anio_desde: int
    mes_desde: int
    anio_hasta: int
    mes_hasta: int
    iva_compra: Decimal
    iva_venta: Decimal
    iva_saldo: Decimal
