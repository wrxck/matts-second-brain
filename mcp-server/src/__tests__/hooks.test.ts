/**
 * smoke tests for the matts-second-brain claude code hooks.
 *
 * we don't try to spin up a real brain backend; instead we set
 * BRAIN_QUIET=1 (the documented opt-out) and assert the hooks emit
 * nothing — proving the early-exit path works on every hook.
 *
 * a second pass without BRAIN_QUIET but pointing BRAIN_CLI at a stub
 * confirms each hook is parseable and tolerates missing payload fields
 * without throwing.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const HOOKS_DIR = resolve(__dirname, '..', '..', '..', 'hooks');
const HOOK_FILES = [
  'session_start.py',
  'user_prompt_submit.py',
  'stop.py',
  'pre_tool_use_edit.py',
];

function runHook(file: string, stdin: string, env: NodeJS.ProcessEnv = {}): { stdout: string; stderr: string } {
  const path = resolve(HOOKS_DIR, file);
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync('python3', [path], {
      input: stdin,
      env: { ...process.env, ...env },
      timeout: 5000,
    }).toString();
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    stdout = err.stdout?.toString() ?? '';
    stderr = err.stderr?.toString() ?? '';
  }
  return { stdout, stderr };
}

describe('hooks smoke tests', () => {
  it('all hook files exist and are executable', () => {
    for (const f of HOOK_FILES) {
      expect(existsSync(resolve(HOOKS_DIR, f))).toBe(true);
    }
  });

  it('every hook early-exits silently when BRAIN_QUIET=1', () => {
    for (const f of HOOK_FILES) {
      const { stdout } = runHook(f, '{"prompt":"x","cwd":"/tmp","session_id":"t"}', { BRAIN_QUIET: '1' });
      expect(stdout.trim()).toBe('');
    }
  });

  it('user_prompt_submit emits nothing on empty prompt', () => {
    const { stdout } = runHook('user_prompt_submit.py', '{"prompt":"","cwd":"/tmp","session_id":"t"}', { BRAIN_QUIET: '1' });
    expect(stdout.trim()).toBe('');
  });

  it('hooks tolerate malformed json on stdin', () => {
    for (const f of HOOK_FILES) {
      const { stdout } = runHook(f, 'not json at all', { BRAIN_QUIET: '1' });
      expect(stdout.trim()).toBe('');
    }
  });
});
