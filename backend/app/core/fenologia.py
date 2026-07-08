"""Motor de fenología automática por variedad de vid.

Reemplaza la carga 100% manual de `CicloCampana` por un cálculo derivado de
la fecha del año y la variedad de la parcela, basado en el informe agronómico
de referencia (INTA San Juan / Pocito) provisto para el proyecto.

Diseño:
- `FaseOperativa` es más fina que el enum `EstadoFenologico` de la DB (que
  sigue existiendo tal cual, sin migraciones). Cada fase operativa mapea a un
  `EstadoFenologico` para no romper nada que ya lea ese campo (mapa, alertas,
  dashboards).
- El calendario de cada variedad son "anclas" (fase, mes, día). Solo las
  anclas marcadas explícitamente como `INTA San Juan (Pocito)` en los
  comentarios son datos agronómicos reales del informe; el resto son
  estimaciones interpoladas y DEBEN ser validadas por alguien con
  conocimiento de campo antes de confiar en ellas para decisiones críticas.
- `CicloCampana` (carga manual) no se elimina: sigue sirviendo como registro
  histórico/override que un encargado puede cargar cuando confirma en el
  campo una fecha real distinta a la estimada. Ese cruce (automático vs
  manual) se resuelve en el endpoint, no acá.

Recomendación #3 del informe (grados-día) queda pendiente: requiere una
fuente de temperatura diaria por finca que hoy no está integrada. Este motor
es la base de datos históricos (fechas reales confirmadas) que se necesitaría
para calibrar ese modelo más adelante.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass
from datetime import date

from app.models.parcela import VariedadUva
from app.models.produccion import EstadoFenologico


class FaseOperativa(str, enum.Enum):
    reposo_invernal = "reposo_invernal"
    lloro = "lloro"
    brotacion = "brotacion"
    floracion = "floracion"
    cuaje = "cuaje"
    grano_arveja = "grano_arveja"
    envero = "envero"
    madurez = "madurez"
    cosecha = "cosecha"
    post_cosecha = "post_cosecha"


# Mapeo a la columna estado_fenologico existente (sin agregar valores nuevos
# al enum de la DB, para no requerir migración).
ESTADO_POR_FASE: dict[FaseOperativa, EstadoFenologico] = {
    FaseOperativa.reposo_invernal: EstadoFenologico.latencia,
    FaseOperativa.lloro: EstadoFenologico.latencia,
    FaseOperativa.brotacion: EstadoFenologico.brotacion,
    FaseOperativa.floracion: EstadoFenologico.floracion,
    FaseOperativa.cuaje: EstadoFenologico.cuaje,
    FaseOperativa.grano_arveja: EstadoFenologico.cuaje,
    FaseOperativa.envero: EstadoFenologico.envero,
    FaseOperativa.madurez: EstadoFenologico.madurez,
    FaseOperativa.cosecha: EstadoFenologico.cosecha,
    FaseOperativa.post_cosecha: EstadoFenologico.latencia,
}

FASE_LABELS: dict[FaseOperativa, str] = {
    FaseOperativa.reposo_invernal: "Reposo invernal",
    FaseOperativa.lloro: "Lloro",
    FaseOperativa.brotacion: "Brotación",
    FaseOperativa.floracion: "Floración",
    FaseOperativa.cuaje: "Cuaje",
    FaseOperativa.grano_arveja: "Crecimiento de baya (grano de arveja)",
    FaseOperativa.envero: "Envero",
    FaseOperativa.madurez: "Maduración",
    FaseOperativa.cosecha: "Cosecha",
    FaseOperativa.post_cosecha: "Post cosecha",
}

# Label del estado "grueso" (columna de la DB), para cuando el estado viene
# de una confirmación manual (CicloCampana) y no hay una FaseOperativa
# asociada directamente.
ESTADO_LABELS: dict[EstadoFenologico, str] = {
    EstadoFenologico.brotacion: "Brotación",
    EstadoFenologico.floracion: "Floración",
    EstadoFenologico.cuaje: "Cuaje",
    EstadoFenologico.envero: "Envero",
    EstadoFenologico.madurez: "Maduración",
    EstadoFenologico.cosecha: "Cosecha",
    EstadoFenologico.latencia: "Latencia",
}

# Inverso de ESTADO_POR_FASE: qué fases operativas caen bajo cada estado
# grueso. Se usa para armar una lista de tareas razonable cuando el estado
# viene de una confirmación manual (no sabemos la fase fina exacta).
FASES_POR_ESTADO: dict[EstadoFenologico, list[FaseOperativa]] = {}
for _fase, _estado in ESTADO_POR_FASE.items():
    FASES_POR_ESTADO.setdefault(_estado, []).append(_fase)


class TipoUso(str, enum.Enum):
    mesa = "mesa"
    pasa = "pasa"
    vino = "vino"
    otro = "otro"


# Recomendación 1 del informe: diferenciar módulo Mesa/Pasa vs Vinificación.
TIPO_USO_POR_VARIEDAD: dict[VariedadUva, TipoUso] = {
    VariedadUva.red_globe: TipoUso.mesa,
    VariedadUva.flame: TipoUso.mesa,
    VariedadUva.fiesta: TipoUso.pasa,
    VariedadUva.sultanina: TipoUso.pasa,
    VariedadUva.bonarda: TipoUso.vino,
    VariedadUva.syrah: TipoUso.vino,
    VariedadUva.aspirant: TipoUso.vino,
    VariedadUva.otro: TipoUso.otro,
}


class RiesgoSanitario(str, enum.Enum):
    alto = "alto"
    medio = "medio"
    bajo = "bajo"


# Recomendación 2 del informe: alertas sanitarias (oídio) personalizadas.
RIESGO_OIDIO_POR_VARIEDAD: dict[VariedadUva, RiesgoSanitario] = {
    VariedadUva.fiesta: RiesgoSanitario.alto,
    VariedadUva.bonarda: RiesgoSanitario.alto,
    VariedadUva.red_globe: RiesgoSanitario.medio,
    VariedadUva.flame: RiesgoSanitario.medio,
    VariedadUva.syrah: RiesgoSanitario.medio,
    VariedadUva.sultanina: RiesgoSanitario.medio,
    VariedadUva.aspirant: RiesgoSanitario.bajo,
    VariedadUva.otro: RiesgoSanitario.medio,
}


@dataclass(frozen=True)
class AnclaFenologica:
    fase: FaseOperativa
    mes: int
    dia: int


# ── Calendarios por variedad ────────────────────────────────────────────────
#
# Las anclas marcadas "INTA" son datos del informe (Red Globe, Pocito, San
# Juan). El resto son ESTIMACIONES: se interpolaron manteniendo las mismas
# proporciones relativas que muestra el ciclo de Red Globe (única variedad
# con calendario completo), escaladas al tramo floración->cosecha que sí
# indica el informe para cada variedad. Hay que ajustarlas con datos de
# campo reales antes de usarlas para decisiones de riesgo (ej. helada,
# aplicaciones críticas).
CALENDARIO_FENOLOGICO: dict[VariedadUva, list[AnclaFenologica]] = {
    VariedadUva.red_globe: [
        AnclaFenologica(FaseOperativa.reposo_invernal, 6, 1),
        AnclaFenologica(FaseOperativa.lloro, 8, 25),
        AnclaFenologica(FaseOperativa.brotacion, 9, 19),      # INTA
        AnclaFenologica(FaseOperativa.floracion, 10, 10),     # INTA
        AnclaFenologica(FaseOperativa.cuaje, 10, 16),         # INTA
        AnclaFenologica(FaseOperativa.grano_arveja, 11, 8),   # estimado
        AnclaFenologica(FaseOperativa.envero, 12, 23),        # INTA
        AnclaFenologica(FaseOperativa.madurez, 1, 20),        # estimado
        AnclaFenologica(FaseOperativa.cosecha, 2, 5),         # INTA
        AnclaFenologica(FaseOperativa.post_cosecha, 2, 20),   # estimado
    ],
    VariedadUva.flame: [
        # Floración 10-15/nov y cosecha 10/ene-20/feb (dato informe). Ciclo
        # muy telescopado: se interpolan fases intermedias proporcionalmente.
        AnclaFenologica(FaseOperativa.reposo_invernal, 6, 15),
        AnclaFenologica(FaseOperativa.lloro, 9, 5),
        AnclaFenologica(FaseOperativa.brotacion, 9, 28),      # estimado
        AnclaFenologica(FaseOperativa.floracion, 11, 12),     # informe (rango 10-15/11)
        AnclaFenologica(FaseOperativa.cuaje, 11, 18),         # estimado
        AnclaFenologica(FaseOperativa.grano_arveja, 11, 28),  # estimado
        AnclaFenologica(FaseOperativa.envero, 12, 20),        # estimado
        AnclaFenologica(FaseOperativa.madurez, 1, 2),         # estimado
        AnclaFenologica(FaseOperativa.cosecha, 1, 10),        # informe (inicio del rango 10/1-20/2)
        AnclaFenologica(FaseOperativa.post_cosecha, 2, 5),    # estimado
    ],
    VariedadUva.fiesta: [
        # Ciclo corto y muy acelerado; brota después que Sultanina. Cosecha
        # 4-10/ene, 10-15 días antes que Sultanina.
        AnclaFenologica(FaseOperativa.reposo_invernal, 6, 1),
        AnclaFenologica(FaseOperativa.lloro, 8, 28),
        AnclaFenologica(FaseOperativa.brotacion, 9, 22),      # estimado, algo posterior a Sultanina
        AnclaFenologica(FaseOperativa.floracion, 10, 14),     # estimado
        AnclaFenologica(FaseOperativa.cuaje, 10, 20),         # estimado
        AnclaFenologica(FaseOperativa.grano_arveja, 11, 10),  # estimado
        AnclaFenologica(FaseOperativa.envero, 12, 5),         # estimado
        AnclaFenologica(FaseOperativa.madurez, 12, 25),       # estimado
        AnclaFenologica(FaseOperativa.cosecha, 1, 7),         # informe (rango 4-10/ene)
        AnclaFenologica(FaseOperativa.post_cosecha, 1, 20),   # estimado
    ],
    VariedadUva.sultanina: [
        # No está en el informe detallado; calendario típico San Juan para
        # uva de pasa (Thompson Seedless), similar timing a Red Globe.
        AnclaFenologica(FaseOperativa.reposo_invernal, 6, 1),
        AnclaFenologica(FaseOperativa.lloro, 8, 20),
        AnclaFenologica(FaseOperativa.brotacion, 9, 12),      # estimado
        AnclaFenologica(FaseOperativa.floracion, 10, 8),      # estimado
        AnclaFenologica(FaseOperativa.cuaje, 10, 14),         # estimado
        AnclaFenologica(FaseOperativa.grano_arveja, 11, 5),   # estimado
        AnclaFenologica(FaseOperativa.envero, 12, 18),        # estimado
        AnclaFenologica(FaseOperativa.madurez, 1, 15),        # estimado
        AnclaFenologica(FaseOperativa.cosecha, 2, 10),        # estimado
        AnclaFenologica(FaseOperativa.post_cosecha, 2, 25),   # estimado
    ],
    VariedadUva.bonarda: [
        # Ciclo marcadamente largo (informe); necesita zonas cálidas para
        # llegar a 220 g/L. Sin fecha exacta de cosecha en el informe: se
        # estima marzo, típico de Bonarda en San Juan.
        AnclaFenologica(FaseOperativa.reposo_invernal, 6, 10),
        AnclaFenologica(FaseOperativa.lloro, 9, 5),
        AnclaFenologica(FaseOperativa.brotacion, 9, 28),      # estimado
        AnclaFenologica(FaseOperativa.floracion, 11, 15),     # estimado
        AnclaFenologica(FaseOperativa.cuaje, 11, 22),         # estimado
        AnclaFenologica(FaseOperativa.grano_arveja, 12, 15),  # estimado
        AnclaFenologica(FaseOperativa.envero, 1, 20),         # estimado
        AnclaFenologica(FaseOperativa.madurez, 2, 15),        # estimado
        AnclaFenologica(FaseOperativa.cosecha, 3, 1),         # estimado — ciclo largo
        AnclaFenologica(FaseOperativa.post_cosecha, 3, 20),   # estimado
    ],
    VariedadUva.syrah: [
        # Cosecha manual, 2da quincena de enero en Valle de Zonda (informe).
        AnclaFenologica(FaseOperativa.reposo_invernal, 6, 5),
        AnclaFenologica(FaseOperativa.lloro, 8, 30),
        AnclaFenologica(FaseOperativa.brotacion, 9, 20),      # estimado
        AnclaFenologica(FaseOperativa.floracion, 10, 20),     # estimado
        AnclaFenologica(FaseOperativa.cuaje, 10, 27),         # estimado
        AnclaFenologica(FaseOperativa.grano_arveja, 11, 20),  # estimado (ventana clave de raleo)
        AnclaFenologica(FaseOperativa.envero, 12, 15),        # estimado
        AnclaFenologica(FaseOperativa.madurez, 1, 10),        # estimado
        AnclaFenologica(FaseOperativa.cosecha, 1, 20),        # informe (2da quincena de enero)
        AnclaFenologica(FaseOperativa.post_cosecha, 2, 5),    # estimado
    ],
    VariedadUva.aspirant: [
        # Poca fertilidad, cosecha temprana (informe, sin fecha exacta).
        AnclaFenologica(FaseOperativa.reposo_invernal, 6, 1),
        AnclaFenologica(FaseOperativa.lloro, 8, 25),
        AnclaFenologica(FaseOperativa.brotacion, 9, 18),      # estimado
        AnclaFenologica(FaseOperativa.floracion, 10, 10),     # estimado
        AnclaFenologica(FaseOperativa.cuaje, 10, 16),         # estimado
        AnclaFenologica(FaseOperativa.grano_arveja, 11, 8),   # estimado
        AnclaFenologica(FaseOperativa.envero, 12, 10),        # estimado
        AnclaFenologica(FaseOperativa.madurez, 12, 28),       # estimado
        AnclaFenologica(FaseOperativa.cosecha, 1, 10),        # estimado — "cosecha temprana"
        AnclaFenologica(FaseOperativa.post_cosecha, 1, 25),   # estimado
    ],
}


def _fecha_mas_reciente(mes: int, dia: int, hoy: date) -> date | None:
    """Construye la fecha (mes, dia) más cercana a `hoy` sin superarla,
    probando el año anterior, el actual y el siguiente (maneja el
    "wraparound" del ciclo anual sin acoplarse a la convención de campaña)."""
    mejor: date | None = None
    for delta in (-1, 0, 1):
        try:
            candidata = date(hoy.year + delta, mes, dia)
        except ValueError:
            continue  # 29/feb en año no bisiesto
        if candidata <= hoy and (mejor is None or candidata > mejor):
            mejor = candidata
    return mejor


def _proxima_fecha(mes: int, dia: int, hoy: date) -> date | None:
    """La próxima ocurrencia futura de (mes, dia) a partir de `hoy`."""
    for delta in (0, 1):
        try:
            candidata = date(hoy.year + delta, mes, dia)
        except ValueError:
            continue
        if candidata > hoy:
            return candidata
    return None


def calcular_fase(variedad: VariedadUva, hoy: date | None = None) -> FaseOperativa | None:
    """Fase operativa vigente para una variedad en la fecha dada.

    Devuelve None si la variedad no tiene calendario definido (ej. `otro`).
    """
    hoy = hoy or date.today()
    anclas = CALENDARIO_FENOLOGICO.get(variedad)
    if not anclas:
        return None

    candidatos = [
        (fecha, ancla.fase)
        for ancla in anclas
        if (fecha := _fecha_mas_reciente(ancla.mes, ancla.dia, hoy)) is not None
    ]
    if not candidatos:
        return None
    candidatos.sort(key=lambda item: item[0])
    return candidatos[-1][1]


def calcular_proxima_fase(
    variedad: VariedadUva, hoy: date | None = None,
) -> tuple[FaseOperativa, date] | None:
    """Próxima fase que viene y en qué fecha estimada arranca."""
    hoy = hoy or date.today()
    anclas = CALENDARIO_FENOLOGICO.get(variedad)
    if not anclas:
        return None

    candidatos = [
        (fecha, ancla.fase)
        for ancla in anclas
        if (fecha := _proxima_fecha(ancla.mes, ancla.dia, hoy)) is not None
    ]
    if not candidatos:
        return None
    candidatos.sort(key=lambda item: item[0])
    fecha, fase = candidatos[0]
    return fase, fecha


# ── Tareas recomendadas ─────────────────────────────────────────────────────
#
# Generales: sección 2 del informe (aplican a cualquier variedad).
TAREAS_GENERALES_POR_FASE: dict[FaseOperativa, list[str]] = {
    FaseOperativa.reposo_invernal: [
        "Poda seca y atada: define la carga de yemas de la próxima temporada",
        "Fertilización de fondo e incorporación de materia orgánica",
    ],
    FaseOperativa.lloro: [
        "Revisar cortes de poda: inicio del flujo de savia",
    ],
    FaseOperativa.brotacion: [
        "Desbrote: eliminar brotes mal ubicados en brazos y troncos para concentrar vigor",
        "Riego de arranque para acompañar el inicio de la actividad fotosintética",
    ],
    FaseOperativa.floracion: [
        "Controlar el riego: evitar exceso de humedad para no provocar corrimiento (mala polinización)",
        "Manejo de canopia preventivo: ventilación e iluminación sin exponer los racimos al sol",
    ],
    FaseOperativa.cuaje: [
        "Controlar el riego: evitar exceso de humedad",
        "Manejo de canopia preventivo",
    ],
    FaseOperativa.grano_arveja: [
        "Raleo y arreglo de racimos: ajustar carga por planta",
    ],
    FaseOperativa.envero: [
        "Deshoje selectivo cerca del racimo (clave en variedades tintas/rojas)",
        "Iniciar monitoreo semanal de °Brix con refractómetro",
    ],
    FaseOperativa.madurez: [
        "Monitoreo de madurez: seguimiento de °Brix para fijar el día de cosecha",
        "Evaluar suspensión de riego para concentrar compuestos y evitar dilución",
    ],
    FaseOperativa.cosecha: [
        "Coordinar cosecha",
    ],
    FaseOperativa.post_cosecha: [
        "Dejar que la planta acumule reservas (almidón, carbohidratos) antes de la caída de hojas",
        "Planificar la poda de la próxima campaña",
    ],
}

# Específicas por (variedad, fase): sección 3 del informe.
TAREAS_ESPECIFICAS: dict[tuple[VariedadUva, FaseOperativa], list[str]] = {
    (VariedadUva.red_globe, FaseOperativa.reposo_invernal): [
        "Poda corta en cordón (pitones de 2-3 yemas) o Guyot (cargadores ≤6 yemas): alta fertilidad basal",
    ],
    (VariedadUva.red_globe, FaseOperativa.grano_arveja): [
        "Aplicar GA3 recién cuando la baya supere 12 mm de diámetro (antes provoca aborto de semilla)",
        "Dejar 35-40 racimos por planta, despuntar y eliminar la primera ala, 50-60 bayas por racimo",
    ],
    (VariedadUva.red_globe, FaseOperativa.madurez): [
        "Suspender riego al alcanzar 16° Brix para cosechar",
    ],
    (VariedadUva.flame, FaseOperativa.floracion): [
        "Aplicar GA3 para raleo químico de flores (requerimiento estricto de esta variedad)",
    ],
    (VariedadUva.flame, FaseOperativa.grano_arveja): [
        "Aplicar GA3 para engorde (crecimiento) de la baya",
    ],
    (VariedadUva.fiesta, FaseOperativa.reposo_invernal): [
        "Podar con 4 a 5 yemas por sarmiento",
    ],
    (VariedadUva.bonarda, FaseOperativa.grano_arveja): [
        "Raleo de racimos estricto: reducir producción por hectárea para ganar calidad fenólica",
    ],
    (VariedadUva.syrah, FaseOperativa.grano_arveja): [
        "Ralear hasta 50% entre 20 y 44 días después del cuaje: mejora tamaño de baya y biosíntesis de fenoles/antocianos/aromas",
    ],
    (VariedadUva.syrah, FaseOperativa.cosecha): [
        "Priorizar cosecha manual temprana (2da quincena de enero en Valle de Zonda) para preservar frescura",
    ],
    (VariedadUva.aspirant, FaseOperativa.reposo_invernal): [
        "Menor exigencia sanitaria que el resto: resistente a peronóspora y Botrytis, solo oídio leve",
    ],
}

# Alertas sanitarias que se agregan solo cuando el riesgo de oídio es alto,
# en las fases donde ese riesgo es crítico (floración a envero).
FASES_RIESGO_OIDIO_CRITICO = {
    FaseOperativa.floracion, FaseOperativa.cuaje, FaseOperativa.grano_arveja,
}


def tareas_recomendadas(variedad: VariedadUva, fase: FaseOperativa) -> list[str]:
    tareas = list(TAREAS_GENERALES_POR_FASE.get(fase, []))
    tareas += TAREAS_ESPECIFICAS.get((variedad, fase), [])
    if (
        fase in FASES_RIESGO_OIDIO_CRITICO
        and RIESGO_OIDIO_POR_VARIEDAD.get(variedad) == RiesgoSanitario.alto
    ):
        tareas.append("⚠️ Riesgo alto de oídio en esta variedad: reforzar curaciones preventivas")
    return tareas


def tareas_recomendadas_por_estado(variedad: VariedadUva, estado: EstadoFenologico) -> list[str]:
    """Igual que `tareas_recomendadas`, pero a partir del estado "grueso" de
    la DB en vez de la fase fina — se usa cuando el estado viene de una
    confirmación manual (CicloCampana) y no sabemos la fase operativa exacta.
    """
    vistas: set[str] = set()
    resultado: list[str] = []
    for fase in FASES_POR_ESTADO.get(estado, []):
        for t in tareas_recomendadas(variedad, fase):
            if t not in vistas:
                vistas.add(t)
                resultado.append(t)
    return resultado
