#!/usr/bin/env python3
"""pre_tool_use hook (Edit/Write): file-context recall.

triggered before claude runs an edit or write. resolves the target
file's repo root, and if there's a /Apps/<reponame> note, injects its
key lines so any standing rule for that app applies before the edit.

throttled per-session via a lock file so we don't spam additionalContext
on every keystroke.
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _brain_common import (
    CACHE_DIR,
    emit_context,
    find_repo_root,
    format_recall,
    is_quiet,
    read_payload,
    run_cli,
    session_id_from_payload,
)

THROTTLE_SECONDS = 60


def throttle_ok(session_id: str, repo_name: str) -> bool:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    lock = CACHE_DIR / f"edit-lock-{session_id}-{repo_name}.txt"
    now = time.time()
    if lock.exists() and (now - lock.stat().st_mtime) < THROTTLE_SECONDS:
        return False
    lock.write_text(str(now), encoding="utf-8")
    return True


def main() -> None:
    payload = read_payload()
    tool_input = payload.get("tool_input") or {}
    file_path = tool_input.get("file_path") or tool_input.get("path")
    if not file_path:
        return

    target = Path(file_path)
    repo = find_repo_root(target if target.exists() else target.parent)
    if not repo:
        return
    if is_quiet(repo):
        return

    session_id = session_id_from_payload(payload)
    repo_name = repo.name
    if not throttle_ok(session_id, repo_name):
        return

    result = run_cli(["recall", "--query", repo_name, "--category", "apps", "--limit", "1"])
    if not result:
        return
    block = format_recall(repo_name, result, max_lines=1)
    if block:
        emit_context(block)


if __name__ == "__main__":
    main()
