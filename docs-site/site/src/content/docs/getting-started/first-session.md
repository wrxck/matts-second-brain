---
title: First session
description: What to do in your first Claude session after installing matts-second-brain.
---

After install, restart Claude Code so the new MCP loads. Confirm it's there:

```
/mcp
```

You should see `second-brain` in the list. If not, see [troubleshooting](#troubleshooting).

## Try the discipline

Just talk to Claude about something it might have notes on:

> "What's our git workflow?"

If you've seeded Standards, Claude should answer with a citation:

> *Per Trilium **Standards / Git Workflow** (last updated 2026-04-25): all PRs target `develop`, never `main`. So I'll branch off `develop` for this fix.*

The cite-when-consulting rule is part of the discipline skill — it's how you know Claude is actually using the brain rather than guessing.

## Write your first note manually

The plugin ships a `/matts-second-brain:remember` skill. Use it to test the write path:

```
/matts-second-brain:remember decisions
```

Claude prompts for title + body, enforces the *what / why / evidence* structure for decisions and lessons (refuses to write a note that's missing one of the three), and tags the result with `#claude-brain` so it surfaces in future `brain_recall` queries.

## Let Claude write proactively

Once you trust the discipline, the bigger value is unprompted writes. After Claude resolves a non-obvious bug, expect:

> *I'm going to write this to **Lessons Learned** since the root cause wasn't obvious from the diff. OK?*

You confirm, the note lands in the brain, and next time someone (or Claude) hits the same class of bug, `brain_recall` surfaces it.

## Troubleshooting

**`/mcp` doesn't show second-brain after install**
- Make sure you restarted Claude Code (the MCP list is loaded at startup).
- Check `~/.claude.json` has the `second-brain` entry under `mcpServers`.
- Look for stderr output: run `second-brain-mcp` directly in a terminal — it should start cleanly.

**`brain_setup_check` says backend unreachable**
- Trilium: confirm `curl http://127.0.0.1:8787/api/health-check` returns 200.
- Obsidian: confirm `BRAIN_OBSIDIAN_VAULT` points at an existing directory.
- Notion: confirm the integration has been shared on the root page (Page → Share → invite the integration).

**`brain_recall` returns no results even after seeding**
- Confirm the root note exists (`brain_setup_check` will tell you).
- For Trilium: notes need the `claude-brain` label. The seed taxonomy + brain_remember add it automatically. For notes you wrote manually, add the label in Trilium.
