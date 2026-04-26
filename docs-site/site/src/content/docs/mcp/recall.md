---
title: brain_recall
description: Search the brain for notes relevant to a query.
---

The read side of the brain. Returns titles + last-modified dates + brief excerpts for matching notes — Claude is expected to cite these when acting on a result.

## Parameters

| Name | Type | Default | Description |
|---|---|---|---|
| `query` | string | — | Free-text query — e.g. *"git workflow"*, *"deployment runbook"*, *"idempotent migrations"* |
| `category` | enum | (any) | One of `standards`, `decisions`, `lessons`, `apps`, `reviews`, `drafts` to scope the search |
| `limit` | number | 10 | Cap on results returned |

## Example

> *Claude*: I'll check the brain for our git workflow first.

```
brain_recall(query="git workflow", category="standards")

→ Brain matches for "git workflow" (backend=trilium, 2 results):
    • Git Workflow  [id=ExdruMgaoqjb, modified 2026-04-26]
        "Branch model: main — production. Only updated via PR from develop during releases. develop — integration branch. Features PR to here for review..."
```

> *Claude*: Per Trilium *Standards / Git Workflow* (last updated 2026-04-26): all PRs target `develop`, never `main`. So I'll branch off `develop` for this fix.

That citation is the discipline rule in action — see [Discipline rules](/plugin/discipline/).

## Tips

- **Prefer specific over broad**: `"jwt rotation strategy"` retrieves more useful results than `"jwt"`.
- **Use `category` when known**: scoping to `standards` skips noise from old `drafts`.
- **Backend-aware quirks**:
  - Trilium: query is run as a Trilium fulltext search restricted to `#claude-brain` notes
  - Obsidian: substring match across body + filename, ranked by `mtime`
  - Notion: Notion's own search endpoint, restricted to integration-accessible pages
