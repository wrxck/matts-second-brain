---
title: Notion backend
description: Cloud-hosted. Pages under a designated root, accessible via the Notion API.
---

## Why Notion

- Team-shareable — your knowledge base is already where your collaborators are.
- Rich blocks (toggles, callouts, embeds) for human consumption.
- No host to manage; no Docker; no port to forward.

## Set up the integration

1. Visit <https://www.notion.so/profile/integrations>
2. Create a new internal integration; copy the secret (`secret_xxxxx`)
3. In Notion, create a page (e.g. "Claude Memory")
4. Open the page → **Share** → invite the integration
5. Copy the page id from the URL

## Configure the MCP

```bash
export BRAIN_BACKEND=notion
export BRAIN_NOTION_TOKEN=secret_xxxxx
export BRAIN_NOTION_ROOT_PAGE=<root-page-id>
```

## Layout in Notion

- Root page: the one you shared with the integration
- Child pages for `Standards`, `Decisions`, `Lessons Learned`, `Apps`, `Reviews`, `Drafts`
- Each `brain_remember` creates a child page under the appropriate category, with title + body + tag-line block

## Limitations vs other backends

- Notion API has rate limits — `brain_scan_transcripts` may need to slow down for large transcript counts.
- `brain_update` is currently *append-only* — it adds an "updated" block rather than replacing existing block content (Notion's API requires per-block surgery; PRs welcome).
- Tags are added as inline `#tag` paragraph blocks rather than database multi-select properties (works without requiring a database).
- Search uses Notion's own search endpoint — less granular than Trilium's query language.

PRs to expand the Notion adapter (database-backed tags, full block-replacement, multi-select properties) are welcome — see [the source](https://github.com/wrxck/matts-second-brain/blob/main/mcp-server/src/adapters/notion.ts).
