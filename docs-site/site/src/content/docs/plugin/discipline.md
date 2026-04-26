---
title: Discipline rules
description: The rules Claude follows when matts-second-brain is installed.
---

The plugin ships a `_discipline` skill that's loaded automatically. It defines *how* Claude consults and writes back to the brain — the part that turns the MCP from "tools that exist" into "tools that get used consistently".

## At session start

1. Detect the working directory's app/repo (`package.json`, `git remote`, etc.)
2. Call `brain_recall` for relevant standards / app-specific notes / recent lessons
3. Summarise back to the user **what was found** that's relevant — by title + last-modified date — before acting on it. Brief, scannable.

## When recommending from memory

**Always cite the source**:

> *Per Trilium **Standards / Git Workflow** (last updated 2026-04-25): all PRs target `develop`, never `main`. So I'll branch off `develop` for this fix.*

This makes stale citations obvious to the user — they can correct or update the note.

## Before asserting based on memory

Memory can go stale. If a note references `function foo` in `file.ts`, **check `foo` still exists** before recommending action that depends on it. Either:

- Confirm and proceed
- Or surface the drift: *"The Trilium note from 2026-04-25 says X, but the current code shows Y. Worth updating the note?"*

## When writing back

Use `brain_remember` for new knowledge. The schema:

| Category | Use for | Required structure |
|---|---|---|
| **Standards** | Durable rules ("we always use age encryption") | Free-form |
| **Decisions** | Dated, with rationale | What / Why / Evidence |
| **Lessons Learned** | Postmortems | What / Why / Evidence |
| **Apps/&lt;name&gt;** | Per-app gotchas | Free-form |
| **Reviews** | Feedback patterns to internalise | Free-form |
| **Drafts** | In-progress / opinions | Free-form |

**Decisions and Lessons MUST contain** what changed / why / evidence. Without all three, it is an opinion not a decision — `brain_remember` refuses.

## When the brain contradicts live state

If `brain_recall` returns something that conflicts with what the current code or current request says:

> *"The brain says X (Trilium note: link, 2026-04-25) but the current request is Y. Should I update the note, follow the older standard, or you tell me?"*

Surface contradictions; never silently pick one.

## When to write proactively

These trigger an unprompted `brain_remember`:

| Event | Category | Why |
|---|---|---|
| User corrects me with a non-obvious reason | Standards | Codify so I don't make the same mistake |
| A bug fix with a non-obvious root cause | Lessons Learned | Postmortem |
| A design choice between two viable alternatives | Decisions | Future me needs the rationale |
| A new gotcha specific to one app | Apps/&lt;name&gt; | Surfaces on next session in that app |
| An independent reviewer's finding I had to fix | Reviews | Pattern recognition |

If unsure, ask first. Better to skip than to fill the brain with noise.

## When NOT to write

- Routine commits, PRs, and merges — git history already records them
- Trivial bug fixes where the cause is obvious from the diff
- Conversational acknowledgements
- Anything containing a secret value — the brain is not a vault

## Periodic hygiene

A separate opt-in skill (`/matts-second-brain:hygiene`):

- Review the most-cited notes; flag any that now contradict current code
- Consolidate near-duplicate Standards into one
- Archive notes that haven't been cited in 6 months and reference deprecated systems
