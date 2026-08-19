"""Cálculo de métricas agroclimáticas sobre lecturas del termógrafo.

Funciones puras: reciben una lista de lecturas ya ordenadas cronológicamente
(sin acceso a DB) y devuelven números/estructuras planas -- fáciles de testear
con datasets sintéticos chicos, sin necesidad de una sesión async.

Decisión de diseño clave: las métricas "horas por debajo/encima de un umbral"
NO multiplican por un intervalo fijo (900s). En vez de eso, cada lectura que
cumple la condición aporta el tiempo real hasta la lectura siguiente, con un
tope (`MAX_GAP_MULTIPLIER` veces el intervalo nominal del lote) para no
inflar horas cuando hay un hueco real de datos (el dispositivo se quedó sin
batería, o pasaron semanas entre visitas a la finca sin bajar el CSV). Esto
también deja el cálculo correcto si algún día se usa un termógrafo con un
intervalo de logging distinto.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal

MAX_GAP_MULTIPLIER = 4

UMBRAL_HELADA = Decimal("0")
UMBRAL_CALOR = Decimal("30")
FRIO_MIN = Decimal("0")
FRIO_MAX = Decimal("7")
RIESGO_FUNGICO_TEMP_MIN = Decimal("15")
RIESGO_FUNGICO_TEMP_MAX = Decimal("25")
RIESGO_FUNGICO_HUMEDAD_MIN = Decimal("80")
GDD_BASE = Decimal("10")


@dataclass(frozen=True)
class Lectura:
    fecha_hora: datetime
    temperatura: Decimal
    humedad: Decimal


@dataclass(frozen=True)
class EventoHelada:
    inicio: datetime
    fin: datetime
    duracion_horas: float
    minima: Decimal


def intervalo_efectivo_seg(lecturas: list[Lectura], default: int = 900) -> int:
    """Intervalo nominal derivado de los datos mismos (mediana de los deltas
    entre lecturas consecutivas), en vez de confiar en un único
    `intervalo_seg` de lote -- un rango de fechas puede combinar lecturas de
    varios lotes importados con distinto intervalo de logging."""
    if len(lecturas) < 2:
        return default
    deltas = sorted(
        (b.fecha_hora - a.fecha_hora).total_seconds()
        for a, b in zip(lecturas, lecturas[1:])
    )
    mediana = deltas[len(deltas) // 2]
    return int(mediana) if mediana > 0 else default


def _horas_bajo_condicion(
    lecturas: list[Lectura], intervalo_seg: int, cumple: callable
) -> float:
    """Suma, en horas, el tiempo real hasta la siguiente lectura para cada
    lectura que cumple `cumple(lectura)`. La última lectura de la lista usa
    el intervalo nominal (no hay "siguiente" real para extrapolar)."""
    if not lecturas:
        return 0.0

    max_gap = timedelta(seconds=intervalo_seg * MAX_GAP_MULTIPLIER)
    intervalo_nominal = timedelta(seconds=intervalo_seg)
    total = timedelta()

    for i, lectura in enumerate(lecturas):
        if not cumple(lectura):
            continue
        if i + 1 < len(lecturas):
            delta = lecturas[i + 1].fecha_hora - lectura.fecha_hora
            if delta > max_gap:
                delta = intervalo_nominal  # hueco real de datos, no lo contamos
        else:
            delta = intervalo_nominal
        total += delta

    return total.total_seconds() / 3600


def horas_bajo_cero(lecturas: list[Lectura], intervalo_seg: int) -> float:
    return _horas_bajo_condicion(lecturas, intervalo_seg, lambda l: l.temperatura < UMBRAL_HELADA)


def horas_sobre_30(lecturas: list[Lectura], intervalo_seg: int) -> float:
    return _horas_bajo_condicion(lecturas, intervalo_seg, lambda l: l.temperatura > UMBRAL_CALOR)


def horas_de_frio(lecturas: list[Lectura], intervalo_seg: int) -> float:
    return _horas_bajo_condicion(
        lecturas, intervalo_seg, lambda l: FRIO_MIN <= l.temperatura <= FRIO_MAX
    )


def horas_riesgo_fungico(lecturas: list[Lectura], intervalo_seg: int) -> float:
    return _horas_bajo_condicion(
        lecturas,
        intervalo_seg,
        lambda l: RIESGO_FUNGICO_TEMP_MIN <= l.temperatura <= RIESGO_FUNGICO_TEMP_MAX
        and l.humedad > RIESGO_FUNGICO_HUMEDAD_MIN,
    )


def _agrupar_por_dia(lecturas: list[Lectura]) -> dict[date, list[Lectura]]:
    por_dia: dict[date, list[Lectura]] = {}
    for lectura in lecturas:
        por_dia.setdefault(lectura.fecha_hora.date(), []).append(lectura)
    return por_dia


def gdd_acumulado(lecturas: list[Lectura], base: Decimal = GDD_BASE) -> Decimal:
    """Grados-día de crecimiento: suma, por día calendario, de
    max(promedio_diario - base, 0)."""
    total = Decimal("0")
    for dia_lecturas in _agrupar_por_dia(lecturas).values():
        promedio = sum((l.temperatura for l in dia_lecturas), Decimal("0")) / len(dia_lecturas)
        total += max(promedio - base, Decimal("0"))
    return total


def amplitud_termica_diaria_promedio(lecturas: list[Lectura]) -> Decimal | None:
    """Promedio, sobre todos los días con datos, de (máxima - mínima) del día."""
    por_dia = _agrupar_por_dia(lecturas)
    if not por_dia:
        return None
    amplitudes = [
        max(l.temperatura for l in dia_lecturas) - min(l.temperatura for l in dia_lecturas)
        for dia_lecturas in por_dia.values()
    ]
    return sum(amplitudes, Decimal("0")) / len(amplitudes)


def eventos_helada(lecturas: list[Lectura], intervalo_seg: int) -> list[EventoHelada]:
    """Agrupa lecturas consecutivas con temperatura < 0°C en eventos. Permite
    huecos de hasta MAX_GAP_MULTIPLIER x el intervalo nominal dentro de un
    mismo evento (una lectura puntual perdida no corta la helada en dos)."""
    max_gap = timedelta(seconds=intervalo_seg * MAX_GAP_MULTIPLIER)
    eventos: list[EventoHelada] = []
    actual: list[Lectura] = []

    def _cerrar_evento():
        if not actual:
            return
        eventos.append(
            EventoHelada(
                inicio=actual[0].fecha_hora,
                fin=actual[-1].fecha_hora,
                duracion_horas=(actual[-1].fecha_hora - actual[0].fecha_hora).total_seconds() / 3600,
                minima=min(l.temperatura for l in actual),
            )
        )

    for lectura in lecturas:
        bajo_cero = lectura.temperatura < UMBRAL_HELADA
        if not bajo_cero:
            _cerrar_evento()
            actual = []
            continue
        if actual and lectura.fecha_hora - actual[-1].fecha_hora > max_gap:
            _cerrar_evento()
            actual = []
        actual.append(lectura)

    _cerrar_evento()
    return eventos
