---
name: hygiene
description: "Periodic brain hygiene: dedupe near-duplicate notes, flag stale file citations and contradictions, archive long-unused notes, and reindex. Use when the user says 'brain hygiene', 'consolidate the brain', 'clean up duplicate notes', 'find stale notes', or after a long burst of writing. Opt-in and dry-run by default."
argument-hint: "[--apply] [--category standards|decisions|lessons|apps|reviews|drafts]"
allowed-tools: "Bash Read Grep"
---

# /matts-second-brain:hygiene — keep the brain healthy

Periodic consolidation so the brain stays trustworthy as it grows. Opt-in (not
auto-run; the nightly maintenance job may also invoke this). **Dry-run by default** —
report findings and propose changes, and only write when the user confirms or `--apply`
is passed. Never delete; archive instead.

## 1. snapshot
Call `brain_stats`. Report totals by category and recent growth; note any category
ballooning or going stale.

## 2. stale citations
Call `brain_check_citations`. For each flagged note, read it and decide:
- file moved -> propose `brain_update` with the corrected path
- system gone -> propose archiving (do not delete)

## 3. near-duplicate consolidation
For each category (Standards first), use `brain_recall(category)` and
`brain_search_semantic` to find notes covering the same ground. Propose merging each
pair into one canonical note: `brain_update` the survivor with the union of content,
then supersede the others with a reason. **Present pairs for confirmation — never
auto-merge.** (brain_remember already blocks new near-duplicates at write time; this
cleans up ones that predate that.)

## 4. contradiction sweep
Where two notes disagree, or a note contradicts current code (verify with `Grep`/`Read`
per the _discipline rule), surface it and propose the correction.

## 5. archive stale
Notes unmodified for 6+ months that reference deprecated systems: propose archiving
(tag `#archived` or move to Drafts). Do not delete.

## 6. reindex
After any writes, call `brain_sync_srag` so semantic search reflects the changes.

## output
A concise report: counts, proposed merges, stale citations, archive candidates. In
dry-run nothing is written; with `--apply` (or an explicit user yes) execute only the
confirmed changes, each as an auditable `brain_update`.
