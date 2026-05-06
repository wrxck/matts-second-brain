#!/usr/bin/env python3
"""session_start hook: opportunistic brain recall.

triggered when claude code starts a new session. derives a likely "app
name" from the cwd, asks the brain for any /Apps/<name> notes plus the
top standards, and injects them as additionalContext so claude has the
right reflexes from line one.

also surfaces any pending proposals queued by the previous session's
stop hook so matt can review them.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _brain_common import (
    emit_context,
    format_recall,
    is_quiet,
    mark_injected,
    read_payload,
    run_cli,
    session_id_from_payload,
)


def main() -> None:
    payload = read_payload()
    cwd = Path(payload.get("cwd") or Path.cwd())
    if is_quiet(cwd):
        return

    session_id = session_id_from_payload(payload)
    app_name = cwd.name

    blocks: list[str] = []

    # per-app context (top 3)
    if app_name:
        result = run_cli(["recall", "--query", app_name, "--category", "apps", "--limit", "3"])
        if result:
            block = format_recall(app_name, result, max_lines=3)
            if block:
                blocks.append(block)
                mark_injected(session_id, f"apps:{app_name}")

    # standards (top 3) — useful in any session
    standards = run_cli(["recall", "--query", app_name or "standards", "--category", "standards", "--limit", "3"])
    if standards:
        block = format_recall("standards", standards, max_lines=3)
        if block:
            blocks.append(block)
            mark_injected(session_id, "standards:top")

    # pending proposals from a previous session
    proposals = run_cli(["proposals"])
    if proposals and proposals.get("proposals"):
        count = len(proposals["proposals"])
        sample = proposals["proposals"][:3]
        lines = [
            f"{count} brain proposal(s) pending review from a previous session:",
        ]
        for p in sample:
            lines.append(f"  - [{p.get('category')}] {p.get('title')}")
        lines.append("Run brain_review_proposals to see all and act on them.")
        blocks.append("\n".join(lines))

    if blocks:
        emit_context("\n\n".join(blocks))


if __name__ == "__main__":
    main()
