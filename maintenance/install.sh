#!/usr/bin/env bash
# install (or refresh) the matts-second-brain nightly maintenance cron entry.
# idempotent: re-running replaces the managed entry. config comes from env (the
# /matts-second-brain:maintenance skill sets it from the plugin userConfig), with
# sensible defaults otherwise. node is resolved absolutely because cron runs with a
# minimal PATH. pass --uninstall to remove the entry.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARKER="# matts-second-brain-maintenance"

if [ "${1:-}" = "--uninstall" ]; then
  (crontab -l 2>/dev/null | grep -vF "$MARKER" | sed '/^[[:space:]]*$/d' | crontab -) || true
  echo "removed matts-second-brain-maintenance cron entry"
  exit 0
fi

NODE="$(command -v node)"
SCHEDULE="${BRAIN_MAINT_CRON:-0 4 * * *}"
MODEL="${BRAIN_MAINT_MODEL:-claude-sonnet-4-6}"
SINCE_DAYS="${BRAIN_MAINT_SINCE_DAYS:-2}"
TIMEOUT_MS="${BRAIN_MAINT_TIMEOUT_MS:-600000}"

mkdir -p "$DIR/logs"

ENVV="BRAIN_MAINT_MODEL=$MODEL BRAIN_MAINT_SINCE_DAYS=$SINCE_DAYS BRAIN_MAINT_TIMEOUT_MS=$TIMEOUT_MS"
LINE="$SCHEDULE flock -n $DIR/.cron.lock env $ENVV $NODE $DIR/run.mjs >> $DIR/logs/cron.log 2>&1 $MARKER"

current="$(crontab -l 2>/dev/null | grep -vF "$MARKER" || true)"
printf '%s\n%s\n' "$current" "$LINE" | sed '/^[[:space:]]*$/d' | crontab -

echo "installed matts-second-brain maintenance cron:"
echo "  $LINE"
echo "node:  $NODE"
echo "logs:  $DIR/logs/{cron,maintenance}.log"
