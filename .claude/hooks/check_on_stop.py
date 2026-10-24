"""Stop hook: when Claude finishes a turn, verify the parts of the repo that changed.

Runs backend pytest, frontend lint and mobile tsc only for areas with uncommitted
changes, and only when the changes differ from the last run that passed (cached by
a hash of `git diff`), so an idle turn costs nothing. On failure it blocks the stop
and hands the error tail back to Claude so it fixes the problem before finishing.
"""
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path(tempfile.gettempdir()) / "lirios_stop_check.json"
TAIL_LINES = 25

# area -> (path prefix that triggers it, working dir, command)
CHECKS = {
    "backend": (
        "backend/",
        ROOT / "backend",
        [str(ROOT / "backend" / "venv" / "Scripts" / "python.exe"), "-m", "pytest", "-q", "-x"],
    ),
    "frontend": ("frontend/", ROOT / "frontend", ["npm", "run", "lint"]),
    "mobile": ("mobile/", ROOT / "mobile", ["npx", "tsc", "--noEmit"]),
}


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=False)
    return result.stdout


def changed_files() -> list[str]:
    # Tracked changes plus untracked files, both relative to the repo root.
    tracked = git("diff", "--name-only", "HEAD").splitlines()
    untracked = git("ls-files", "--others", "--exclude-standard").splitlines()
    return sorted(set(tracked + untracked))


def fingerprint(files: list[str]) -> str:
    digest = hashlib.sha256(git("diff", "HEAD").encode())
    for name in files:
        path = ROOT / name
        if path.is_file():
            digest.update(name.encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()


def load_cache() -> dict:
    try:
        return json.loads(CACHE.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError:
        data = {}
    # Already continuing because of a previous block: never loop.
    if data.get("stop_hook_active"):
        return

    files = [f for f in changed_files() if f.endswith((".py", ".ts", ".tsx", ".js", ".jsx", ".json"))]
    areas = [a for a, (prefix, _, _) in CHECKS.items() if any(f.startswith(prefix) for f in files)]
    if not areas:
        return

    cache = load_cache()
    failures: list[str] = []
    new_cache = dict(cache)
    for area in areas:
        prefix, cwd, cmd = CHECKS[area]
        area_files = [f for f in files if f.startswith(prefix)]
        key = fingerprint(area_files)
        if cache.get(area) == key:
            continue
        try:
            proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=540, shell=(cmd[0] == "npm" or cmd[0] == "npx"))
        except (OSError, subprocess.TimeoutExpired) as exc:
            failures.append(f"[{area}] no se pudo ejecutar: {exc}")
            continue
        if proc.returncode == 0:
            new_cache[area] = key
        else:
            out = (proc.stdout + proc.stderr).strip().splitlines()[-TAIL_LINES:]
            failures.append(f"[{area}] {' '.join(cmd[-3:])} falló:\n" + "\n".join(out))
    CACHE.write_text(json.dumps(new_cache))

    if failures:
        reason = "Chequeos automáticos fallaron. Corregí antes de terminar:\n\n" + "\n\n".join(failures)
        print(json.dumps({"decision": "block", "reason": reason}))


if __name__ == "__main__":
    main()
