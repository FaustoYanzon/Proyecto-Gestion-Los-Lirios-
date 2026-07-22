"""Calendario único de Ciclo de Campaña + cumplimiento de riego.

Sistema aparte de `app.core.fenologia` (que sigue intacto y sigue alimentando
las "tareas recomendadas" de Inicio con su calendario INTA por variedad). Este
módulo es el pedido nuevo: un único calendario, igual para todas las
variedades, con una cantidad de riegos esperados por estado para poder medir
cumplimiento en el mapa.

El estado se calcula igual para todas las variedades; el override manual
(tabla `EstadoVariedadCampana`) es por variedad entera, no por parcela.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

# Reuso los helpers de fecha de fenologia.py: son genéricos (mes, dia, hoy),
# no dependen de variedad, y resuelven el wraparound de año sin duplicar
# lógica.
from app.core.fenologia import _fecha_mas_reciente, _proxima_fecha
from app.models.produccion import EstadoCampana, RegistroRiego

__all__ = [
    "EstadoCampana",
    "ESTADO_CAMPANA_LABELS",
    "CALENDARIO_CAMPANA",
    "RIEGOS_ESPERADOS",
    "MM_POR_RIEGO_ESTANDAR",
    "calcular_estado_actual",
    "estado_y_ventana_actual",
    "calcular_proximo_estado",
    "riegos_esperados",
]

ESTADO_CAMPANA_LABELS: dict[EstadoCampana, str] = {
    EstadoCampana.brotacion: "Brotación",
    EstadoCampana.floracion: "Floración",
    EstadoCampana.cuaje: "Cuaje",
    EstadoCampana.cierre_racimo: "Cierre de Racimo",
    EstadoCampana.envero: "Envero",
    EstadoCampana.cosecha: "Cosecha",
    EstadoCampana.post_cosecha: "Post-Cosecha",
}


@dataclass(frozen=True)
class AnclaCampana:
    estado: EstadoCampana
    mes: int
    dia: int
    riegos_esperados: int


# Calendario fijo, igual para todas las variedades (a diferencia de
# `fenologia.CALENDARIO_FENOLOGICO`, que sí varía por variedad). Riegos
# esperados: cantidad de riegos "estándar" (24hs, ver `MM_POR_RIEGO_ESTANDAR`
# abajo) que deberían aplicarse durante ese estado.
CALENDARIO_CAMPANA: list[AnclaCampana] = [
    AnclaCampana(EstadoCampana.brotacion, 9, 20, 1),
    AnclaCampana(EstadoCampana.floracion, 10, 20, 1),
    AnclaCampana(EstadoCampana.cuaje, 11, 10, 3),
    AnclaCampana(EstadoCampana.cierre_racimo, 12, 5, 4),
    AnclaCampana(EstadoCampana.envero, 1, 5, 4),
    AnclaCampana(EstadoCampana.cosecha, 2, 1, 3),
    AnclaCampana(EstadoCampana.post_cosecha, 5, 1, 1),
]

RIEGOS_ESPERADOS: dict[EstadoCampana, int] = {
    a.estado: a.riegos_esperados for a in CALENDARIO_CAMPANA
}

# 1 riego estándar = 24hs al ritmo de RegistroRiego.MM_POR_HORA (1.6mm/h,
# ya usado por EficienciaHidricaParcela) = 38.4mm = 384.000 L/ha. Derivado de
# la constante existente en vez de duplicar el número.
MM_POR_RIEGO_ESTANDAR: float = RegistroRiego.MM_POR_HORA * 24


def calcular_estado_actual(hoy: date | None = None) -> EstadoCampana:
    """Estado vigente del calendario único, para la fecha dada."""
    hoy = hoy or date.today()
    candidatos = [
        (fecha, ancla.estado)
        for ancla in CALENDARIO_CAMPANA
        if (fecha := _fecha_mas_reciente(ancla.mes, ancla.dia, hoy)) is not None
    ]
    candidatos.sort(key=lambda item: item[0])
    return candidatos[-1][1]


def estado_y_ventana_actual(hoy: date | None = None) -> tuple[EstadoCampana, date, date]:
    """Estado vigente + su ventana de fechas: (estado, fecha_inicio, hoy).

    `fecha_inicio` es el comienzo real del estado actual (fecha más reciente
    <= hoy). El fin de ventana para cumplimiento es `hoy` (no la fecha del
    próximo estado): mientras el estado está en curso, el cumplimiento se
    mide contra lo que ya pasó, no contra riegos futuros todavía no hechos.
    """
    hoy = hoy or date.today()
    estado = calcular_estado_actual(hoy)
    ancla = next(a for a in CALENDARIO_CAMPANA if a.estado == estado)
    inicio = _fecha_mas_reciente(ancla.mes, ancla.dia, hoy)
    assert inicio is not None  # calcular_estado_actual ya lo encontró
    return estado, inicio, hoy


def calcular_proximo_estado(hoy: date | None = None) -> tuple[EstadoCampana, date]:
    """Próximo estado del calendario único y en qué fecha arranca."""
    hoy = hoy or date.today()
    candidatos = [
        (fecha, ancla.estado)
        for ancla in CALENDARIO_CAMPANA
        if (fecha := _proxima_fecha(ancla.mes, ancla.dia, hoy)) is not None
    ]
    candidatos.sort(key=lambda item: item[0])
    fecha, estado = candidatos[0]
    return estado, fecha


def riegos_esperados(estado: EstadoCampana) -> int:
    return RIEGOS_ESPERADOS[estado]
