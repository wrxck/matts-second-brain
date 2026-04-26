---
title: Skills
description: User-invokable commands the plugin ships.
---

Beyond the auto-loaded `_discipline` skill, three commands are user-invokable:

## `/matts-second-brain:install`

Setup wizard. Walks through:

1. Backend selection (Trilium / Obsidian / Notion)
2. Credential collection (hidden input — never echoed)
3. Trilium install (offers Docker if not already running)
4. ETAPI token generation guidance
5. MCP registration in `~/.claude.json`
6. Taxonomy seeding (calls `brain_seed_taxonomy`)
7. Optional transcript scan (`brain_scan_transcripts`)
8. Verification

Idempotent — safe to re-run after partial setups.

```
/matts-second-brain:install [--multi-user] [--scan-transcripts] [--trilium-url URL]
```

## `/matts-second-brain:recall`

Manual brain query. Use when you want Claude to consciously consult the brain before acting.

```
/matts-second-brain:recall <query>
```

Output format:

```
Brain matches for "git workflow" (5 results):
  • Standards / Git Workflow (2026-04-25, cited 12 times)
      "All PRs target develop. Main updated only via release PRs from develop."
  • Lessons Learned / 2026-04-23 — Force-push to develop
      "Force-push to develop blocked by hook because…"
  ...

Cite which? (numbers / 'all' / 'none')
```

## `/matts-second-brain:remember`

Manual brain write. Use after a notable event you want preserved.

```
/matts-second-brain:remember <category> [<title>]
```

Categories:

- `standards` — durable rule
- `decisions` — dated decision with rationale
- `lessons` — postmortem (cause + fix + evidence)
- `apps/<name>` — per-app gotcha
- `reviews` — feedback to internalise

For decisions and lessons, Claude prompts for the *what / why / evidence* triple before writing — refuses to write a note without all three.
