import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertMemoryDirectory, isMemoryDirectory } from '../paths.js';

describe('isMemoryDirectory', () => {
  it('accepts claude memory directories in any home', () => {
    expect(isMemoryDirectory('/root/.claude/projects/-home-matt/memory')).toBe(true);
    expect(isMemoryDirectory('/home/matt/.claude/projects/-home-matt-app/memory')).toBe(true);
  });

  it('rejects every other directory', () => {
    for (const p of ['/', '/etc', '/root', '/root/.ssh', '/home/matt/.claude/projects',
      '/home/matt/.claude/projects/x/memory/sub', '/home/matt/app/.claude/projects/x/memory',
      '/root/.claude/projects/../../etc/memory']) {
      expect(isMemoryDirectory(p), p).toBe(false);
    }
  });
});

describe('assertMemoryDirectory', () => {
  it('rejects a missing directory', () => {
    expect(() => assertMemoryDirectory('/nonexistent/.claude/projects/x/memory')).toThrow(/cannot resolve/);
  });

  it('follows symlinks, so a link named like a memory dir cannot point elsewhere', () => {
    const base = mkdtempSync(join(tmpdir(), 'brain-'));
    const target = join(base, 'secrets');
    mkdirSync(target);
    const link = join(base, 'memory');
    symlinkSync(target, link);
    expect(() => assertMemoryDirectory(link)).toThrow(/refusing/);
  });
});
