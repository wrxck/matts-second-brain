---
title: Semantic search (srag)
description: Embedding-backed semantic search over the brain via the srag CLI.
---

`brain_recall` is keyword/tag search — fast, deterministic, but you have to know what you're looking for. For *"what did we figure out about X"* questions where the right note's title doesn't contain X, semantic search wins.

The plugin ships an integration with [srag](https://github.com/wrxck/system-rag) — a local Rust+Python tool that does chunking + sentence-transformer embeddings + on-disk vector search. Brain notes are exported as markdown, srag indexes them as a synthetic `claude-brain` project, and `brain_search_semantic` queries the index.

## Why this layer

| Tool | Best for | How it matches |
|---|---|---|
| `brain_recall` | "Find the note titled X" / known tag | substring + Trilium label query |
| `brain_search_semantic` | "What did we decide about idempotent migrations" | sentence embeddings, cross-section recall |
| `srag` (direct) | "Where in the codebase is the JWT secret rotated" | embedded code chunks across many repos |

The three layer up nicely: keyword for known notes, semantic for vague recall, srag direct for code.

## Setup

```bash
# 1. Install srag (one-time, per host)
curl -fsSL https://raw.githubusercontent.com/wrxck/system-rag/main/install.sh | bash

# 2. Build/install the brain MCP (already done if you used the plugin install wizard)

# 3. From inside Claude:
brain_sync_srag()
```

`brain_sync_srag` does:

1. Walks the brain via the active adapter's `listAll()`
2. Writes each note to `~/.local/share/claude-brain/srag-export/<backend>/<sanitised-id>__<title>.md` with YAML frontmatter (id / title / path / modifiedAt)
3. Calls `srag index --name claude-brain <export-dir>` to chunk + embed

Re-run after batches of new notes; it's idempotent.

## Tools

### `brain_sync_srag`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `clean` | bool | `false` | Wipe the export dir first (full rebuild). Otherwise incremental. |
| `underPath` | string | (all) | Restrict to notes under this path — e.g. `"Claude Memory/Standards"`. |

Returns a summary: notes written / skipped / errors, plus the srag index output.

### `brain_search_semantic`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `query` | string | — | Natural-language question. |
| `limit` | number | 8 | Max snippets returned. |

Returns ranked snippets with `noteId` (parsed from the export filename) so Claude can chase a hit back to the canonical note via `brain_recall` or the backend's UI.

## Discipline pattern

The recommended recall flow when the user asks an open question:

1. **`brain_search_semantic`** first — broad cast.
2. For any hit, follow up with **`brain_recall`** by id/title to load the full canonical note.
3. Cite the result by *backend / category / title / last-modified date* before acting.

The plugin's `_discipline` skill enforces this pattern automatically.

## Limitations

- **Embedding cost**: srag uses sentence-transformers locally (CPU). First index of ~500 notes takes a minute or two; queries are sub-second.
- **Adapter scope**: `listAll()` returns all notes tagged `#claude-brain` for Trilium, all `.md` files under the vault for Obsidian, and the integration's accessible pages for Notion (Notion is rate-limited; capped at 200).
- **Stale until you sync**: there is no live watcher — re-run `brain_sync_srag` (or wire it to a cron / systemd timer) after meaningful note batches.

## Env

| Variable | Default | Description |
|---|---|---|
| `BRAIN_SRAG_EXPORT_DIR` | `~/.local/share/claude-brain/srag-export` | Where the markdown export lives. |
| `SRAG_BIN` | `srag` (PATH) | Override the srag binary path. |
