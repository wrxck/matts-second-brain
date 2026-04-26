---
name: remember
description: "Manually write a note to the second-brain. Use when the user explicitly says 'remember this', 'note that', 'save this as a standard', 'log this lesson', or after a notable event you want preserved."
argument-hint: "<category> <title>"
allowed-tools: "Bash Read"
---

# /matts-second-brain:remember — write a note to the brain

## Categories

- `standards` — durable rule
- `decisions` — dated decision with rationale
- `lessons` — postmortem (cause + fix + evidence)
- `apps/<name>` — per-app gotcha
- `reviews` — feedback to internalise

## Process

1. Confirm the category. Reject anything outside the taxonomy.
2. Prompt for the body if not provided. **Decisions** and **Lessons** require *what / why / evidence* — refuse to write a note without all three filled.
3. Call `brain_remember` MCP tool with `{ category, title, body, tags: ['claude-brain', 'session-<id>'] }`.
4. Echo back the new note URL so the user can open it in Trilium.

## Never write

- Anything containing a secret value (full Stripe keys, passwords, tokens). The redaction rules from the original Stripe incident apply here too — use `<REDACTED:type>` placeholders.
- A note that just restates what's in the diff/git log. Brain ≠ git history.
- A note without a clear, single subject. If two ideas, two notes.
