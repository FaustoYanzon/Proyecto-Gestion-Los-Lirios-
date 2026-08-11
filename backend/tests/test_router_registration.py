"""Regression guard: every module in app.api/ that defines an APIRouter must
be included in app.main. Prevents a repeat of the 2026-08-10 incident where
the clima router existed but was never wired up with app.include_router().

Router modules are discovered via a static source scan (ast), not by
importing them -- a couple of modules in app.api (seed_cosecha.py,
seed_parcelas.py) run side-effecting code at import time (sys.exit on a
missing optional dependency), so importing everything in the package isn't
safe here.
"""
from __future__ import annotations

import ast
from pathlib import Path

import app.api as api_package
from app.main import app


def _is_router_assignment(node: ast.stmt) -> bool:
    if not isinstance(node, ast.Assign):
        return False
    if not any(isinstance(t, ast.Name) and t.id == "router" for t in node.targets):
        return False
    if not isinstance(node.value, ast.Call):
        return False
    func = node.value.func
    return (isinstance(func, ast.Name) and func.id == "APIRouter") or (
        isinstance(func, ast.Attribute) and func.attr == "APIRouter"
    )


def _discover_api_router_module_names() -> set[str]:
    """Module stems under app/api/ with a top-level `router = APIRouter(...)`."""
    package_dir = Path(api_package.__file__).parent
    names = set()
    for path in package_dir.glob("*.py"):
        if path.stem == "__init__":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        if any(_is_router_assignment(node) for node in tree.body):
            names.add(path.stem)
    return names


def test_every_api_router_is_included_in_main_app():
    discovered = _discover_api_router_module_names()
    assert discovered, "No se encontró ningún APIRouter en app.api — ¿se movió el paquete?"

    included_names = {
        route.endpoint.__module__.rsplit(".", 1)[-1]
        for route in app.routes
        if hasattr(route, "endpoint") and route.endpoint.__module__.startswith("app.api.")
    }

    missing = discovered - included_names

    assert not missing, (
        f"Los siguientes módulos definen un APIRouter pero no están "
        f"registrados vía app.include_router() en app/main.py: {sorted(missing)}"
    )
