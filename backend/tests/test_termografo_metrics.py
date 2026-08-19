"""Tests for the pure metric functions in app.core.termografo_metrics, using
small synthetic datasets -- no DB involved."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from app.core.termografo_metrics import (
    Lectura,
    amplitud_termica_diaria_promedio,
    eventos_helada,
    gdd_acumulado,
    horas_bajo_cero,
    horas_de_frio,
    horas_riesgo_fungico,
    horas_sobre_30,
    intervalo_efectivo_seg,
)

TZ = ZoneInfo("America/Argentina/San_Juan")


def _l(hora: str, temp: str, hum: str = "50.0") -> Lectura:
    return Lectura(
        fecha_hora=datetime.fromisoformat(f"2026-06-01T{hora}").replace(tzinfo=TZ),
        temperatura=Decimal(temp),
        humedad=Decimal(hum),
    )


def test_sin_lecturas_devuelve_cero_u_none():
    assert horas_bajo_cero([], 900) == 0.0
    assert horas_sobre_30([], 900) == 0.0
    assert gdd_acumulado([]) == Decimal("0")
    assert amplitud_termica_diaria_promedio([]) is None
    assert eventos_helada([], 900) == []


def test_horas_bajo_cero_usa_delta_real_hasta_siguiente_lectura():
    # 3 lecturas cada 15 min (900s), 2 bajo cero consecutivas -> 30 min = 0.5h
    lecturas = [_l("00:00:00", "-1.0"), _l("00:15:00", "-0.5"), _l("00:30:00", "1.0")]
    assert horas_bajo_cero(lecturas, 900) == 0.5


def test_horas_bajo_cero_no_infla_a_traves_de_un_hueco_de_datos():
    # Hueco de 10 horas entre la 2da y 3ra lectura -- muy por encima de
    # MAX_GAP_MULTIPLIER x 900s (1h) -- no debe contarse como "bajo cero".
    lecturas = [
        _l("00:00:00", "-1.0"),
        _l("00:15:00", "-0.5"),
        _l("10:15:00", "-0.2"),
    ]
    horas = horas_bajo_cero(lecturas, 900)
    # Las 3 lecturas están bajo cero. La 1ra aporta su delta real hasta la 2da
    # (15 min); la 2da cae en el hueco de 10h y usa el intervalo nominal (15
    # min) en vez del hueco real; la 3ra (última) también usa el nominal.
    # 0.25h + 0.25h + 0.25h = 0.75h -- el hueco de 10h nunca se suma entero.
    assert horas == 0.75


def test_horas_sobre_30():
    lecturas = [_l("12:00:00", "31.0"), _l("12:15:00", "32.0"), _l("12:30:00", "25.0")]
    assert horas_sobre_30(lecturas, 900) == 0.5


def test_horas_de_frio_rango_0_a_7():
    lecturas = [_l("03:00:00", "3.0"), _l("03:15:00", "8.0")]
    assert horas_de_frio(lecturas, 900) == 0.25


def test_horas_riesgo_fungico_requiere_ambas_condiciones():
    lecturas = [
        _l("06:00:00", "20.0", "85.0"),  # cumple
        _l("06:15:00", "20.0", "50.0"),  # humedad insuficiente
        _l("06:30:00", "30.0", "90.0"),  # temp fuera de rango
    ]
    assert horas_riesgo_fungico(lecturas, 900) == 0.25


def test_gdd_acumulado_promedia_por_dia_y_resta_base():
    # Día 1: promedio 15 -> GDD 5. Día 2: promedio 8 (bajo base) -> GDD 0.
    lecturas = [
        _l("00:00:00", "10.0"),
        _l("12:00:00", "20.0"),
        Lectura(
            fecha_hora=datetime.fromisoformat("2026-06-02T00:00:00").replace(tzinfo=TZ),
            temperatura=Decimal("8.0"),
            humedad=Decimal("50.0"),
        ),
    ]
    assert gdd_acumulado(lecturas) == Decimal("5.0")


def test_amplitud_termica_diaria_promedio():
    lecturas = [_l("00:00:00", "5.0"), _l("14:00:00", "25.0")]
    assert amplitud_termica_diaria_promedio(lecturas) == Decimal("20.0")


def test_eventos_helada_agrupa_consecutivas_y_reporta_minima():
    lecturas = [
        _l("00:00:00", "-1.0"),
        _l("00:15:00", "-3.0"),
        _l("00:30:00", "-0.5"),
        _l("00:45:00", "1.0"),  # corta el evento
        _l("01:00:00", "-0.1"),  # nuevo evento
    ]
    eventos = eventos_helada(lecturas, 900)
    assert len(eventos) == 2
    assert eventos[0].minima == Decimal("-3.0")
    assert eventos[0].duracion_horas == 0.5
    assert eventos[1].minima == Decimal("-0.1")


def test_eventos_helada_tolera_hueco_corto_dentro_del_mismo_evento():
    lecturas = [
        _l("00:00:00", "-1.0"),
        _l("00:45:00", "-2.0"),  # hueco de 45 min, dentro de 4x900s=1h -> mismo evento
    ]
    eventos = eventos_helada(lecturas, 900)
    assert len(eventos) == 1


def test_intervalo_efectivo_seg_usa_mediana_de_deltas():
    lecturas = [_l("00:00:00", "10.0"), _l("00:15:00", "10.0"), _l("00:30:00", "10.0")]
    assert intervalo_efectivo_seg(lecturas) == 900


def test_intervalo_efectivo_seg_con_menos_de_2_lecturas_usa_default():
    assert intervalo_efectivo_seg([], 900) == 900
    assert intervalo_efectivo_seg([_l("00:00:00", "10.0")]) == 900
