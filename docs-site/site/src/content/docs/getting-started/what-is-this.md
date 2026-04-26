---
title: What is this?
description: Plain-English overview of what matts-second-brain does and what problem it solves.
---

## The problem

Claude Code is great at the task in front of it. But every session starts cold. The standards you taught it last week, the architectural decisions you and it made together, the reason a particular bug fix looked weird — all of that lives in conversation transcripts that nobody reads. Next session you re-explain.

Even with `MEMORY.md` files (Claude's built-in cross-session memory), you're capped: a small file, always loaded, no structure, no search. Useful for "I prefer 2-space indents" but not for "here's the auth model in this app, the gotchas, and why we picked it."

## What this is

A Claude Code plugin that wires Claude to a real notes backend (Trilium by default, Obsidian or Notion if you prefer) and adds a few MCP tools so Claude can:

- **Read** the brain before acting on a non-trivial task
- **Write back** when something noteworthy happens — with structure (Standards / Decisions / Lessons / Apps / Reviews) and discipline (cite sources, decisions need evidence, never silently overwrite)
- **Scan past transcripts** (optional, opt-in) to mine repeated corrections into Standards

The notes are normal notes. You can edit them yourself. They render in your usual app. The plugin just teaches Claude how to participate.

## What this isn't

- **Not a replacement for your code.** Code lives in git. Brain holds the *why*, not the *what*.
- **Not vector embeddings.** For semantic code search, layer [srag](https://github.com/wrxck/srag) on top — it indexes your repos and gives Claude pattern recall across implementations.
- **Not a chat history archive.** Brain is curated knowledge, not a transcript log.
- **Not proprietary.** Three backends ship; adding a fourth is one file.

## Who it's for

- You use Claude Code regularly across multiple projects
- You're tired of teaching Claude the same standard twice
- You want decisions to be recoverable later — *"why did we pick X again?"*
- You already have a notes app you trust (or are happy to spin up Trilium in 5 minutes)
