// brain-maintenance harness: the deterministic wrapper around the (inherently
// non-deterministic) agent run that does the real brain_scan / recall / remember /
// sync work. everything the control flow needs is injected, so the whole thing can
// be tested without ever spawning claude or touching trilium.

// the six second-brain tools the unattended agent is allowed to call. anything not
// listed is auto-denied in print mode, so the run cannot wander off the brain.
export const ALLOWED_TOOLS = [
  'mcp__second-brain__brain_setup_check',
  'mcp__second-brain__brain_scan_transcripts',
  'mcp__second-brain__brain_recall',
  'mcp__second-brain__brain_remember',
  'mcp__second-brain__brain_update',
  'mcp__second-brain__brain_sync_srag',
];

// build the self-contained prompt the headless agent runs. kept pure so a test can
// assert it stays constrained and covers every step.
export function buildPrompt({ sinceDays = 2, maxCandidates = 12 } = {}) {
  return [
    'You are running unattended brain maintenance. Use ONLY the mcp__second-brain__* tools. Do not touch any repo, file, or shell.',
    '1. Call brain_setup_check. If Trilium is unreachable or setup is broken, STOP immediately and report it — make no writes.',
    `2. Call brain_scan_transcripts with sinceDays=${sinceDays} and maxCandidates=${maxCandidates} to get inferred knowledge candidates from recent sessions.`,
    '3. For each candidate that is genuinely durable KNOWLEDGE (a lesson, standard, decision, or reusable fact, NOT task status or transient state): brain_recall first to find any existing note. If one exists and is now wrong or weaker, brain_update it (supersede with a reason); otherwise brain_remember it. Skip duplicates and anything ephemeral.',
    '4. Finally call brain_sync_srag (incremental) to re-export and reindex for semantic search.',
    'Be conservative: when in doubt, skip. End with a short summary of what you persisted, updated, and skipped.',
  ].join('\n');
}

// parse `claude mcp list` output. healthy only when second-brain shows Connected.
export function parseHealth(mcpListOutput) {
  const line = (mcpListOutput || '').split('\n').find((l) => /(^|\s)second-brain:/.test(l));
  if (!line) return { ok: false, detail: 'second-brain not listed by claude mcp list' };
  const ok = /Connected/i.test(line) && !/Failed/i.test(line);
  return { ok, detail: line.trim() };
}

// a held lockfile is stale when its holder process is gone, or it is older than ttl
// (a crashed run that never cleaned up). guards against a wedged run blocking forever.
export function isLockStale({ pidAlive, ageMs, ttlMs }) {
  if (!pidAlive) return true;
  return ageMs > ttlMs;
}

// map a run status to a process exit code. operational non-events (locked, brain
// down) are exit 0 so cron does not spam; only genuine failures are non-zero.
export const STATUS_EXIT = { ok: 0, locked: 0, unhealthy: 0, failed: 1, timeout: 1 };

// run one maintenance cycle. deps: acquireLock, releaseLock, checkHealth, runAgent, log.
// returns { status, ... }. never throws for an expected outcome; a thrown error from
// a dep still releases the lock via finally before propagating.
export async function runMaintenance(deps) {
  const { acquireLock, releaseLock, checkHealth, runAgent, log } = deps;

  const lock = await acquireLock();
  if (!lock.ok) {
    log({ status: 'locked', detail: lock.detail });
    return { status: 'locked', detail: lock.detail };
  }

  try {
    const health = await checkHealth();
    if (!health.ok) {
      log({ status: 'unhealthy', detail: health.detail });
      return { status: 'unhealthy', detail: health.detail };
    }

    const res = await runAgent();
    if (res.timedOut) {
      log({ status: 'timeout', detail: res.detail });
      return { status: 'timeout', detail: res.detail };
    }
    if (res.code !== 0) {
      log({ status: 'failed', code: res.code });
      return { status: 'failed', code: res.code };
    }

    log({ status: 'ok' });
    return { status: 'ok' };
  } finally {
    await releaseLock(lock);
  }
}
