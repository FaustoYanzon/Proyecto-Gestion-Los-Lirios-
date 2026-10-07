"""PostToolUse hook: tras editar modelos o migraciones, recuerda regenerar los docs.

Lee el JSON del hook por stdin; si el archivo tocado es un modelo/migración/router,
devuelve additionalContext para que Claude lo tenga presente. No bloquea nada.
"""
import json
import sys

WATCHED = (
    "backend/app/models/",
    "backend/app/core/migrations/versions/",
    "backend/app/api/",
)


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError:
        return
    path = str(data.get("tool_input", {}).get("file_path", "")).replace("\\", "/")
    if not any(w in path for w in WATCHED):
        return
    msg = (
        "Recordatorio: tocaste modelo/migración/router. Al terminar, regenerar docs: "
        "`python scripts/generate_modelo_datos.py` y `python scripts/generate_project_map.py` "
        "(o delegar a docs-sync). Las migraciones ya aplicadas no se editan."
    )
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": msg}}))


if __name__ == "__main__":
    main()
