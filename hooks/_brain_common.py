"""shared helpers for the matts-second-brain claude code hooks.

each hook (session_start, user_prompt_submit, stop, pre_tool_use_edit)
is a thin script that reads the hook json payload from stdin, decides
whether to call brain-cli, and emits an additionalContext json block
on stdout. all of them must early-exit silently on opt-out.
"""

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

CACHE_DIR = Path.home() / ".cache" / "claude-brain"
QUIET_FLAG = Path.home() / ".claude" / ".brain-quiet"
APPS_CACHE = CACHE_DIR / "apps.txt"
APPS_TTL_SECONDS = 3600  # one hour


def is_quiet(repo_root: Path | None = None) -> bool:
    """true if the user opted out globally or per-repo."""
    if os.environ.get("BRAIN_QUIET") == "1":
        return True
    if QUIET_FLAG.exists():
        return True
    if repo_root and (repo_root / ".brain-ignore").exists():
        return True
    return False


def find_repo_root(start: Path) -> Path | None:
    """walk up looking for .git; return None if not in a repo."""
    cur = start.resolve()
    for _ in range(20):
        if (cur / ".git").exists():
            return cur
        if cur.parent == cur:
            return None
        cur = cur.parent
    return None


def brain_cli_path() -> str | None:
    """resolve the brain cli binary; honour BRAIN_CLI override."""
    override = os.environ.get("BRAIN_CLI")
    if override and Path(override).exists():
        return override
    on_path = shutil.which("brain")
    if on_path:
        return on_path
    # fallback to the dist cli.js relative to this file's plugin install
    here = Path(__file__).resolve().parent
    candidate = here.parent / "mcp-server" / "dist" / "cli.js"
    if candidate.exists():
        return f"node {candidate}"
    return None


def run_cli(args: list[str], timeout: float = 5.0) -> dict | None:
    """invoke brain-cli with --json; return parsed dict or None on failure."""
    cli = brain_cli_path()
    if not cli:
        return None
    cmd = cli.split() + args + ["--json"]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        if proc.returncode != 0 or not proc.stdout.strip():
            return None
        return json.loads(proc.stdout.strip().splitlines()[-1])
    except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError):
        return None


def read_payload() -> dict:
    """read the hook json payload from stdin; never throws."""
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            return {}
        return json.loads(raw)
    except (json.JSONDecodeError, OSError):
        return {}


def emit_context(text: str) -> None:
    """emit an additionalContext json block; quiet on empty."""
    if not text or not text.strip():
        return
    sys.stdout.write(json.dumps({"additionalContext": text}) + "\n")


def session_id_from_payload(payload: dict) -> str:
    sid = payload.get("session_id") or payload.get("sessionId")
    if sid:
        return str(sid)[:32]
    return "default"


def injected_marker(session_id: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / f"injected-{session_id}.txt"


def already_injected(session_id: str, key: str) -> bool:
    f = injected_marker(session_id)
    if not f.exists():
        return False
    return key in f.read_text(encoding="utf-8").splitlines()


def mark_injected(session_id: str, key: str) -> None:
    f = injected_marker(session_id)
    with f.open("a", encoding="utf-8") as fh:
        fh.write(key + "\n")


def load_apps_cache() -> list[str]:
    """app names from /Apps/<X> notes, refreshed hourly."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    fresh = APPS_CACHE.exists() and (time.time() - APPS_CACHE.stat().st_mtime) < APPS_TTL_SECONDS
    if not fresh:
        result = run_cli(["apps"], timeout=4.0)
        if result and isinstance(result.get("apps"), list):
            APPS_CACHE.write_text("\n".join(result["apps"]), encoding="utf-8")
    if APPS_CACHE.exists():
        return [line.strip().lower() for line in APPS_CACHE.read_text(encoding="utf-8").splitlines() if line.strip()]
    return []


def format_recall(query: str, payload: dict, max_lines: int = 3) -> str:
    """format brain-cli recall json into a human-readable additionalContext block."""
    results = payload.get("results") if isinstance(payload, dict) else None
    if not results:
        return ""
    lines = [f"Per Trilium recall for '{query}':"]
    for r in results[:max_lines]:
        path = r.get("path") or r.get("title") or r.get("id")
        excerpt = (r.get("excerpt") or "").replace("\n", " ").strip()
        if excerpt:
            lines.append(f"  - {path}: {excerpt[:200]}")
        else:
            lines.append(f"  - {path}")
    return "\n".join(lines)
