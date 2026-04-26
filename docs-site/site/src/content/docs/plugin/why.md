---
title: Why this exists
description: The gap this plugin closes.
---

## The problem

Claude Code's built-in `MEMORY.md` is great for short personal preferences — "use 2-space indents", "prefer terse responses". It doesn't scale to:

- Standards that need to be enforced across dozens of repos
- Decisions whose rationale you'll want to find again in a year
- Lessons learned from incidents and reviews
- Per-app gotchas that surface only when you're back in that app
- Discipline rules that need to survive context compaction

A small flat file can't hold that volume *or* be searchable. A real notes backend can.

## What this plugin is

A bridge between Claude Code and a notes backend (Trilium, Obsidian, or Notion). Six MCP tools let Claude read and write structured notes. A discipline skill enforces the rules — cite when consulting, write decisions with evidence, surface contradictions instead of silently picking one.

The taxonomy (Standards / Decisions / Lessons Learned / Apps / Reviews / Drafts) gives the brain shape. Adapters mean you can use whichever notes app you already trust.

## Why ship it

Other people are running Claude Code at scale. They'll hit the same limit. Sharing means:

1. They don't have to invent the structure from scratch.
2. The discipline rules are at least one starting point to argue against.
3. Backend-agnostic adapters keep migration cost at zero.

## What it isn't

- A solved problem. The discipline rules will evolve.
- A replacement for git, code review, or written project docs. Brain holds the *why*, not the *what*.
- A way to make Claude smarter at unfamiliar tasks. It just makes Claude *consistent* across sessions on tasks you've taught it before.
