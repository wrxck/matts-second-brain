---
title: Backend overview
description: Trilium, Obsidian, Notion — pick what fits your workflow. Same MCP tools, same discipline.
---

The brain is **backend-agnostic**. Three implementations ship in the box; all expose the same MCP tools (`brain_recall`, `brain_remember`, `brain_update`, etc.) and follow the same discipline rules.

## Quick comparison

| Feature | [Trilium](/backends/trilium/) | [Obsidian](/backends/obsidian/) | [Notion](/backends/notion/) |
|---|---|---|---|
| Self-hosted | ✅ | ✅ (vault is local) | ❌ (cloud) |
| Sync | optional Trilium-Sync | manual / iCloud / Syncthing / Obsidian Sync | built-in |
| Search | structured query lang | substring (grep) | Notion search |
| Attributes / tags | first-class labels | inline `#tag` in body | multi-select properties |
| Setup difficulty | medium (Docker) | low (just a vault dir) | low (token + share page) |
| Best for | structured power users | local-first workflows | teams, sharing |

## How the swap works

The MCP server reads `BRAIN_BACKEND` at startup and instantiates one adapter:

```bash
export BRAIN_BACKEND=trilium     # or obsidian, or notion
```

All other env vars are backend-specific — see each backend's page.

## Adding your own

Want a different backend? See [Writing your own backend](/backends/writing-your-own/) — implement the `BrainAdapter` interface (7 methods), register it in the factory, ship.
