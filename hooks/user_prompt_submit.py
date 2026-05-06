#!/usr/bin/env python3
"""user_prompt_submit hook: keyword-triggered recall.

scans the user's prompt for app names, well-known tech keywords, or
"how do we / what's our standard" phrases, then pulls the top 2 brain
matches per trigger and injects them as additionalContext. dedups
against context already injected by session_start so we don't repeat
ourselves.
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _brain_common import (
    already_injected,
    emit_context,
    format_recall,
    is_quiet,
    load_apps_cache,
    mark_injected,
    read_payload,
    run_cli,
    session_id_from_payload,
)

TECH_KEYWORDS = {
    "fleet", "nginx", "docker", "postgres", "mysql", "mongodb", "redis",
    "webauthn", "csp", "ssrf", "rate-limit", "rate limit", "cors", "csrf",
    "trilium", "srag", "guardian", "systemd", "compose", "github", "ssh",
    "cloudflare", "namecheap", "stripe", "nginx", "utopia", "utopiajs",
}

STANDARD_PHRASES = [
    re.compile(r"\bhow do we\b", re.I),
    re.compile(r"\bhow should i\b", re.I),
    re.compile(r"\bwhat'?s our standard\b", re.I),
    re.compile(r"\bwhat'?s the convention\b", re.I),
    re.compile(r"\bbest practice\b", re.I),
    re.compile(r"\bremember\b", re.I),
]


def extract_triggers(prompt: str, app_names: list[str]) -> list[tuple[str, str]]:
    """return list of (kind, query) tuples; kind is one of apps, tech, phrase."""
    triggers: list[tuple[str, str]] = []
    seen: set[str] = set()
    lowered = prompt.lower()

    for app in app_names:
        if not app:
            continue
        # word-boundary match so "macpool" matches but "macpooling" doesn't
        if re.search(rf"\b{re.escape(app)}\b", lowered):
            key = f"apps:{app}"
            if key not in seen:
                triggers.append(("apps", app))
                seen.add(key)

    for kw in TECH_KEYWORDS:
        if re.search(rf"\b{re.escape(kw)}\b", lowered):
            key = f"tech:{kw}"
            if key not in seen:
                triggers.append(("tech", kw))
                seen.add(key)

    for pat in STANDARD_PHRASES:
        if pat.search(prompt):
            # extract the noun-ish chunk after the phrase as the query
            m = pat.search(prompt)
            if m:
                tail = prompt[m.end(): m.end() + 80].strip(" ?.,;:")
                if tail:
                    key = f"phrase:{tail.lower()[:40]}"
                    if key not in seen:
                        triggers.append(("phrase", tail.split("\n")[0][:80]))
                        seen.add(key)

    return triggers[:5]  # cap to avoid blowing up the context window


def main() -> None:
    if is_quiet():
        return
    payload = read_payload()
    prompt = payload.get("prompt") or payload.get("message") or ""
    if not prompt:
        return

    session_id = session_id_from_payload(payload)
    apps = load_apps_cache()
    triggers = extract_triggers(prompt, apps)
    if not triggers:
        return

    blocks: list[str] = []
    for kind, query in triggers:
        marker = f"{kind}:{query.lower()}"
        if already_injected(session_id, marker):
            continue
        category = "apps" if kind == "apps" else None
        args = ["recall", "--query", query, "--limit", "2"]
        if category:
            args += ["--category", category]
        result = run_cli(args)
        if not result:
            continue
        block = format_recall(query, result, max_lines=2)
        if block:
            blocks.append(block)
            mark_injected(session_id, marker)

    if blocks:
        emit_context("\n\n".join(blocks))


if __name__ == "__main__":
    main()
