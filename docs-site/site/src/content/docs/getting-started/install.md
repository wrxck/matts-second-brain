---
title: Install
description: Install matts-second-brain in any Claude Code instance, with your choice of Trilium / Obsidian / Notion backend.
---

## TL;DR

```bash
# 1. Add the marketplace (one-time, if you haven't already)
/plugin marketplace add wrxck/claude-plugins

# 2. Install the Claude Code plugin
/plugin install matts-second-brain@wrxck-claude-plugins

# 3. In any Claude session — runs the wizard
/matts-second-brain:install

# 4. Restart Claude Code so the new MCP loads
```

The wizard handles everything: backend selection, credential collection (with hidden input), taxonomy seeding, MCP registration. You answer prompts, it does the work.

## What the wizard does

1. **Detects existing setup.** If Trilium is already running locally, or you have an Obsidian vault path set, it reuses them.
2. **Collects credentials safely.** ETAPI tokens / Notion tokens go through a hidden-input prompt — never echoed, never in shell history, never in argv.
3. **Seeds the root taxonomy.** Creates *Claude Memory* with *Standards*, *Decisions*, *Lessons Learned*, *Apps*, *Reviews*, *Drafts* children. Idempotent — safe to re-run.
4. **Registers the MCP server** in your `~/.claude.json` so the `brain_*` tools become available.
5. **Optionally scans transcripts** for repeated corrections you can promote to Standards (read-only — never auto-writes).

## Manual install (if you'd rather)

If you don't want to use the wizard, here's what it actually does:

### 1. Install the plugin

The plugin lives in the [`claude-plugins`](https://github.com/wrxck/claude-plugins) marketplace. From any Claude Code session, add the marketplace (one-time) and then install the plugin:

```
/plugin marketplace add wrxck/claude-plugins
/plugin install matts-second-brain@wrxck-claude-plugins
```

### 2. Set up your backend

Pick one of:

#### Trilium (default — self-hosted)

```bash
# If you don't have Trilium yet:
docker run -d --name trilium -p 127.0.0.1:8787:8787 \
  -v trilium-data:/home/node/trilium-data \
  triliumnext/notes:v0.95.0
```

In Trilium UI: **Options → ETAPI → Create new token**. Copy the value.

#### Obsidian (local markdown vault)

```bash
export BRAIN_BACKEND=obsidian
export BRAIN_OBSIDIAN_VAULT="/path/to/your/vault"
```

#### Notion (cloud)

In Notion: create an integration at <https://www.notion.so/profile/integrations>, share a root page with the integration. Then:

```bash
export BRAIN_BACKEND=notion
export BRAIN_NOTION_TOKEN=secret_xxxxx
export BRAIN_NOTION_ROOT_PAGE=<root-page-id>
```

### 3. Install the MCP

```bash
npm install -g @matthesketh/second-brain-mcp
```

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "second-brain": {
      "type": "stdio",
      "command": "second-brain-mcp",
      "env": {
        "BRAIN_BACKEND": "trilium",
        "TRILIUM_URL": "http://127.0.0.1:8787",
        "TRILIUM_ETAPI_TOKEN": "your-token-here"
      }
    }
  }
}
```

### 4. Seed the taxonomy

Restart Claude. In a session, say:

> Run `brain_seed_taxonomy`.

That's it.

## Multi-user setup

If multiple OS users share one Claude/brain instance, see [Multi-user setup](/getting-started/multi-user/).
