from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PrivateAttr,
    ValidatorFunctionWrapHandler,
    field_serializer,
    field_validator,
    model_validator,
)

from app.models.finanzas import Finca
from app.models.insumo import UnidadInsumo
from app.models.parcela import TipoRiego, VariedadUva
from app.models.produccion import (
    ClasificacionTarea,
    CultivoCosecha,
    DestinoCosecha,
    EstadoCampana,
    EstadoFenologico,
    EstadoOrdenAplicacion,
    EstadoOrdenAplicacionParcela,
    OrigenCosecha,
    OrigenOrdenAplicacion,
    ResultadoValvula,
    TipoEnvase,
    UnidadMedida,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

class TrabajadorItem(BaseModel):
    trabajador_nombre: str
    cantidad: Decimal
    trabajador_id: str | None = None


# ── Registro Trabajo ──────────────────────────────────────────────────────────

class RegistroTrabajoBase(BaseModel):
    fecha: date
    parcela_id: str | None = None
    trabajador_nombre: str
    tarea: str
    cantidad: Decimal
    unidad_medida: UnidadMedida
    precio_unitario: Decimal
    detalle: str | None = None


class RegistroTrabajoCreate(RegistroTrabajoBase):
    # Required for correct egreso assignment — must match the finca where the
    # work is performed. Defaults to media_agua for backward compat but should
    # always be sent explicitly by the frontend.
    finca: Finca = Finca.media_agua
    # If provided, overrides trabajador_nombre with the linked Trabajador's full name.
    trabajador_id: str | None = None
    idempotency_key: str | None = None
    # Solo relevante para tareas nuevas/personalizadas (fuera de
    # CLASIFICACION_POR_TAREA) — permite que el cliente elija la temporada en
    # vez de caer siempre en "general". Se ignora si el cliente no lo manda;
    # las tareas del catálogo fijo siguen clasificándose automáticamente.
    clasificacion: ClasificacionTarea | None = None


class RegistroCargaMasiva(BaseModel):
    fecha: date
    parcela_id: str | None = None
    finca: Finca = Finca.media_agua  # same rationale as RegistroTrabajoCreate
    tarea: str
    unidad_medida: UnidadMedida
    precio_unitario: Decimal
    detalle: str | None = None
    trabajadores: list[TrabajadorItem]
    idempotency_key: str | None = None
    clasificacion: ClasificacionTarea | None = None  # ver RegistroTrabajoCreate


class RegistroTrabajoUpdate(BaseModel):
    fecha: date | None = None
    parcela_id: str | None = None
    trabajador_nombre: str | None = None
    trabajador_id: str | None = None
    tarea: str | None = None
    cantidad: Decimal | None = None
    unidad_medida: UnidadMedida | None = None
    precio_unitario: Decimal | None = None
    detalle: str | None = None
    clasificacion: ClasificacionTarea | None = None  # ver RegistroTrabajoCreate


class RegistroTrabajoResponse(RegistroTrabajoBase):
    id: str
    clasificacion: ClasificacionTarea
    monto_total: Decimal
    trabajador_id: str | None = None
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ResumenTrabajador(BaseModel):
    trabajador_nombre: str
    total_jornales: Decimal
    monto_total: Decimal
    tareas_realizadas: list[str]


class ResumenTarea(BaseModel):
    tarea: str
    clasificacion: ClasificacionTarea
    total_registros: int
    cantidad_total: Decimal
    monto_total: Decimal


class ResumenTrabajoTotal(BaseModel):
    total_registros: int
    monto_total: Decimal


class ResumenTrabajoPorParcela(BaseModel):
    parcela_id: str | None
    parcela_nombre: str
    monto_total: Decimal
    n_registros: int


# ── Registro Riego ────────────────────────────────────────────────────────────

class RegistroRiegoBase(BaseModel):
    fecha: date
    parcela_id: str
    # Required for goteo, NULL for manto (whole parcel); enforced in the router
    # because the rule depends on `tipo`.
    cabezal: str | None = None
    valvula: str | None = None
    tipo: TipoRiego = TipoRiego.goteo
    inicio: datetime
    fin: datetime
    mm_aplicados: float | None = None
    fertilizante_nombre: str | None = None
    fertilizante_dosis_lt_ha: float | None = None
    responsable: str
    responsable_id: str | None = None


class RegistroRiegoCreate(RegistroRiegoBase):
    idempotency_key: str | None = None


class RegistroRiegoUpdate(BaseModel):
    fecha: date | None = None
    parcela_id: str | None = None
    cabezal: str | None = None
    valvula: str | None = None
    tipo: TipoRiego | None = None
    inicio: datetime | None = None
    fin: datetime | None = None
    mm_aplicados: float | None = None
    fertilizante_nombre: str | None = None
    fertilizante_dosis_lt_ha: float | None = None
    responsable: str | None = None
    responsable_id: str | None = None


class RegistroRiegoResponse(RegistroRiegoBase):
    id: str
    duracion_horas: float
    n_valvulas: int
    # Caudal factor of this record (1.0 goteo, 0.25 manto, 0.4 historical manto).
    factor_aplicado: float
    litros_aplicados: float
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

    # Pre-manto web/mobile clients call valvula.split(',') without a guard and
    # the backend deploys before them: never send null. The DB keeps NULL.
    @field_serializer("valvula")
    def _valvula_never_null(self, v: str | None) -> str:
        return v or ""


# ── Riego en curso (inicio sin fin todavía) ───────────────────────────────────

class RegistroRiegoIniciar(BaseModel):
    parcela_id: str
    cabezal: str | None = None
    valvula: str | None = None
    tipo: TipoRiego = TipoRiego.goteo
    responsable: str
    responsable_id: str | None = None
    fertilizante_nombre: str | None = None
    fertilizante_dosis_lt_ha: float | None = None
    idempotency_key: str | None = None


class RegistroRiegoEnCursoResponse(BaseModel):
    id: str
    fecha: date
    parcela_id: str
    cabezal: str | None = None
    valvula: str | None = None
    tipo: TipoRiego
    inicio: datetime
    n_valvulas: int
    # Lets clients compute live litros/mm without knowing the manto rule.
    factor_aplicado: float
    responsable: str
    responsable_id: str | None = None
    fertilizante_nombre: str | None = None

    model_config = ConfigDict(from_attributes=True)

    # Pre-manto web/mobile clients call valvula.split(',') without a guard and
    # the backend deploys before them: never send null. The DB keeps NULL.
    @field_serializer("valvula")
    def _valvula_never_null(self, v: str | None) -> str:
        return v or ""


class RegistroRiegoTerminar(BaseModel):
    fin: datetime | None = None  # None => usar la hora del servidor


# ── Registro Fitosanitario ────────────────────────────────────────────────────

class RegistroFitosanitarioBase(BaseModel):
    fecha: date
    parcela_id: str
    insumo_id: str
    dosis_por_ha: float
    motivo: str
    dias_carencia: int
    dias_reingreso: int
    responsable: str
    responsable_id: str | None = None
    observaciones: str | None = None


class RegistroFitosanitarioCreate(RegistroFitosanitarioBase):
    idempotency_key: str | None = None


class RegistroFitosanitarioUpdate(BaseModel):
    fecha: date | None = None
    parcela_id: str | None = None
    insumo_id: str | None = None
    dosis_por_ha: float | None = None
    motivo: str | None = None
    dias_carencia: int | None = None
    dias_reingreso: int | None = None
    responsable: str | None = None
    responsable_id: str | None = None
    observaciones: str | None = None


class RegistroFitosanitarioResponse(BaseModel):
    id: str
    fecha: date
    parcela_id: str
    producto_nombre: str
    insumo_id: str | None = None
    dosis_por_ha: float
    unidad: UnidadInsumo | None = None
    cantidad_total: Decimal | None = None
    motivo: str
    dias_carencia: int
    dias_reingreso: int
    responsable: str
    responsable_id: str | None = None
    observaciones: str | None = None
    fecha_habilitacion_cosecha: date
    fecha_habilitacion_reingreso: date
    created_by: str
    created_at: datetime
    # Order the record came from (parcel or valve confirmation); None for manual
    # records. Lets the web offer "Reactivar" only where it applies.
    orden_id: str | None = None

    model_config = ConfigDict(from_attributes=True)


# ── Plan Fitosanitario ──────────────────────────────────────────────────────

class PlanFitosanitarioBase(BaseModel):
    # Legacy round number: the plan is monthly now, so it is optional and the
    # API assigns the next free one per (season, variety, product).
    numero_aplicacion: int | None = None
    mes: int = Field(ge=1, le=12)
    insumo_id: str
    objetivo: str
    dosis_por_ha: float
    notas: str | None = None


class PlanFitosanitarioCreate(PlanFitosanitarioBase):
    temporada: int
    variedades: list[VariedadUva] = Field(min_length=1)


class PlanFitosanitarioUpdate(BaseModel):
    variedad: VariedadUva | None = None
    numero_aplicacion: int | None = None
    mes: int | None = Field(None, ge=1, le=12)
    insumo_id: str | None = None
    objetivo: str | None = None
    dosis_por_ha: float | None = None
    notas: str | None = None


class PlanFitosanitarioResponse(BaseModel):
    id: str
    temporada: int
    variedad: VariedadUva
    numero_aplicacion: int
    mes: int
    insumo_id: str
    insumo_nombre: str
    insumo_unidad: UnidadInsumo
    objetivo: str
    dosis_por_ha: float
    notas: str | None = None
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


EstadoAvanceLiteral = Literal["pendiente", "bajo", "ok", "exceso", "no_planificado"]


class AvanceParcela(BaseModel):
    id: str
    nombre: str
    ha: Decimal
    dosis_aplicada: Decimal
    porcentaje: Decimal | None = None
    estado: EstadoAvanceLiteral


class AvanceItem(BaseModel):
    """Plan vs applied for one (variety, month, product); see services/plan_avance."""
    variedad: VariedadUva
    mes: int
    insumo_id: str
    insumo_nombre: str
    unidad: str | None = None
    # None = applied but not in the plan for that variety and month.
    dosis_plan: Decimal | None = None
    dosis_aplicada_promedio: Decimal
    porcentaje: Decimal | None = None
    estado: EstadoAvanceLiteral
    ha_total: Decimal
    parcelas: list[AvanceParcela]


class ContrasteParcela(BaseModel):
    parcela_id: str
    # Empty = the whole parcel.
    valvula_ids: list[str] = Field(default_factory=list)


class ContrasteLineaIn(BaseModel):
    insumo_id: str
    dosis_por_ha: Decimal = Field(gt=0)


class ContrasteRequest(BaseModel):
    fecha: date
    parcelas: list[ContrasteParcela] = Field(min_length=1)
    lineas: list[ContrasteLineaIn] = Field(min_length=1)


class ContrasteVariedad(BaseModel):
    variedad: VariedadUva
    estado: Literal["en_plan", "excede", "fuera_del_plan"]
    dosis_plan: Decimal | None = None
    dosis_aplicada_promedio: Decimal
    dosis_proyectada_promedio: Decimal
    porcentaje_proyectado: Decimal | None = None


class ContrasteLineaOut(BaseModel):
    insumo_id: str
    variedades: list[ContrasteVariedad]


class NecesidadInsumoItem(BaseModel):
    insumo_id: str
    insumo_nombre: str
    unidad: UnidadInsumo
    cantidad_pendiente: float
    stock_actual: Decimal
    faltante: float


# ── Órdenes de Aplicación ────────────────────────────────────────────────────

class OrdenAplicacionValvulaResponse(BaseModel):
    id: str
    valvula_id: str
    valvula_nombre: str
    superficie_ha: Decimal | None = None
    estado: EstadoOrdenAplicacionParcela
    resultado: ResultadoValvula | None = None
    responsable: str | None = None
    observaciones: str | None = None
    registro_fitosanitario_id: str | None = None
    confirmada_at: datetime | None = None


class ProductoAplicadoResponse(BaseModel):
    """One product line of an order, as shown next to a confirmed valve."""
    insumo_id: str
    insumo_nombre: str
    dosis_por_ha: float


class ValvulaARevisarResponse(BaseModel):
    """Una válvula confirmada que pide una segunda mirada: no se aplicó, o se
    aplicó con observaciones (así se señalan las aplicaciones incompletas)."""
    id: str
    orden_id: str
    parcela_id: str
    parcela_nombre: str
    valvula_id: str
    valvula_nombre: str
    # Variety of the valve's parcel (falls back to the order's shim variety
    # when the parcel has none).
    variedad: VariedadUva
    # Deprecated single-product shim (first line), kept for old clients.
    insumo_id: str
    insumo_nombre: str
    dosis_por_ha: float
    productos: list[ProductoAplicadoResponse] = Field(default_factory=list)
    objetivo: str
    resultado: ResultadoValvula
    responsable: str | None = None
    observaciones: str | None = None
    confirmada_at: datetime | None = None
    fotos: list[str] = []


class OrdenAplicacionParcelaResponse(BaseModel):
    id: str
    parcela_id: str
    parcela_nombre: str
    estado: EstadoOrdenAplicacionParcela
    registro_fitosanitario_id: str | None = None
    # Vacía en parcelas sin válvulas y en órdenes anteriores al modelo por
    # válvula: esas se confirman por parcela entera.
    valvulas: list[OrdenAplicacionValvulaResponse] = []

    model_config = ConfigDict(from_attributes=True)


class OrdenAplicacionLineaResponse(BaseModel):
    id: str
    insumo_id: str
    insumo_nombre: str
    insumo_unidad: UnidadInsumo
    dosis_por_ha: float
    dias_carencia: int
    dias_reingreso: int
    # Plan round this product counts against; None = off-plan product.
    numero_aplicacion: int | None = None


class OrdenAplicacionResponse(BaseModel):
    id: str
    temporada: int
    origen: OrigenOrdenAplicacion
    # Deprecated single-product shim (first line / variety of the largest
    # parcel), kept for old web/mobile clients until the cleanup migration.
    plan_fitosanitario_id: str | None = None
    variedad: VariedadUva
    insumo_id: str
    insumo_nombre: str
    insumo_unidad: UnidadInsumo
    dosis_por_ha: float
    objetivo: str
    dias_carencia: int
    dias_reingreso: int
    fecha_planificada: date
    estado: EstadoOrdenAplicacion
    notas: str | None = None
    created_by: str
    created_at: datetime
    lineas: list[OrdenAplicacionLineaResponse] = Field(default_factory=list)
    variedades: list[VariedadUva] = Field(default_factory=list)
    parcelas: list[OrdenAplicacionParcelaResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class OrdenAplicacionCreateDesdePlan(BaseModel):
    plan_fitosanitario_id: str
    dias_carencia: int = Field(ge=0)
    dias_reingreso: int = Field(ge=0)
    fecha_planificada: date
    # None = todas las parcelas activas de la variedad del plan.
    parcela_ids: list[str] | None = None
    notas: str | None = None


class OrdenAplicacionLineaCreate(BaseModel):
    insumo_id: str
    dosis_por_ha: float = Field(gt=0)
    dias_carencia: int = Field(ge=0)
    dias_reingreso: int = Field(ge=0)
    # Plan round the product counts against (must exist in the plan for at
    # least one variety of the chosen parcels). None = off-plan product.
    numero_aplicacion: int | None = None


def _es_body_viejo(data: Any) -> bool:
    """Old single-product body: insumo_id/dosis_por_ha/dias_* at top level and
    no `lineas`."""
    return isinstance(data, dict) and data.get("lineas") is None and "insumo_id" in data


def _linea_desde_body_viejo(data: Any) -> Any:
    """Old single-product body: wrap the top-level product fields into a
    one-line `lineas` list so old web/mobile clients keep working."""
    if _es_body_viejo(data):
        data = dict(data)
        data["lineas"] = [
            {
                key: data[key]
                for key in ("insumo_id", "dosis_por_ha", "dias_carencia", "dias_reingreso")
                if key in data
            }
        ]
    return data


class OrdenAplicacionUpdate(BaseModel):
    """Reemplazo completo de una orden (del plan o extra) mientras nada esté
    confirmado. Las líneas se reemplazan completas. La temporada no se edita
    -- la orden queda en la campaña en que se creó."""
    objetivo: str
    fecha_planificada: date
    lineas: list[OrdenAplicacionLineaCreate] = Field(min_length=1)
    # Explicit parcels (several varieties allowed). None = every active
    # parcel of `variedad`; with neither the request is rejected.
    parcela_ids: list[str] | None = None
    # None = todas las válvulas de cada parcela. Con valores (orden de
    # repaso) restringe la orden a esas válvulas puntuales.
    valvula_ids: list[str] | None = None
    variedad: VariedadUva | None = None
    notas: str | None = None

    # Not part of the payload: remembers that the request came in the old
    # single-product shape, so PUT can refuse to collapse a multi-line order.
    _from_legacy_body: bool = PrivateAttr(default=False)

    @model_validator(mode="wrap")
    @classmethod
    def _body_viejo(cls, data: Any, handler: ValidatorFunctionWrapHandler) -> Any:
        es_viejo = _es_body_viejo(data)
        model = handler(_linea_desde_body_viejo(data))
        # Only ever set, never reset: re-validating an instance keeps its flag.
        if es_viejo:
            model._from_legacy_body = True
        return model

    @property
    def es_body_viejo(self) -> bool:
        return self._from_legacy_body

    @field_validator("lineas")
    @classmethod
    def _insumos_distintos(
        cls, lineas: list[OrdenAplicacionLineaCreate]
    ) -> list[OrdenAplicacionLineaCreate]:
        vistos: set[str] = set()
        for linea in lineas:
            if linea.insumo_id in vistos:
                raise ValueError("Hay un producto repetido en la orden: cargalo una sola vez.")
            vistos.add(linea.insumo_id)
        return lineas


class OrdenAplicacionCreate(OrdenAplicacionUpdate):
    temporada: int


class ConfirmarAplicacionRequest(BaseModel):
    observaciones: str | None = None


class ConfirmarValvulaRequest(BaseModel):
    resultado: ResultadoValvula
    # None = el trabajador vinculado al usuario que confirma.
    responsable_id: str | None = None
    # Obligatoria si el resultado es `no_aplicada`.
    observaciones: str | None = None


class FotoRegistroFitosanitarioResponse(BaseModel):
    id: str
    url: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Ciclo Campaña ─────────────────────────────────────────────────────────────

class CicloCampanaBase(BaseModel):
    parcela_id: str
    anio: int
    estado_fenologico: EstadoFenologico
    fecha_estado: date
    rendimiento_kg_ha: Decimal | None = None
    observaciones: str | None = None


class CicloCampanaCreate(CicloCampanaBase):
    pass


class CicloCampanaUpdate(BaseModel):
    parcela_id: str | None = None
    anio: int | None = None
    estado_fenologico: EstadoFenologico | None = None
    fecha_estado: date | None = None
    rendimiento_kg_ha: Decimal | None = None
    observaciones: str | None = None


class CicloCampanaResponse(CicloCampanaBase):
    id: str
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EstadoActualResponse(BaseModel):
    id: str | None = None
    parcela_id: str
    parcela_nombre: str
    anio: int | None = None
    estado_fenologico: EstadoFenologico | None = None
    fecha_estado: date | None = None


class FaseVariedadResponse(BaseModel):
    """Estado fenológico de una variedad, calculado automáticamente por
    fecha (ver app.core.fenologia) salvo que exista una confirmación manual
    reciente (CicloCampana) para alguna de sus parcelas, en cuyo caso esa
    confirmación tiene prioridad (`fuente="manual"`). Agrupa todos los
    parrales activos de esa variedad."""
    variedad: str
    tipo_uso: str
    fase: str
    fase_label: str
    estado_fenologico: EstadoFenologico
    riesgo_oidio: str
    tareas_recomendadas: list[str]
    proxima_fase: str | None
    proxima_fase_label: str | None
    proxima_fase_fecha: date | None
    parcelas: list[str]
    fuente: str  # "automatico" | "manual"
    fecha_confirmacion: date | None


class FaseCalendarioResponse(BaseModel):
    """Un estado del calendario único de Ciclo de Campaña (igual para todas
    las variedades), con su ventana de fechas (mes/día, se repite todos los
    años) — para mostrar en Documentación "de cuándo a cuándo es cada
    estado" sin tener que ir a mirar el código."""
    fase: str
    fase_label: str
    desde_mes: int
    desde_dia: int
    hasta_mes: int
    hasta_dia: int


# ── Ciclo de Campaña (calendario único, ver app.core.ciclo_campana) ────────────
# Sistema aparte de CicloCampana/EstadoActualResponse de arriba, que siguen
# alimentando "tareas recomendadas" sin cambios. Este es el pedido nuevo: un
# calendario único por fecha (igual para todas las variedades) con override
# manual por variedad entera y cumplimiento de riego por parcela.

class EstadoVariedadCampanaCreate(BaseModel):
    variedad: VariedadUva
    anio: int
    estado_campana: EstadoCampana
    fecha_confirmacion: date
    observaciones: str | None = None


class EstadoVariedadCampanaResponse(EstadoVariedadCampanaCreate):
    id: str
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EstadoActualVariedad(BaseModel):
    variedad: VariedadUva
    estado_campana: EstadoCampana
    estado_campana_label: str
    fecha_inicio: date
    riegos_esperados: int
    fuente: str  # "automatico" | "manual"
    fecha_confirmacion: date | None
    observaciones: str | None
    proxima_estado_campana: EstadoCampana
    proxima_fecha: date
    parcelas: list[str]


class CumplimientoRiegoParcela(BaseModel):
    parcela_id: str
    parcela_nombre: str
    variedad: VariedadUva | None
    estado_campana: EstadoCampana
    estado_campana_label: str
    riegos_esperados: int
    mm_aplicados: float
    riegos_equivalentes: float
    cumplimiento_pct: float


# ── Dashboard schemas ─────────────────────────────────────────────────────────

class RendimientoAnio(BaseModel):
    anio: int
    rendimiento_kg_ha: Decimal | None
    kg_totales: Decimal | None


class RendimientoHistoricoParcela(BaseModel):
    parcela_id: str
    parcela_nombre: str
    variedad: str | None
    superficie_ha: float | None
    campanas: list[RendimientoAnio]


class EficienciaHidricaParcela(BaseModel):
    parcela_id: str
    parcela_nombre: str
    variedad: str | None
    superficie_ha: float | None
    mm_aplicados_total: float
    litros_totales: float
    litros_objetivo_anual: float | None
    porcentaje_cumplimiento: float | None
    rendimiento_kg_ha: float | None
    eficiencia_kg_por_mm: float | None


# ── Registro Cosecha ──────────────────────────────────────────────────────────

class RegistroCosechaBase(BaseModel):
    fecha: date
    parcela_id: str | None = None
    cultivo: CultivoCosecha = CultivoCosecha.vid
    variedad: str | None = None
    origen: OrigenCosecha = OrigenCosecha.propio
    proveedor_tercero: str | None = None
    productor_id: str | None = None
    n_remito: str | None = None
    n_ciu: str | None = None
    destino: DestinoCosecha
    comprador: str | None = None
    comprador_id: str | None = None
    cuadrilla: str | None = None
    acarreo: str | None = None
    vehiculo_patente: str | None = None
    tipo_envase: TipoEnvase = TipoEnvase.caja
    cantidad_envases: float | None = None
    peso_unitario_kg: float | None = None
    bruto_kg: float | None = None
    tara_kg: float | None = None
    kg_total: float
    imagen_remito_url: str | None = None
    observaciones: str | None = None


class RegistroCosechaCreate(RegistroCosechaBase):
    idempotency_key: str | None = None


class RegistroCosechaUpdate(BaseModel):
    fecha: date | None = None
    parcela_id: str | None = None
    cultivo: CultivoCosecha | None = None
    variedad: str | None = None
    origen: OrigenCosecha | None = None
    proveedor_tercero: str | None = None
    productor_id: str | None = None
    n_remito: str | None = None
    n_ciu: str | None = None
    destino: DestinoCosecha | None = None
    comprador: str | None = None
    comprador_id: str | None = None
    cuadrilla: str | None = None
    acarreo: str | None = None
    vehiculo_patente: str | None = None
    tipo_envase: TipoEnvase | None = None
    cantidad_envases: float | None = None
    peso_unitario_kg: float | None = None
    bruto_kg: float | None = None
    tara_kg: float | None = None
    kg_total: float | None = None
    imagen_remito_url: str | None = None
    observaciones: str | None = None


class RegistroCosechaResponse(RegistroCosechaBase):
    id: str
    temporada: int
    semana: int | None
    created_by: str
    created_at: datetime
    parcela_nombre: str | None = None
    # kg_total menos lo despachado en remitos de salida. None si no se calculó
    # (p. ej. cosechas embebidas en la ficha de trazabilidad).
    saldo_kg: Decimal | None = None
    # Remito más reciente que incluye esta cosecha (None en histórico sin remitos).
    remito_id: str | None = None
    remito_numero: str | None = None

    model_config = ConfigDict(from_attributes=True)


# ── Summary schemas ───────────────────────────────────────────────────────────

class CosechaResumenPorParcela(BaseModel):
    parcela_id: str | None
    parcela_nombre: str
    variedad: str | None
    kg_total: float
    n_registros: int


class CosechaResumenPorSemana(BaseModel):
    semana: int
    kg_total: float
    n_registros: int


class CosechaResumenPorDestino(BaseModel):
    destino: str
    kg_total: float
    n_registros: int


class CosechaResumenPorOrigen(BaseModel):
    origen: OrigenCosecha
    kg_total: float
    n_registros: int


class CosechaTotalesResponse(BaseModel):
    temporada: int
    kg_total: float
    n_registros: int
    n_parcelas: int
    resumen_por_destino: list[CosechaResumenPorDestino]
    resumen_por_origen: list[CosechaResumenPorOrigen]
