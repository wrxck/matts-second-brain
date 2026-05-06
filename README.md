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
| **MCP server** (`@matthesketh/second-brain-mcp`) | Tools: `brain_recall`, `brain_remember`, `brain_propose`, `brain_review_proposals`, `brain_scan_transcripts`, `brain_setup_check`, `brain_install` |
| **Smart hooks** (`hooks/*.py`) | Auto-recall on session start + on each prompt; auto-propose-to-remember on session end; file-context recall before edits. See "Smart hooks" below. |
| **brain CLI** (`brain`) | Synchronous wrapper around the adapter — used by the hooks and handy for shell scripts. |
| **Skills** (`/matts-second-brain:install`, `:recall`, `:remember`) | User-invokable commands for setup + manual write-back |
| **Discipline skill** (loaded via plugin) | The rules Claude follows: cite when consulting, verify before recommending, write decisions not opinions, surface contradictions |
| **Setup wizard** | Detects whether Trilium is reachable; offers to install if not. Generates the root taxonomy. Optionally seeds from existing transcripts. |

## Smart hooks

The plugin ships four Claude Code hooks under `hooks/` that make the brain proactive — no need to call `/recall` manually before every task.

| Hook | Trigger | What it does |
|---|---|---|
| `session_start.py` | new Claude session | Derives the app name from `cwd`, recalls top `/Apps/<name>` notes + standards, surfaces any pending proposals queued by the previous session's Stop hook. |
| `user_prompt_submit.py` | each user prompt | Scans for app names (cached hourly from `/Apps/*` notes), tech keywords (`fleet`, `nginx`, `webauthn`, ...), and "how do we / what's our standard" phrases; pulls top 2 brain matches per trigger and injects them as additional context. |
| `stop.py` | Claude finishes responding | Scans the session transcript for corrections, decisions, regressions, and files edited 3+ times; **queues** `brain_propose` payloads for review next session. Never auto-writes — you stay in the loop. |
| `pre_tool_use_edit.py` | before Edit/Write | Resolves the target file's repo, recalls its `/Apps/<reponame>` note, throttled to once per minute per repo so it doesn't spam context on every keystroke. |

**Proposals workflow:** the Stop hook never writes to the brain. Instead it appends drafts to `~/.cache/claude-brain/proposals-<sessionId>.jsonl`. When the next session starts, `session_start.py` injects "N brain proposal(s) pending review", and Claude can call `brain_review_proposals` (a new MCP tool) to list them and act on the keepers via `brain_remember`. Silent auto-writes degrade brain quality; surfaced proposals keep them honest.

**Opt out per shell**: `BRAIN_QUIET=1` env var.
**Opt out per user**: `touch ~/.claude/.brain-quiet`.
**Opt out per repo**: `touch <repo>/.brain-ignore`.

The hooks call into a thin synchronous CLI (`brain` on PATH, or `node <plugin>/mcp-server/dist/cli.js`) that wraps the same adapter factory as the MCP server. Subcommands: `recall`, `remember`, `propose`, `proposals`, `apps`. Run `brain --help` for shapes.

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
