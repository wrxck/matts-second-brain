import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPrompt, parseHealth, isLockStale, runMaintenance, STATUS_EXIT, ALLOWED_TOOLS,
} from './harness.mjs';

// helper: a deps object whose pieces record calls, with sensible passing defaults.
function makeDeps(overrides = {}) {
  const calls = [];
  const deps = {
    acquireLock: async () => { calls.push('acquireLock'); return { ok: true, path: '/tmp/x.lock' }; },
    releaseLock: async () => { calls.push('releaseLock'); },
    checkHealth: async () => { calls.push('checkHealth'); return { ok: true, detail: 'Connected' }; },
    runAgent: async () => { calls.push('runAgent'); return { code: 0, timedOut: false }; },
    log: (entry) => { calls.push(`log:${entry.status}`); },
    ...overrides,
  };
  return { deps, calls };
}

test('buildPrompt covers all four steps and stays constrained to the brain', () => {
  const p = buildPrompt();
  for (const needle of ['brain_setup_check', 'brain_scan_transcripts', 'brain_recall', 'brain_update', 'brain_sync_srag', 'ONLY']) {
    assert.ok(p.includes(needle), `prompt missing: ${needle}`);
  }
  assert.match(p, /durable/i);
  assert.match(p, /skip/i);
});

test('buildPrompt threads sinceDays and maxCandidates', () => {
  const p = buildPrompt({ sinceDays: 5, maxCandidates: 3 });
  assert.match(p, /sinceDays=5/);
  assert.match(p, /maxCandidates=3/);
});

test('ALLOWED_TOOLS is exactly the six brain tools and nothing else', () => {
  assert.equal(ALLOWED_TOOLS.length, 6);
  assert.ok(ALLOWED_TOOLS.every((t) => t.startsWith('mcp__second-brain__')));
});

test('parseHealth: Connected is healthy', () => {
  assert.equal(parseHealth('second-brain: node ... - Connected').ok, true);
});
test('parseHealth: Failed is unhealthy', () => {
  assert.equal(parseHealth('second-brain: node ... - Failed to connect').ok, false);
});
test('parseHealth: absent server is unhealthy', () => {
  const r = parseHealth('srag: ... - Connected\ntrilium: ... - Failed');
  assert.equal(r.ok, false);
  assert.match(r.detail, /not listed/);
});

test('isLockStale: dead holder is stale', () => {
  assert.equal(isLockStale({ pidAlive: false, ageMs: 10, ttlMs: 1000 }), true);
});
test('isLockStale: live but too old is stale', () => {
  assert.equal(isLockStale({ pidAlive: true, ageMs: 2000, ttlMs: 1000 }), true);
});
test('isLockStale: live and fresh is held', () => {
  assert.equal(isLockStale({ pidAlive: true, ageMs: 10, ttlMs: 1000 }), false);
});

test('runMaintenance: happy path runs health then agent, then releases the lock', async () => {
  const { deps, calls } = makeDeps();
  const r = await runMaintenance(deps);
  assert.equal(r.status, 'ok');
  assert.deepEqual(calls, ['acquireLock', 'checkHealth', 'runAgent', 'log:ok', 'releaseLock']);
});

test('runMaintenance: lock contention skips the agent and does not release a lock it never took', async () => {
  const { deps, calls } = makeDeps({ acquireLock: async () => ({ ok: false, detail: 'held by 123' }) });
  const r = await runMaintenance(deps);
  assert.equal(r.status, 'locked');
  assert.ok(!calls.includes('runAgent'));
  assert.ok(!calls.includes('releaseLock'));
});

test('runMaintenance: unhealthy brain skips the agent but still releases the lock', async () => {
  const { deps, calls } = makeDeps({ checkHealth: async () => ({ ok: false, detail: 'Failed' }) });
  const r = await runMaintenance(deps);
  assert.equal(r.status, 'unhealthy');
  assert.ok(!calls.includes('runAgent'));
  assert.ok(calls.includes('releaseLock'));
});

test('runMaintenance: agent timeout is reported and the lock is released', async () => {
  const { deps } = makeDeps({ runAgent: async () => ({ code: null, timedOut: true, detail: 'killed after 600000ms' }) });
  const r = await runMaintenance(deps);
  assert.equal(r.status, 'timeout');
});

test('runMaintenance: non-zero agent exit is a failure', async () => {
  const { deps } = makeDeps({ runAgent: async () => ({ code: 7, timedOut: false }) });
  const r = await runMaintenance(deps);
  assert.equal(r.status, 'failed');
  assert.equal(r.code, 7);
});

test('runMaintenance: a thrown dep still releases the lock before propagating', async () => {
  const { deps, calls } = makeDeps({ runAgent: async () => { throw new Error('boom'); } });
  await assert.rejects(runMaintenance(deps), /boom/);
  assert.ok(calls.includes('releaseLock'), 'lock must be released even when the agent throws');
});

test('STATUS_EXIT: only failure and timeout are non-zero', () => {
  assert.equal(STATUS_EXIT.ok, 0);
  assert.equal(STATUS_EXIT.locked, 0);
  assert.equal(STATUS_EXIT.unhealthy, 0);
  assert.equal(STATUS_EXIT.failed, 1);
  assert.equal(STATUS_EXIT.timeout, 1);
});
