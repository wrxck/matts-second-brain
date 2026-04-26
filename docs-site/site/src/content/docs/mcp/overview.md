---
title: MCP tool overview
description: The six brain_* tools exposed by @matthesketh/second-brain-mcp.
---

The MCP server (`@matthesketh/second-brain-mcp`) exposes six tools. All are backend-agnostic — they operate against whichever `BrainAdapter` you configured.

| Tool | Purpose |
|---|---|
| [`brain_setup_check`](/mcp/setup-check/) | Diagnose what's installed/missing in this Claude instance |
| [`brain_seed_taxonomy`](/mcp/seed-taxonomy/) | Create the root *Claude Memory* note + standard children |
| [`brain_recall`](/mcp/recall/) | Search the brain for notes relevant to a query |
| [`brain_remember`](/mcp/remember/) | Write a new note with category enforcement |
| [`brain_update`](/mcp/update/) | Update a note with archived prior content + reason |
| [`brain_scan_transcripts`](/mcp/scan-transcripts/) | Mine `~/.claude/projects/*` for inferable Standards (suggests only — never auto-writes) |

## Discipline contract

The plugin's `_discipline` skill enforces several rules around *how* these tools should be used:

1. **Cite when consulting** — every reference to a `brain_recall` result includes the note title + last-modified date
2. **Verify before asserting** — facts from the brain are checked against current code/state before action
3. **Decisions need what / why / evidence** — `brain_remember` refuses to write a decision/lesson missing any of the three
4. **Never silently overwrite** — `brain_update` archives prior content as a child note before replacing
5. **Surface contradictions** — if the brain says X but live state shows Y, raise it

These aren't tool-level enforcement (the MCP doesn't know what Claude says in chat); they're skill-level. See [Discipline rules](/plugin/discipline/) for the full set.
