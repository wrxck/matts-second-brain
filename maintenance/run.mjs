import { spawn, spawnSync } from 'node:child_process';
import { openSync, writeSync, closeSync, readFileSync, unlinkSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildPrompt, parseHealth, isLockStale, runMaintenance, STATUS_EXIT, ALLOWED_TOOLS,
} from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE_BIN = process.env.CLAUDE_BIN || '/home/matt/.local/bin/claude';
const MODEL = process.env.BRAIN_MAINT_MODEL || 'claude-sonnet-4-6';
const LOCK = join(HERE, '.lock');
const LOG = join(HERE, 'logs', 'maintenance.log');
const TIMEOUT_MS = Number(process.env.BRAIN_MAINT_TIMEOUT_MS) || 10 * 60 * 1000;
const LOCK_TTL_MS = 30 * 60 * 1000; // longer than the agent timeout so a live run is never seen as stale
const PROMPT = buildPrompt({ sinceDays: Number(process.env.BRAIN_MAINT_SINCE_DAYS) || 2 });

function logLine(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  try { mkdirSync(dirname(LOG), { recursive: true }); appendFileSync(LOG, line); } catch { /* logging must never throw */ }
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function acquireLock(depth = 0) {
  try {
    const fd = openSync(LOCK, 'wx'); // O_EXCL: fails if the lock already exists
    writeSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now() }));
    closeSync(fd);
    return { ok: true, owned: true };
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let info = {};
    try { info = JSON.parse(readFileSync(LOCK, 'utf8')); } catch { /* corrupt lock treated as stale */ }
    const pidAlive = info.pid ? isAlive(info.pid) : false;
    const ageMs = info.ts ? Date.now() - info.ts : Infinity;
    if (depth < 1 && isLockStale({ pidAlive, ageMs, ttlMs: LOCK_TTL_MS })) {
      try { unlinkSync(LOCK); } catch { /* lost the race; the retry will report held */ }
      return acquireLock(depth + 1);
    }
    return { ok: false, detail: `held by pid ${info.pid ?? '?'} (age ${Math.round(ageMs / 1000)}s)` };
  }
}

function releaseLock(lock) {
  if (!lock?.owned) return;
  try {
    const info = JSON.parse(readFileSync(LOCK, 'utf8'));
    if (info.pid === process.pid) unlinkSync(LOCK);
  } catch { /* already gone */ }
}

function checkHealth() {
  const r = spawnSync(CLAUDE_BIN, ['mcp', 'list'], { encoding: 'utf8', timeout: 60_000 });
  if (r.error) return { ok: false, detail: `claude mcp list failed: ${r.error.message}` };
  return parseHealth((r.stdout || '') + '\n' + (r.stderr || ''));
}

function runAgent() {
  return new Promise((resolve) => {
    const args = ['-p', PROMPT, '--allowedTools', ALLOWED_TOOLS.join(','), '--model', MODEL];
    const child = spawn(CLAUDE_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    let out = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 5_000);
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: 127, timedOut: false, detail: e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code,
        timedOut,
        detail: timedOut ? `killed after ${TIMEOUT_MS}ms` : err.slice(-400) || undefined,
        summary: out.trim().slice(-1000) || undefined,
      });
    });
  });
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const deps = {
    acquireLock: async () => acquireLock(),
    releaseLock: async (l) => releaseLock(l),
    checkHealth: async () => checkHealth(),
    runAgent: async () => {
      if (dryRun) return { code: 0, timedOut: false, detail: 'dry-run: agent not invoked' };
      const res = await runAgent();
      if (res.summary) logLine({ event: 'agent-summary', summary: res.summary });
      return res;
    },
    log: (entry) => logLine({ dryRun, ...entry }),
  };

  if (dryRun) {
    const h = checkHealth();
    process.stdout.write(`[dry-run] claude: ${CLAUDE_BIN}\n[dry-run] health: ${JSON.stringify(h)}\n[dry-run] timeout: ${TIMEOUT_MS}ms\n[dry-run] prompt:\n${PROMPT}\n`);
  }

  const result = await runMaintenance(deps);
  logLine({ event: 'exit', final: result.status, dryRun });
  process.exitCode = STATUS_EXIT[result.status] ?? 1;
}

main();
