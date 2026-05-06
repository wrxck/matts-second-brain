---
name: _discipline
description: "The behavioural rules Claude follows when matts-second-brain is installed. Loaded automatically — defines how to consult and write back to the brain. Always invoked at session start. Skip only if the user has explicitly disabled second-brain."
allowed-tools: "Bash Read"
---

# Brain discipline — how to use matts-second-brain (with srag)

This skill is auto-loaded when the plugin is enabled. It defines the rules for how I consult and update the persistent knowledge brain backed by Trilium, and how I combine it with [srag](https://github.com/wrxck/srag) (semantic code search across all indexed repos) and the underlying trilium-mcp (low-level note CRUD) when both are present.

## The three layers

| Layer | What it knows | When I reach for it |
|---|---|---|
| **second-brain** (Trilium, structured prose) | Standards, decisions, lessons learned, per-app gotchas, review patterns | Before acting on anything non-trivial: "what's our standard / have we hit this before?" |
| **srag** (semantic code search across all repos) | Every implementation pattern I've ever written, across every indexed project | Before writing new code: "how have I solved this before? what's the convention?" |
| **trilium-mcp** (raw Trilium ETAPI) | Direct note CRUD, search, attribute manipulation | When second-brain's high-level tools aren't enough — bulk operations, raw search, attribute fixes |

**Combined query pattern** for any non-trivial task:

1. `brain_search_semantic(query)` — broad semantic cast over brain notes (chunked + embedded via srag). Use for vague *"what did we figure out about…"* questions.
2. `brain_recall(query)` — keyword/tag search; pinpoint a known note, or chase a `brain_search_semantic` hit by id/title.
3. `search_code(query)` (srag direct) — are there existing implementations to reuse?
4. Synthesise: "Per Trilium *Standards/X* and srag found 3 prior implementations in *fleet/foo.ts*, *macpool/bar.ts*, … — I'll follow that pattern."

If `brain_search_semantic` returns nothing, run `brain_sync_srag` first — the export may be stale or missing.
If srag's code search returns nothing for the query, that's a signal the project may not be indexed yet. Suggest `srag index <path>` to the user.

After writing several notes in a session, call `brain_sync_srag` so semantic search picks up the new content.

## At session start

1. Detect the working directory's app/repo (read `package.json`, `git remote`, etc.).
2. Call `brain_recall(query="standards + apps/<this-app> + recent lessons", limit=10)`.
3. Summarise back to the user **what I found** that's relevant — by title + last-updated date — before acting on it. Brief, scannable.
4. If there's a relevant standard, **state it explicitly** before recommending action. Don't apply it silently.

## When context is auto-injected by hooks

The plugin ships hooks (`session_start`, `user_prompt_submit`, `pre_tool_use_edit`) that pre-fetch relevant brain notes and inject them as `additionalContext`. **Treat auto-injected content the same as a manual `brain_recall` result**:

- **Always cite it** — say "Per auto-recalled Trilium /Standards/X..." rather than treating the content as common knowledge. The provenance matters.
- **Verify before asserting** — auto-recall can pull a stale note; the same drift-check rules apply.
- **Don't double-recall** — if a note is already in context from a hook, calling `brain_recall` again on the same query is wasteful. Use what's there.
- **Surface contradictions** — if the auto-injected note conflicts with the user's request, raise it as you would any other contradiction.

If the Stop hook from the previous session queued proposals, the session-start hook flags them ("N brain proposal(s) pending review"). When the user is open to it, call `brain_review_proposals` to surface the drafts and convert the keepers to `brain_remember`.

## When recommending from memory

**Always cite the source**:
> Per Trilium *Standards / Git Workflow* (last updated 2026-04-25): all PRs target `develop`, never `main`. So I'll branch off `develop` for this fix.

This makes stale citations obvious to the user — they can correct or update the note.

## Before asserting based on memory

Memory can go stale. If a note references `function foo` in `file.ts`, **check `foo` still exists** before recommending action that depends on it. Use `Grep` or `Read` to verify, then either:
- Confirm and proceed
- Or surface the drift: *"The Trilium note from 2026-04-25 says X, but the current code shows Y. Worth updating the note?"*

## When writing back

Use `brain_remember(category, title, body)` for new knowledge. Categories:

- **Standards**: durable rules ("we always use age encryption for secrets")
- **Decisions**: dated, with rationale ("2026-04-26 — chose ink-stable-state over bespoke memo because…")
- **Lessons Learned**: postmortems ("2026-04-25 — Stripe key leaked via transcript; root cause: …")
- **Apps/<name>**: per-app gotchas ("macpool's Dockerfile differs from staging by …")
- **Reviews**: feedback patterns I should internalise

**Never silently overwrite**. Updates use `brain_update` with an explicit "supersedes" link to the prior note + the reason.

**Decisions and Lessons Learned MUST contain**:
- *What changed* — concrete fact
- *Why* — rationale or evidence
- *Evidence* — link to PR / commit / transcript / log

If you can't fill all three, it's an opinion, not a decision. Don't write it.

## When the brain contradicts live state

If `brain_recall` returns something that conflicts with what the current code or current request says:

> *"The brain says X (Trilium note: <link>, 2026-04-25) but the current request is Y. Should I update the note, follow the older standard, or you tell me?"*

Surface contradictions; never silently pick one.

## When to write proactively (without being asked)

These trigger a `brain_remember`:

| Event | Category | Why |
|---|---|---|
| User corrects me with a non-obvious reason | `Standards/` | Codify so I don't make the same mistake |
| A bug fix with a non-obvious root cause | `Lessons Learned/` | Postmortem |
| A design choice between two viable alternatives | `Decisions/` | Future me needs the rationale |
| A new gotcha specific to one app | `Apps/<name>/` | Surfaces on next session in that app |
| An independent reviewer's finding I had to fix | `Reviews/` | Pattern recognition for the next change |

If unsure, **ask the user** before writing — better to skip than to fill the brain with noise.

## When NOT to write

- Routine commits, PRs, and merges — git history already records them.
- Trivial bug fixes where the cause is obvious from the diff.
- Conversational acknowledgements.
- Anything containing a secret value (the audit log + redaction rules apply here too).

## Periodic hygiene

Once a week (or when prompted):
- Review the most-cited notes; flag any that now contradict current code.
- Consolidate near-duplicate Standards into one.
- Archive notes that haven't been cited in 6 months and reference deprecated systems.

This is opt-in (a separate `/matts-second-brain:hygiene` skill, not auto-run).
