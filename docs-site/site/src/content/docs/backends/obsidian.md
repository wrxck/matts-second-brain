---
title: Obsidian backend
description: Local markdown vault. Each note is a .md file; folders are taxonomy paths.
---

## Why Obsidian

- Local-first — notes are markdown files in a directory you control.
- Sync via whatever you already use: iCloud, Syncthing, Obsidian Sync, Dropbox, manual git.
- Renders nicely in the Obsidian app you (or your team) already have open.
- No server to run; no API to expose.

## Configure the MCP

```bash
export BRAIN_BACKEND=obsidian
export BRAIN_OBSIDIAN_VAULT="/path/to/your/vault"
```

That's it — the vault must exist; the MCP will create folders inside it as needed.

## Layout in the vault

```
your-vault/
└── Claude Memory/
    ├── 00 — How to use this brain.md
    ├── Standards/
    │   ├── Git Workflow.md
    │   ├── Secrets Handling.md
    │   └── ...
    ├── Decisions/
    │   ├── 2026-04-26 — Pluggable backend adapters.md
    │   └── ...
    ├── Lessons Learned/
    │   └── 2026-03-12 — Idempotent migrations broke under retry.md
    ├── Apps/
    │   └── my-app/
    │       └── ...
    ├── Reviews/
    └── Drafts/
```

- The `id` of a note is its relative path from the vault root, with `.md` stripped.
- Tags become inline `#tag` lines at the top of the body.
- Search is substring + filename matching, ranked by recency. For semantic search across notes, layer [srag](https://github.com/wrxck/srag) on top — it can index the vault dir as just another repo.

## Limitations vs Trilium

- No native attribute/property system — tags are inline `#tag` text.
- Search is grep-based, not Trilium's structured query language.
- `brain_update` archives the prior content as a child note (`[archived YYYY-MM-DD] Title.md`).

These limitations are intentional: keeping the adapter file-system-only avoids any dependency on Obsidian itself running.
