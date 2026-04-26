---
title: brain_remember
description: Write a new note. Enforces structure for decisions and lessons.
---

The write side. Takes a category + title + body, attaches `#claude-brain`, returns the new note's id + canonical path.

## Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `category` | enum | yes | One of `standards`, `decisions`, `lessons`, `apps`, `reviews`, `drafts` |
| `title` | string | yes | Concise note title |
| `body` | string | yes | Note body (≥20 chars) |
| `app` | string | when `category=apps` | App name — note lands under `Apps/<app>/` |
| `tags` | string[] | no | Extra tags beyond `#claude-brain` |

## Enforcement

For `category=decisions` or `category=lessons`, the body **must** contain `What:`, `Why:`, and `Evidence:` lines. Without all three, the call is refused:

```
Error: decisions notes require all three of "What:", "Why:", "Evidence:" in the body.
If you can't fill all three, this is an opinion, not a decision/lesson — write it as a draft instead.
```

This is intentional. Decisions without evidence aren't decisions, they're opinions. Opinions go in `drafts`, not `decisions`.

## Example

```
brain_remember(
  category="lessons",
  title="2026-03-12 — Idempotent migrations broke under retry",
  body=`
    What:     A schema migration ran twice in a single deploy and corrupted a
              counter column.
    Why:      The CI step retried on a transient lock timeout, but the migration
              wasn't idempotent — the UPDATE statement assumed prior state.
    Evidence: deploy log shows two consecutive runs of migration 0042; counter
              row went from 100 to 200 to 300 in three seconds. PR #482 added
              the idempotency guard.
  `
)

→ Wrote (backend=trilium): Claude Memory/Lessons Learned/2026-03-12 — Idempotent migrations broke under retry
    id: R7qg6gS70u6S
    tags: claude-brain
```

## When to call it (auto-trigger heuristics)

The discipline skill defines when Claude should write proactively:

| Event | Category |
|---|---|
| User corrects with a non-obvious reason | `standards` |
| Bug fix with non-obvious root cause | `lessons` |
| Design choice between viable alternatives | `decisions` |
| App-specific gotcha | `apps` |
| Independent reviewer finding | `reviews` |

If unsure, Claude asks first. Better to skip a note than fill the brain with noise.
