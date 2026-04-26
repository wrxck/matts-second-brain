---
title: brain_scan_transcripts
description: Mine ~/.claude/projects/* for repeated corrections you can promote to Standards.
---

A read-only inference pass over your existing Claude Code session transcripts. Suggests candidate Standards (e.g. patterns where you corrected Claude with a non-obvious reason) but **never auto-writes** — you review and accept each one.

## Parameters

| Name | Type | Default | Description |
|---|---|---|---|
| `sinceDays` | number | 30 | Only consider transcripts modified in the last N days |
| `maxCandidates` | number | 20 | Cap on returned suggestions |

## Output

```
Found 3 candidate corrections from past transcripts:

  1. [home-matt-fleet] 2026-04-15T14:22:13Z
     "don't add Co-Authored-By to commits, Matt is the sole author"

  2. [home-matt-macpool] 2026-04-19T09:14:02Z
     "stop using sk_live_ keys for staging — use rk_test_ instead"

  3. [home-matt-fleet] 2026-04-22T16:33:51Z
     "never push directly to develop, always PR"

Review these and decide which to convert to Standards/. brain_remember writes the chosen ones.
```

## What it looks for

Patterns in `user` message turns that suggest a correction or rule:

- *"don't"*, *"do not"*, *"stop"*, *"never"*, *"always"*
- *"I told you"*, *"you keep"*, *"you always"*
- *"that's wrong"*, *"you got it wrong"*
- *"correct(ly)"*

It returns the matching line + project + timestamp. **It does not** judge whether the pattern is a real Standard worth recording — that's your call.

## Why it's opt-in

Transcripts are noisy. A regex pass would create dozens of low-quality notes that pollute `brain_recall`. Surfacing candidates for human review preserves signal-to-noise.

## Recommended workflow

1. Run `brain_scan_transcripts(sinceDays=90)` after first install
2. Read the candidates; pick the 3-5 that are real cross-cutting standards
3. For each: `brain_remember(category=standards, title=..., body=...)`
4. Re-run quarterly to catch newly-emerged patterns

## Privacy note

This tool reads `~/.claude/projects/*` on the local filesystem. It does **not** send transcripts to any external service. The pattern matching is local regex.
