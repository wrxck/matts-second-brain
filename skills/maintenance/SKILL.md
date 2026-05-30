---
name: maintenance
description: "Manage the unattended nightly brain maintenance job (scan recent transcripts, persist durable knowledge, dedupe, reindex). Use when the user says 'set up brain maintenance', 'schedule brain consolidation', 'run brain maintenance now', or wants to check/disable it. Subcommands: install, status, run, dry-run, uninstall, test."
argument-hint: "[install|status|run|dry-run|uninstall|test]"
allowed-tools: "Bash Read"
---

# /matts-second-brain:maintenance — the nightly self-consolidation job

A local cron runs `maintenance/run.mjs`, a tested harness that launches a headless
`claude -p` constrained to the `mcp__second-brain__*` tools to: scan recent transcripts,
recall + persist genuinely durable knowledge (deduping, not duplicating), and reindex
for semantic search. It is **local** because the brain backend (e.g. Trilium) is local —
a cloud `/schedule` routine could not reach it.

## Resolve paths + config first

- Plugin dir: `${CLAUDE_PLUGIN_ROOT}` if set, else the repo root containing this skill.
- Maintenance dir: `<plugin>/maintenance`.
- Read the plugin `userConfig` from `~/.claude.json` (`pluginConfigs[*matts-second-brain*].options`),
  falling back to the manifest defaults:
  - `scheduledMaintenance` (default false), `maintenanceSchedule` (`0 4 * * *`),
    `maintenanceModel` (`claude-sonnet-4-6`), `scanSinceDays` (2), `maintenanceTimeoutMin` (10).

## Subcommands

### install
If `scheduledMaintenance` is false, tell the user to enable it (`/config` or the plugin
config) first — or confirm they want to install anyway. Then run, from the maintenance dir:

```bash
BRAIN_MAINT_CRON="<maintenanceSchedule>" \
BRAIN_MAINT_MODEL="<maintenanceModel>" \
BRAIN_MAINT_SINCE_DAYS="<scanSinceDays>" \
BRAIN_MAINT_TIMEOUT_MS="$(( <maintenanceTimeoutMin> * 60000 ))" \
bash install.sh
```

Then show `crontab -l | grep matts-second-brain-maintenance` to confirm. Remind the user
the cron runs as them, so the brain backend must be reachable from their account.

### status
Show the installed entry (`crontab -l | grep matts-second-brain-maintenance`) and the last
few structured runs (`tail -n 5 maintenance/logs/maintenance.log`). Each line is JSON with a
`status` (ok / locked / unhealthy / failed / timeout) and, for completed runs, an
`agent-summary` of what was persisted/updated/skipped.

### run
`node maintenance/run.mjs` — a real run. Warn first: it scans recent transcripts and may
persist a few notes. Afterwards show the new `agent-summary` log line.

### dry-run
`node maintenance/run.mjs --dry-run` — health-check + print the prompt, no agent invoked. Safe.

### uninstall
`bash maintenance/install.sh --uninstall` — removes the cron entry. Leaves logs in place.

### test
`cd maintenance && node --test` — runs the harness test suite (lock/health/timeout/exit
semantics). Dependency-free; no build step.
