---
title: Combining with srag
description: Pair second-brain with srag for the strongest pattern recall.
---

[srag](https://github.com/wrxck/srag) is a separate tool — semantic code search across all your indexed repos via MCP. It's complementary to second-brain: where second-brain holds *curated prose* (standards, decisions, lessons), srag holds *every implementation pattern you've ever written*.

Together they answer two different questions Claude needs to answer for any non-trivial task:

| Question | Tool |
|---|---|
| *"What's our standard / have we hit this before?"* | `brain_recall` |
| *"How have I implemented this pattern before?"* | `search_code` (srag) |

## Install srag

```bash
git clone https://github.com/wrxck/srag.git
cd srag && ./install.sh
srag setup     # interactive: scans + indexes your projects
```

The installer wires srag's MCP into Claude Code automatically.

## Combined query pattern

The plugin's `_discipline` skill (when both tools are present) recommends this flow for any non-trivial task:

1. `brain_recall(query)` — what are the relevant standards / lessons / decisions?
2. `search_code(query)` (srag) — are there existing implementations to reuse?
3. Synthesise:
   > *Per Trilium **Standards / X** and srag found 3 prior implementations in `fleet/foo.ts`, `macpool/bar.ts`, `…` — I'll follow that pattern.*

If srag returns nothing, that's a signal the relevant project may not be indexed yet. Suggest `srag index <path>` to the user.

## Why two tools

- **second-brain is curated** — every note is human-reviewed (or human-approved-from-Claude's-suggestion). Trust is high.
- **srag is automated** — it indexes everything; quality varies with the underlying code. Trust is *file-by-file*.
- The discipline rule is the same in both cases: **cite the source**. *"Per `fleet/src/core/secrets-rotation.ts:142`…"* is just as accountable as *"Per Trilium Standards/X…"*.

## Other layers

If you have the [trilium-mcp](https://github.com/wrxck/trilium-mcp) (Java) server installed too, you also get the 38 raw ETAPI tools for direct note CRUD. The brain MCP's high-level `brain_*` tools handle 95% of cases; trilium-mcp is the escape hatch for raw operations (bulk fixes, attribute manipulation, etc.).
