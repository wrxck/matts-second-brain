---
title: Trilium backend
description: The default backend. Self-hosted, structured queries, ETAPI.
---

## Why Trilium

- Self-hosted — your knowledge base never leaves your infrastructure.
- Structured query language — search by ancestor, attribute, content, modification date.
- First-class labels — every brain note gets `#claude-brain`, retrievable by query.
- Sync via Trilium's own protocol or via shared Docker volume.

## Install Trilium

```bash
docker run -d --name trilium \
  -p 127.0.0.1:8787:8787 \
  -v trilium-data:/home/node/trilium-data \
  -e TRILIUM_NETWORK_TRUSTEDREVERSEPROXY=loopback \
  triliumnext/notes:v0.95.0
```

For production with HTTPS, put it behind nginx — see the [TriliumNext deployment docs](https://github.com/TriliumNext/Notes#deployment).

## Generate an ETAPI token

In the Trilium UI: **Options → ETAPI → Create new token**. The token gives the MCP read/write access to your notes via the [External API](https://github.com/zadam/trilium/wiki/ETAPI).

## Configure the MCP

```bash
export BRAIN_BACKEND=trilium                # default; can omit
export TRILIUM_URL=http://127.0.0.1:8787    # default
export TRILIUM_ETAPI_TOKEN=<your token>
```

Or, for multi-user hosts, the adapter falls back to:

1. `/etc/claude-brain/trilium-token` (mode 0640, owner root:claude)
2. `~/.trilium-mcp/config.properties` (compat with the [trilium-mcp Java MCP](https://github.com/wrxck/trilium-mcp))

## Verify

```
brain_setup_check
```

You should see:
```
backend: [ok] using trilium backend
reachable: [ok] trilium reachable + credentials valid
root_note: [ok] root note exists (id=...)
```

## Notes appear in Trilium as

- Root: `Claude Memory`
- Children: `00 — How to use this brain`, `Standards`, `Decisions`, `Lessons Learned`, `Apps`, `Reviews`, `Drafts`
- Each `brain_remember` call creates a child of the appropriate category, tagged `#claude-brain`
- Body stored as plain text inside `<pre>` blocks (round-trip-safe; no markdown rendering)
