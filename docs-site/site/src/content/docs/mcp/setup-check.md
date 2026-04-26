---
title: brain_setup_check
description: Diagnose what's installed/missing in this Claude instance.
---

Run first when something seems off. Returns a status block with one line per check.

## Parameters

None.

## Example output

```
backend: [ok] using trilium backend
reachable: [ok] trilium reachable + credentials valid
root_note: [ok] root note exists (id=mOwmyuYLp7yx)
transcripts: [ok] /home/matt/.claude/projects exists (38 project dirs)
```

Or in a broken state:

```
backend: [needs setup] no Trilium ETAPI token found. Set TRILIUM_ETAPI_TOKEN, write to /etc/claude-brain/trilium-token, or create ~/.trilium-mcp/config.properties.
reachable: (not run — backend init failed)
```

## When it surfaces what

| Check | Means |
|---|---|
| `backend: [ok] using ...` | The `BRAIN_BACKEND` env var is recognised and the adapter loaded |
| `reachable: [ok]` | The backend's `ping()` succeeded — credentials valid, server reachable |
| `root_note: [ok]` | The *Claude Memory* root note exists in the backend |
| `root_note: [needs setup]` | Run `brain_seed_taxonomy` |
| `transcripts: [ok]` | `~/.claude/projects` exists — `brain_scan_transcripts` will have something to read |

Use this to confirm a setup change took effect, or as the first stop when troubleshooting.
