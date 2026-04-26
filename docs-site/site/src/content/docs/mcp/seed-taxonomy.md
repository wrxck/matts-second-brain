---
title: brain_seed_taxonomy
description: Create the root note + standard children.
---

Idempotent — safe to re-run. Existing notes are skipped, missing ones are created.

## Parameters

None.

## Result

```
Backend: trilium
Root: Claude Memory
Created: Standards, Decisions, Lessons Learned, Apps, Reviews, Drafts
Skipped (already existed): 00 — How to use this brain
```

## What it creates

```
Claude Memory/
├── 00 — How to use this brain
├── Standards/
├── Decisions/
├── Lessons Learned/
├── Apps/
├── Reviews/
└── Drafts/
```

The root note is tagged `#claude-brain` (Trilium) or has the tag inline (Obsidian, Notion). Subsequent `brain_remember` calls attach the same tag to every note they create, so `brain_recall` searches stay scoped to the brain's contents and don't pull in unrelated notes you may already have in your backend.

## Customising the taxonomy

The taxonomy is currently fixed. If you want different top-level categories, edit `mcp-server/src/index.ts` (`TAXONOMY` constant) and rebuild. Open an issue if you have a strong case for making it configurable — adopting community categories is fine, but flag the trade-off (loss of cross-instance comparability).
