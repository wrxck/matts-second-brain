---
title: brain_update
description: Update a note with archived prior content + reason.
---

For when an existing note needs to change — a standard evolves, a decision is revisited, a lesson has new evidence. Never silently overwrites.

## Parameters

| Name | Type | Description |
|---|---|---|
| `noteId` | string | The id returned by an earlier `brain_recall` or `brain_remember` |
| `newBody` | string | Replacement content (≥20 chars) |
| `reason` | string | Why the change — appears appended to the new body, and on the archived child note |

## What happens under the hood

1. The current body is copied into a new child note titled `[archived YYYY-MM-DD] <original title>`, tagged `#claude-brain-archived`
2. The live note's body is replaced with `newBody` + an updated-stamp line containing your reason
3. The original `id` stays the same — references to it from other tools / your own notes still work

## Example

```
brain_update(
  noteId="ExdruMgaoqjb",
  newBody="...new git workflow rules...",
  reason="Added the never-co-author rule we agreed in 2026-04-26 conversation"
)

→ Updated note ExdruMgaoqjb
    Archived prior content as: AbcDef123XyZ
    Reason: Added the never-co-author rule we agreed in 2026-04-26 conversation
```

## When NOT to update

- **Tiny typo fixes** — just edit the note in your backend's UI.
- **Adding a fresh decision that supersedes the old one** — write a new `brain_remember` in `decisions` rather than rewriting the standard, so the rationale stays discoverable.
- **Refactoring multiple related notes** — do it manually in the UI; the audit trail from `brain_update` is per-note, not per-batch.
