# matts-second-brain

A persistent knowledge brain for Claude Code, backed by [Trilium Notes](https://github.com/TriliumNext/Notes). Standards, decisions, lessons learned, and per-app context survive across sessions and grow over time — Claude **reads** before it acts and **writes back** when something noteworthy happens.

This is not a memory file. It's a structured, searchable, editable knowledge base that you and Claude both contribute to. Over months it becomes the thing that turns Claude from "knows the current task" into "knows your standards, your history, and your past mistakes."

## Backends

The brain is **backend-agnostic**. Pick what fits your workflow:

| Backend | Best for | Setup |
|---|---|---|
| **Trilium** (default) | Self-hosted, queryable, structured attributes, ETAPI | `BRAIN_BACKEND=trilium` + Trilium URL + ETAPI token |
| **Obsidian** | Local markdown vault, syncs via Obsidian's own sync / iCloud / Syncthing | `BRAIN_BACKEND=obsidian` + `BRAIN_OBSIDIAN_VAULT=/path/to/vault` |
| **Notion** | Cloud-hosted, team-shareable, rich blocks | `BRAIN_BACKEND=notion` + `BRAIN_NOTION_TOKEN` + `BRAIN_NOTION_ROOT_PAGE` |

All three implement the same `BrainAdapter` interface (`mcp-server/src/adapters/index.ts`). Adding a backend is one file: implement the interface, register it in the factory, ship.

## Why

Built after a real incident: a leaked secret revealed that the only memory Claude had across sessions was the inline `MEMORY.md` file. Useful, but it doesn't scale to dozens of apps and hundreds of standards. Trilium does — and it's already self-hostable, syncable, and structured.

## What's in the box

| Component | What it does |
|---|---|
| **MCP server** (`@matthesketh/second-brain-mcp`) | Tools: `brain_recall`, `brain_search_semantic`, `brain_remember` (dedup-on-write), `brain_update`, `brain_scan_transcripts`, `brain_check_citations`, `brain_stats`, `brain_sync_srag`, `brain_setup_check`, `brain_seed_taxonomy`, `brain_onboard`. Every write is audited (secret-redacted). |
| **Skills** (`:install`, `:recall`, `:remember`, `:maintenance`, `:hygiene`) | Setup, manual write-back, scheduled self-consolidation, and periodic cleanup |
| **Discipline skill** (loaded via plugin) | The rules Claude follows: cite when consulting, verify before recommending, write decisions not opinions, surface contradictions |
| **Setup wizard** | Detects whether Trilium is reachable; offers to install if not. Generates the root taxonomy. Optionally seeds from existing transcripts. |

## Configuration & automation

The plugin exposes opt-in `userConfig` (set via `/config` or the plugin settings):

| Option | Default | Effect |
|---|---|---|
| `sessionReminder` | `true` | a SessionStart hook injects the brain discipline (knowledge-only, recall-before, capture-after) every session |
| `scheduledMaintenance` | `false` | enable the nightly self-consolidation job |
| `maintenanceSchedule` | `0 4 * * *` | cron (UTC) for the job |
| `maintenanceModel` / `scanSinceDays` / `maintenanceTimeoutMin` | sonnet / 2 / 10 | tuning for the unattended run |

**Self-consolidation.** With `scheduledMaintenance` enabled, `/matts-second-brain:maintenance install`
adds a local cron that runs a tested, dependency-free harness (`maintenance/`). It launches a
headless `claude -p` constrained to the brain tools to scan recent transcripts, persist durable
knowledge (deduped), and reindex — so the brain updates itself even when you don't think to.
It is **local** (not a cloud `/schedule` routine) because the brain backend is local. Manage it
with `/matts-second-brain:maintenance` (`install` / `status` / `run` / `dry-run` / `uninstall` / `test`).

**Hygiene.** `/matts-second-brain:hygiene` (dry-run by default) dedupes near-duplicates, flags
stale citations and contradictions via `brain_check_citations`, and proposes archiving long-unused
notes.

## Install

### One-time on the host

The plugin's MCP server needs a Trilium instance. The setup wizard will help you stand one up if you don't have one (Docker, a few lines of compose).

### In Claude Code

```
/plugin install matts-second-brain
```

Then in any Claude session:

```
/matts-second-brain:install
```

The wizard checks Trilium reachability, prompts for an ETAPI token (hidden input), seeds the taxonomy, and registers the MCP. Optionally offers to scan your existing `~/.claude/projects/*` transcripts and infer standards from patterns it sees.

## How it works

```
Claude session
   │
   ├── on session start: brain_recall(cwd_context)
   │       → Trilium ETAPI search → relevant Standards/, Apps/<this>, Lessons Learned/
   │       → injected into context with citation tags
   │
   ├── during session: any tool can call brain_remember(category, title, body)
   │       → new note in Trilium with #claude-brain tag + dated
   │
   └── on session end (or manual): summary → Decisions/ or Lessons Learned/
```

## The discipline

When the plugin is installed, Claude is required to:

1. **Cite when consulting**: "Per Trilium /Standards/Git Workflow (last updated 2026-04-25)…"
2. **Verify before asserting**: a note about `function foo` → check `foo` still exists
3. **Write decisions, not opinions**: every Decisions/ note has *what changed* + *why* + *evidence*
4. **Surface contradictions**: if memory says X but live state shows Y, raise it
5. **Update, don't silently overwrite**: edits are explicit and visible

These rules live in `skills/_discipline/SKILL.md` and are loaded automatically when the plugin is enabled.

## Multi-user / shared brain

For a host where multiple OS users share one Claude/Trilium instance:

```
/etc/claude-brain/
  ├── trilium-token         # mode 0640, owner root:claude
  ├── mcp-trilium.json
  └── brain-rules.md
/usr/local/bin/trilium-mcp  # wrapper sourcing the shared token
/etc/profile.d/claude-brain.sh  # auto-registers MCP in each user's ~/.claude.json
```

Membership in the `claude` group grants access. The wizard sets this up if you opt into multi-user mode.

## License

MIT
