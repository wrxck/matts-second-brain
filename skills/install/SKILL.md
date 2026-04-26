---
name: install
description: "Set up matts-second-brain end-to-end on this Claude instance: detect or install Trilium, prompt for an ETAPI token, register the MCP server, seed the brain taxonomy, optionally scan existing transcripts for inferable standards. Use when the user says things like 'set up second brain', 'install matts-second-brain', 'wire up Trilium memory', 'connect Claude to my notes'."
argument-hint: "[--multi-user] [--scan-transcripts] [--trilium-url URL]"
allowed-tools: "Bash Read Edit Write Grep Glob"
---

# /matts-second-brain:install — wire Trilium up as Claude's brain

Walks through the full setup. Idempotent — safe to re-run.

## Phase 1 — preflight

Check what's already in place. Report each as `[ok]` / `[needs setup]`:

```bash
# Trilium reachable?
curl -sf -o /dev/null "${TRILIUM_URL:-http://127.0.0.1:8787}/api/health-check" \
  && echo "[ok] Trilium reachable" \
  || echo "[needs setup] Trilium not reachable"

# trilium-mcp jar built?
test -f /home/matt/mcp/trilium-mcp/target/trilium-mcp-1.0.0.jar \
  && echo "[ok] trilium-mcp jar present" \
  || echo "[needs setup] trilium-mcp jar missing"

# Token present?
test -s /etc/claude-brain/trilium-token \
  && echo "[ok] ETAPI token configured" \
  || echo "[needs setup] ETAPI token not set"

# MCP registered in user's Claude config?
grep -q '"trilium"' ~/.claude.json 2>/dev/null \
  && echo "[ok] trilium MCP registered" \
  || echo "[needs setup] trilium MCP not registered"
```

## Phase 2 — install missing pieces

For each `[needs setup]`, walk the user through it interactively. Don't run destructive things without confirmation.

### If Trilium isn't reachable
Offer to bring up a docker container:
- compose snippet under `docs/trilium-docker-compose.yml`
- run `docker compose up -d`
- wait for healthcheck

### If trilium-mcp jar missing
- Clone https://github.com/wrxck/trilium-mcp if not present in `/home/matt/mcp/trilium-mcp`
- Run `mvn -q package` inside it
- Verify the jar landed

### If token not set
- Tell the user: "Open Trilium → Options → ETAPI → Create new token"
- Prompt for the value with hidden input (Bash `read -rs`)
- Write to `/etc/claude-brain/trilium-token` with mode 0640, owner root:claude
- **NEVER echo the token back, NEVER include it in any audit/log line**

### If MCP not registered
- Append the trilium MCP entry to `~/.claude.json` (or merge with existing mcpServers)
- Use `/usr/local/bin/trilium-mcp` as the command — wrapper handles env injection

## Phase 3 — seed the brain taxonomy

Use trilium MCP tools to create the root note + structure if not already there:

```
Claude Memory/
  ├── 00 — How to use this brain     # discipline rules (see skills/_discipline)
  ├── Standards/
  ├── Decisions/
  ├── Lessons Learned/
  ├── Apps/
  ├── Reviews/
  └── Drafts/
```

Tag every note with `#claude-brain`. If the root already exists, skip — never overwrite the user's existing notes.

## Phase 4 — multi-user (opt-in)

If `--multi-user` flag passed:
- Create `claude` group if missing
- Add current user + root + any user passed via `--users a,b,c`
- Move/copy token to `/etc/claude-brain/` with group ownership
- Drop `/etc/profile.d/claude-brain.sh` so future login shells auto-register the MCP
- Symlink `/usr/local/bin/trilium-mcp` if not present

## Phase 5 — transcript scan (opt-in)

If `--scan-transcripts` flag passed:
- Walk `~/.claude/projects/*/` for `.jsonl` session transcripts
- Run `brain_scan_transcripts` MCP tool to infer:
  - Repeated user corrections → candidate `Standards/`
  - Resolved bugs with rationale → candidate `Lessons Learned/`
  - Per-app gotchas → candidate `Apps/<name>/`
- **Always present inferred notes for human review before writing** — never bulk-create. The user accepts/rejects each.

## Phase 6 — verify

End by:
1. Calling `brain_recall("git workflow")` — should return citations from the seeded standards
2. Telling the user to quit + relaunch Claude (so the new MCP registration takes effect)
3. Suggesting first manual note to write so they get a feel for `brain_remember`
