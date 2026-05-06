#!/usr/bin/env python3
"""stop hook: scan the transcript for "rememberable" patterns and queue proposals.

does NOT auto-write to the brain. instead, drafts brain_remember
payloads and appends them to ~/.cache/claude-brain/proposals-<sid>.jsonl
via brain-cli propose. the next session start surfaces them so matt
stays in the loop.

patterns we look for:
  - user corrections: "no", "don't", "stop", "wrong", "i told you", "we don't"
  - validated approaches: "yes exactly", "perfect", "keep doing that"
  - multi-attempt fixes: same file edited 3+ times, "still broken", "regression"
  - decisions stated by claude or accepted: "going with X because Y"
"""

import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _brain_common import (
    brain_cli_path,
    is_quiet,
    read_payload,
    session_id_from_payload,
)

CORRECTION_PATTERNS = [
    re.compile(r"\b(no,? don'?t|stop doing|i told you|that'?s wrong|you got it wrong|we don'?t)\b", re.I),
    re.compile(r"\b(don'?t do that|never do that)\b", re.I),
]

VALIDATED_PATTERNS = [
    re.compile(r"\b(yes,? exactly|perfect|keep doing that|that'?s right)\b", re.I),
]

REGRESSION_PATTERNS = [
    re.compile(r"\b(still broken|regression|same bug|broke (it )?again)\b", re.I),
]

DECISION_PATTERNS = [
    re.compile(r"\bgoing with (\S+) because\b", re.I),
    re.compile(r"\bdecided to (\S+) because\b", re.I),
]


def iter_user_messages(transcript: list) -> list[str]:
    out: list[str] = []
    for entry in transcript:
        if not isinstance(entry, dict):
            continue
        if entry.get("type") not in ("user", "human"):
            continue
        msg = entry.get("message") or entry.get("content") or ""
        if isinstance(msg, dict):
            msg = msg.get("content", "")
        if isinstance(msg, list):
            msg = " ".join(str(p) for p in msg)
        if isinstance(msg, str) and msg.strip():
            out.append(msg.strip())
    return out


def iter_edited_files(transcript: list) -> Counter:
    counts: Counter = Counter()
    for entry in transcript:
        if not isinstance(entry, dict):
            continue
        tool = entry.get("tool") or entry.get("tool_name") or ""
        if tool not in ("Edit", "Write", "MultiEdit"):
            continue
        path = (entry.get("tool_input") or {}).get("file_path")
        if path:
            counts[path] += 1
    return counts


def queue_proposal(category: str, title: str, body: str, session_id: str, tags: list[str]) -> None:
    cli = brain_cli_path()
    if not cli:
        return
    cmd = cli.split() + [
        "propose",
        "--category", category,
        "--title", title,
        "--body", body,
        "--session-id", session_id,
    ]
    for t in tags:
        cmd += ["--tag", t]
    try:
        subprocess.run(cmd, capture_output=True, text=True, timeout=4.0, check=False)
    except (subprocess.TimeoutExpired, OSError):
        return


def main() -> None:
    if is_quiet():
        return
    payload = read_payload()
    session_id = session_id_from_payload(payload)
    transcript = payload.get("transcript") or payload.get("messages") or []
    if not isinstance(transcript, list) or not transcript:
        return

    user_msgs = iter_user_messages(transcript)
    full_text = "\n".join(user_msgs)
    proposed = 0

    # corrections -> standards
    for pat in CORRECTION_PATTERNS:
        m = pat.search(full_text)
        if m:
            ctx = full_text[max(0, m.start() - 80): m.end() + 200]
            queue_proposal(
                "standards",
                f"Correction: {m.group(0)[:60]}",
                f"What: user pushed back during a session.\nWhy: avoid repeating the mistake.\nEvidence: \"{ctx.strip()[:600]}\"",
                session_id,
                ["auto-proposed", "stop-hook"],
            )
            proposed += 1
            break

    # decisions -> decisions
    for pat in DECISION_PATTERNS:
        m = pat.search(full_text)
        if m:
            ctx = full_text[max(0, m.start() - 80): m.end() + 200]
            queue_proposal(
                "decisions",
                f"Decision: {m.group(0)[:60]}",
                f"What: chose an approach during the session.\nWhy: rationale captured inline.\nEvidence: \"{ctx.strip()[:600]}\"",
                session_id,
                ["auto-proposed", "stop-hook"],
            )
            proposed += 1
            break

    # regressions -> lessons
    for pat in REGRESSION_PATTERNS:
        m = pat.search(full_text)
        if m:
            ctx = full_text[max(0, m.start() - 80): m.end() + 200]
            queue_proposal(
                "lessons",
                f"Regression observed: {m.group(0)[:60]}",
                f"What: a regression or repeat-bug surfaced mid-session.\nWhy: postmortem-worthy if the cause is non-obvious.\nEvidence: \"{ctx.strip()[:600]}\"",
                session_id,
                ["auto-proposed", "stop-hook"],
            )
            proposed += 1
            break

    # multi-attempt edits -> lessons
    edits = iter_edited_files(transcript)
    for path, count in edits.most_common(1):
        if count >= 3:
            queue_proposal(
                "lessons",
                f"Multi-attempt fix: {Path(path).name}",
                f"What: {path} was edited {count} times in one session.\nWhy: likely a tricky bit worth a postmortem.\nEvidence: file edited {count}x in session {session_id}.",
                session_id,
                ["auto-proposed", "stop-hook"],
            )
            proposed += 1

    # validated approaches -> drafts (lower bar, just so matt sees the pattern)
    for pat in VALIDATED_PATTERNS:
        m = pat.search(full_text)
        if m and proposed == 0:
            ctx = full_text[max(0, m.start() - 80): m.end() + 200]
            queue_proposal(
                "drafts",
                f"Validated approach: {m.group(0)[:60]}",
                f"What: user explicitly approved an approach.\nWhy: reusable pattern.\nEvidence: \"{ctx.strip()[:600]}\"",
                session_id,
                ["auto-proposed", "stop-hook"],
            )
            break


if __name__ == "__main__":
    main()
