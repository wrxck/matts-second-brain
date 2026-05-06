---
title: Smart hooks
description: Auto-recall and auto-remember via Claude Code hooks — the plugin's showcase feature.
---

The plugin ships four [Claude Code hooks](https://docs.claude.com/en/docs/agents-and-tools/claude-code/hooks) under `hooks/`. They turn the brain from a thing you remember to call into a thing that's just *there* — surfacing the right note before you ask, and proposing what's worth remembering after you stop.

## Why hooks?

The MCP tools (`brain_recall`, `brain_remember`) are great when you remember to invoke them. But the value of a second brain compounds when it's automatic — when Claude inherits your standards on session one, line one, without you typing `/matts-second-brain:recall`.

Hooks run as small Python scripts at well-defined points in Claude's lifecycle. They read a JSON payload from stdin, talk to the brain via the `brain` CLI, and emit `additionalContext` JSON on stdout. Claude treats the result the same as any user-supplied context.

## The four hooks

### `session_start.py` — opportunistic recall

Triggered: every new Claude session.

Behaviour:
- Reads `cwd` from the hook payload.
- Derives a likely "app name" from `basename(cwd)`.
- Calls `brain recall --query <app> --category apps --limit 3`.
- Calls `brain recall --query <app> --category standards --limit 3`.
- Surfaces any pending proposals queued by the previous session's Stop hook.
- Emits citations as `additionalContext` so Claude's discipline rules apply.

### `user_prompt_submit.py` — keyword-triggered recall

Triggered: every user prompt, before Claude sees it.

Behaviour:
- Maintains a cache of `/Apps/<X>` titles at `~/.cache/claude-brain/apps.txt` (refreshed hourly).
- Scans the prompt for app names, a curated list of tech keywords (`fleet`, `nginx`, `docker`, `webauthn`, `csp`, `ssrf`, `rate-limit`, ...), and "how do we" / "what's our standard" phrases.
- For each trigger, runs `brain recall --query <trigger> --limit 2`.
- Dedups against any context already injected by `session_start.py` (per-session marker file in `~/.cache/claude-brain/`).
- Quiet on no match — never adds empty noise.

### `stop.py` — propose auto-remember on session end

Triggered: when Claude stops responding.

Behaviour:
- Receives the full session transcript in the payload.
- Scans for "rememberable" patterns:
  - **Corrections** ("no don't", "I told you", "we don't") → `Standards/` proposal.
  - **Decisions** ("going with X because Y") → `Decisions/` proposal.
  - **Regressions** ("still broken", "regression", "broke it again") → `Lessons Learned/` proposal.
  - **Multi-attempt fixes** (same file edited 3+ times) → `Lessons Learned/` proposal.
  - **Validated approaches** ("yes exactly", "perfect") → `Drafts/` proposal.
- For each match, drafts a `brain_propose` payload and queues it in `~/.cache/claude-brain/proposals-<sessionId>.jsonl`.
- **Never auto-writes** to the brain. Silent auto-writes degrade brain quality; surfaced proposals keep you in the loop.

### `pre_tool_use_edit.py` — file-context recall

Triggered: before Edit, Write, or MultiEdit tool invocations.

Behaviour:
- Resolves the target file's repo (walks up looking for `.git`).
- If a `/Apps/<reponame>` note exists, recalls its key lines and injects them.
- Throttled to once per minute per repo per session — won't spam context on every keystroke.

## The proposals workflow

This is the cleverest bit, and worth understanding:

1. During a session, Claude does work. The Stop hook scans the transcript and identifies things that *might* be worth remembering. It writes them to a queue file.
2. **It does not call `brain_remember`.** No silent writes.
3. Next session, `session_start.py` sees the queue and tells Claude: "3 brain proposal(s) pending review from a previous session."
4. You (or Claude, with your approval) call `brain_review_proposals`. The MCP tool lists the queued drafts.
5. For each one worth keeping, Claude calls `brain_remember` with the (possibly tweaked) payload. The rest are dropped with `drain=true`.

The result: the brain stays high-signal, and you see every write before it lands.

## Opt-outs

The hooks early-exit silently in three cases:

| Scope | Trigger |
|---|---|
| **Per shell** | `BRAIN_QUIET=1` env var |
| **Per user** | `~/.claude/.brain-quiet` exists (any content) |
| **Per repo** | `<repo>/.brain-ignore` exists (any content) |

Use the per-repo opt-out for throwaway sandboxes, code-golf scratchpads, or anywhere the auto-recall would be more noise than signal.

## The `brain` CLI

The hooks call into a thin synchronous CLI rather than spinning up the MCP stdio server (which would add ~200ms of startup per call). The CLI wraps the same `BrainAdapter` factory:

```sh
brain recall    --query "git workflow" [--category standards] [--limit 5] [--json]
brain remember  --category lessons --title "..." --body-file ./body.md [--tag x]*
brain propose   --category standards --title "..." --body "..." [--session-id S]
brain proposals [--pop] [--session-id S] [--json]
brain apps      [--json]
```

Install via `npm link` from `mcp-server/` after `npm run build`, or set `BRAIN_CLI=node /path/to/mcp-server/dist/cli.js` so the hooks find it.

## Wiring into `~/.claude/settings.json`

`/matts-second-brain:install` does this for you. If you want to wire it manually:

```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "python3 <plugin>/hooks/session_start.py" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "python3 <plugin>/hooks/user_prompt_submit.py" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "python3 <plugin>/hooks/stop.py" }] }],
    "PreToolUse":       [{ "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "python3 <plugin>/hooks/pre_tool_use_edit.py" }] }]
  }
}
```

Replace `<plugin>` with the absolute path to your plugin install directory. The install skill resolves this automatically.
