---
name: recall
description: "Manually query the second-brain (Trilium) for notes relevant to the current task. Use when you want Claude to consciously consult the brain before acting — e.g. 'recall git workflow', 'what do we know about macpool deployment', 'recall lessons from the Stripe incident'."
argument-hint: "<query text>"
allowed-tools: "Bash Read"
---

# /matts-second-brain:recall — fetch notes relevant to the current task

Calls the `brain_recall` MCP tool with the query, prints titles + last-updated + a 1-line excerpt for each match, then asks how the user wants to proceed (cite, ignore, update).

## Output format

```
Brain matches for "git workflow" (5 results):
  • Standards / Git Workflow (2026-04-25, cited 12 times)
      "All PRs target develop. Main updated only via release PRs from develop."
  • Lessons Learned / 2026-04-23 — Force-push to develop
      "Force-push to develop blocked by hook because…"
  • Apps / fleet / Branching (2026-04-25)
      "Use feat/* for new commands, fix/* for bug fixes…"

Cite which? (numbers / 'all' / 'none')
```

If no matches, say so plainly — don't fabricate.
