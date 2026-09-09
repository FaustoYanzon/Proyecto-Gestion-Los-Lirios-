"""Estados fenológicos, tareas recomendadas y riesgo sanitario por variedad.

Unificado 2026-09-08: antes este módulo tenía su propio calendario "fino" por
variedad (10 fases, con Reposo invernal/Lloro/Grano de arveja/Madurez
distintos del enum grueso de la DB), separado del calendario único que ya
usa el mapa (`app.core.ciclo_campana`, 7 estados: Brotación, Floración,
Cuaje, Cierre de Racimo, Envero, Cosecha, Post-Cosecha). Fausto pidió dejar
un solo vocabulario — el del mapa — en todos lados (Fenología, Ciclo de
Campaña, notificaciones). El calendario (las fechas) vive ahora únicamente
en `ciclo_campana.CALENDARIO_CAMPANA`, igual para todas las variedades; este
módulo solo le da a cada (variedad, estado) sus tareas recomendadas y el
riesgo sanitario, basado en el informe agronómico de referencia (INTA San
Juan / Pocito).

`CicloCampana` (carga manual) no se elimina: sigue sirviendo como override
por variedad que un encargado puede cargar cuando confirma en el campo un
estado real distinto al calculado. Ese cruce (automático vs manual) se
resuelve en el endpoint (`app.api.produccion.fenologia_estado_actual`), no
acá.
"""

from __future__ import annotations

import enum
from datetime import date

from app.models.parcela import VariedadUva
from app.models.produccion import EstadoFenologico

# Mismos 7 nombres que ciclo_campana.ESTADO_CAMPANA_LABELS — duplicado a
# propósito (son enums Python distintos, aunque comparten valores string)
# en vez de importar cruzado; si se agrega un estado nuevo hay que tocar
# ambos diccionarios.
ESTADO_LABELS: dict[EstadoFenologico, str] = {
    EstadoFenologico.brotacion: "Brotación",
    EstadoFenologico.floracion: "Floración",
    EstadoFenologico.cuaje: "Cuaje",
    EstadoFenologico.cierre_racimo: "Cierre de Racimo",
    EstadoFenologico.envero: "Envero",
    EstadoFenologico.cosecha: "Cosecha",
    EstadoFenologico.post_cosecha: "Post-Cosecha",
}


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


def _fecha_mas_reciente(mes: int, dia: int, hoy: date) -> date | None:
    """Construye la fecha (mes, dia) más cercana a `hoy` sin superarla,
    probando el año anterior, el actual y el siguiente (maneja el
    "wraparound" del ciclo anual sin acoplarse a la convención de campaña).
    Reusado por ciclo_campana.py — es genérico, no depende de variedad."""
    mejor = None
    for delta in (-1, 0, 1):
        try:
            candidata = date(hoy.year + delta, mes, dia)
        except ValueError:
            continue  # 29/feb en año no bisiesto
        if candidata <= hoy and (mejor is None or candidata > mejor):
            mejor = candidata
    return mejor


def _proxima_fecha(mes: int, dia: int, hoy: date) -> date | None:
    """La próxima ocurrencia futura de (mes, dia) a partir de `hoy`. Reusado
    por ciclo_campana.py."""
    for delta in (0, 1):
        try:
            candidata = date(hoy.year + delta, mes, dia)
        except ValueError:
            continue
        if candidata > hoy:
            return candidata
    return None


# ── Tareas recomendadas ─────────────────────────────────────────────────────
#
# Generales: sección 2 del informe (aplican a cualquier variedad). Reposo
# invernal + Lloro + Post-Cosecha del informe original ahora son una sola
# fase larga ("Post-Cosecha", cubre todo el invierno hasta la próxima
# Brotación); Madurez se fusiona en Envero (que ya se extiende hasta
# Cosecha); Grano de arveja pasa a llamarse Cierre de Racimo (mismo momento
# agronómico: las bayas se tocan entre sí, justo después del cuaje).
TAREAS_GENERALES_POR_FASE: dict[EstadoFenologico, list[str]] = {
    EstadoFenologico.post_cosecha: [
        "Dejar que la planta acumule reservas (almidón, carbohidratos) antes de la caída de hojas",
        "Planificar la poda de la próxima campaña",
        "Poda seca y atada: define la carga de yemas de la próxima temporada",
        "Fertilización de fondo e incorporación de materia orgánica",
        "Revisar cortes de poda: inicio del flujo de savia",
    ],
    EstadoFenologico.brotacion: [
        "Desbrote: eliminar brotes mal ubicados en brazos y troncos para concentrar vigor",
        "Riego de arranque para acompañar el inicio de la actividad fotosintética",
    ],
    EstadoFenologico.floracion: [
        "Controlar el riego: evitar exceso de humedad para no provocar corrimiento (mala polinización)",
        "Manejo de canopia preventivo: ventilación e iluminación sin exponer los racimos al sol",
    ],
    EstadoFenologico.cuaje: [
        "Controlar el riego: evitar exceso de humedad",
        "Manejo de canopia preventivo",
    ],
    EstadoFenologico.cierre_racimo: [
        "Raleo y arreglo de racimos: ajustar carga por planta",
    ],
    EstadoFenologico.envero: [
        "Deshoje selectivo cerca del racimo (clave en variedades tintas/rojas)",
        "Iniciar monitoreo semanal de °Brix con refractómetro",
        "Monitoreo de madurez: seguimiento de °Brix para fijar el día de cosecha",
        "Evaluar suspensión de riego para concentrar compuestos y evitar dilución",
    ],
    EstadoFenologico.cosecha: [
        "Coordinar cosecha",
    ],
}

# Específicas por (variedad, estado): sección 3 del informe.
TAREAS_ESPECIFICAS: dict[tuple[VariedadUva, EstadoFenologico], list[str]] = {
    (VariedadUva.red_globe, EstadoFenologico.post_cosecha): [
        "Poda corta en cordón (pitones de 2-3 yemas) o Guyot (cargadores ≤6 yemas): alta fertilidad basal",
    ],
    (VariedadUva.red_globe, EstadoFenologico.cierre_racimo): [
        "Aplicar GA3 recién cuando la baya supere 12 mm de diámetro (antes provoca aborto de semilla)",
        "Dejar 35-40 racimos por planta, despuntar y eliminar la primera ala, 50-60 bayas por racimo",
    ],
    (VariedadUva.red_globe, EstadoFenologico.envero): [
        "Suspender riego al alcanzar 16° Brix para cosechar",
    ],
    (VariedadUva.flame, EstadoFenologico.floracion): [
        "Aplicar GA3 para raleo químico de flores (requerimiento estricto de esta variedad)",
    ],
    (VariedadUva.flame, EstadoFenologico.cierre_racimo): [
        "Aplicar GA3 para engorde (crecimiento) de la baya",
    ],
    (VariedadUva.fiesta, EstadoFenologico.post_cosecha): [
        "Podar con 4 a 5 yemas por sarmiento",
    ],
    (VariedadUva.bonarda, EstadoFenologico.cierre_racimo): [
        "Raleo de racimos estricto: reducir producción por hectárea para ganar calidad fenólica",
    ],
    (VariedadUva.syrah, EstadoFenologico.cierre_racimo): [
        "Ralear hasta 50% entre 20 y 44 días después del cuaje: mejora tamaño de baya y biosíntesis de fenoles/antocianos/aromas",
    ],
    (VariedadUva.syrah, EstadoFenologico.cosecha): [
        "Priorizar cosecha manual temprana (2da quincena de enero en Valle de Zonda) para preservar frescura",
    ],
    (VariedadUva.aspirant, EstadoFenologico.post_cosecha): [
        "Menor exigencia sanitaria que el resto: resistente a peronóspora y Botrytis, solo oídio leve",
    ],
}

# Alertas sanitarias que se agregan solo cuando el riesgo de oídio es alto,
# en las fases donde ese riesgo es crítico (floración a envero).
FASES_RIESGO_OIDIO_CRITICO = {
    EstadoFenologico.floracion, EstadoFenologico.cuaje, EstadoFenologico.cierre_racimo,
}


def tareas_recomendadas(variedad: VariedadUva, estado: EstadoFenologico) -> list[str]:
    tareas = list(TAREAS_GENERALES_POR_FASE.get(estado, []))
    tareas += TAREAS_ESPECIFICAS.get((variedad, estado), [])
    if (
        estado in FASES_RIESGO_OIDIO_CRITICO
        and RIESGO_OIDIO_POR_VARIEDAD.get(variedad) == RiesgoSanitario.alto
    ):
        tareas.append("⚠️ Riesgo alto de oídio en esta variedad: reforzar curaciones preventivas")
    return tareas
