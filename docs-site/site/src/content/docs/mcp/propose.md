---
title: brain_propose / brain_review_proposals
description: Queue brain notes for human review instead of auto-writing.
---

These two MCP tools back the [smart hooks](../plugin/hooks/) proposals workflow. The Stop hook calls `brain_propose` when it spots something worth remembering; the next session's start hook surfaces the queue; Claude calls `brain_review_proposals` to act on them.

## `brain_propose`

Queue a proposed brain note for human review. **Does not write to the brain.**

```json
{
  "category": "standards" | "decisions" | "lessons" | "apps" | "reviews" | "drafts",
  "title": "string (>= 3 chars)",
  "body": "string (>= 20 chars)",
  "tags": ["optional", "extras"],
  "sessionId": "current claude session id (default: 'default')"
}
```

Appends a JSON line to `~/.cache/claude-brain/proposals-<sessionId>.jsonl`. Returns the queue file path. No backend round-trip — fast and offline-safe.

## `brain_review_proposals`

List pending proposals. With `drain=true`, removes them after listing — caller is expected to convert keepers to `brain_remember` in the same turn.

```json
{
  "sessionId": "optional filter to one session",
  "drain": false
}
```

Returns a numbered list with category, title, timestamp, and a body excerpt for each pending proposal.

## Why not auto-write?

Silent auto-writes degrade brain quality. Pattern matching on transcripts catches the *symptom* of a worthwhile note (a correction, a regression, a multi-attempt fix), but the *content* of a good Standards or Lessons note needs human framing — "what / why / evidence". Surfacing proposals at session start keeps Matt in the loop on every write while still capturing the moments he might forget about by Monday morning.
