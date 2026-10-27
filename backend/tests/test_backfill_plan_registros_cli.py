"""Confirmation prompt of scripts/migracion/backfill_plan_registros.py before
writing to a non-local database."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "migracion" / "backfill_plan_registros.py"
_spec = importlib.util.spec_from_file_location("backfill_plan_registros", _SCRIPT)
cli = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cli)


def _respuestas(*valores):
    pendientes = list(valores)
    preguntas: list[str] = []

    def leer(prompt: str) -> str:
        preguntas.append(prompt)
        return pendientes.pop(0)

    return leer, preguntas


def test_local_no_pregunta():
    leer, preguntas = _respuestas()
    cli.confirmar_apply("localhost", local=True, leer=leer)
    assert preguntas == []


def test_remoto_con_si_continua(capsys):
    leer, preguntas = _respuestas("SI")
    cli.confirmar_apply("db.example.net", local=False, leer=leer)
    assert len(preguntas) == 1
    assert "db.example.net" in capsys.readouterr().out


@pytest.mark.parametrize("respuesta", ["", "si", "s", "yes", "NO", " SI x"])
def test_remoto_sin_si_aborta_con_codigo_1(respuesta):
    leer, _ = _respuestas(respuesta)
    with pytest.raises(SystemExit) as exc:
        cli.confirmar_apply("db.example.net", local=False, leer=leer)
    assert exc.value.code == 1


def test_remoto_sin_stdin_aborta():
    def leer(_prompt: str) -> str:
        raise EOFError

    with pytest.raises(SystemExit) as exc:
        cli.confirmar_apply("db.example.net", local=False, leer=leer)
    assert exc.value.code == 1
