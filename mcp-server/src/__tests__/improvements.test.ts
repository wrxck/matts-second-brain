import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, afterEach } from 'vitest';

import type { BrainAdapter, BrainNote, CreateNoteInput } from '../adapters/index.js';
import { redact, formatEntry, auditWrite, type AuditEntry } from '../audit.js';
import { similarity, findDuplicate } from '../dedup.js';
import { categoryOf, computeStats } from '../stats.js';
import { extractPaths, pathExists, checkCitations } from '../citations.js';

// minimal in-memory adapter mirroring src/__tests__/onboard.test.ts.
class FakeAdapter implements BrainAdapter {
  readonly name = 'fake';
  notes: Array<{ id: string; title: string; body: string; path: string; modifiedAt?: string }> = [];
  nextId = 1;
  async ping() {}
  async search(query: string, opts?: { limit?: number; exactTitle?: boolean }): Promise<BrainNote[]> {
    const limit = opts?.limit ?? 20;
    if (opts?.exactTitle) {
      return this.notes.filter((n) => n.title === query).slice(0, limit).map((n) => ({ id: n.id, title: n.title, path: n.path, modifiedAt: n.modifiedAt }));
    }
    // token-overlap full-text search, mirroring a real backend more closely than
    // bare substring (the new title can be longer than a stored title).
    const qwords = new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    const c = this.notes.filter((n) => {
      const hay = `${n.title} ${n.body}`.toLowerCase();
      if (hay.includes(query.toLowerCase())) return true;
      return hay.split(/[^a-z0-9]+/).filter(Boolean).some((w) => qwords.has(w));
    });
    return c.slice(0, limit).map((n) => ({ id: n.id, title: n.title, path: n.path, modifiedAt: n.modifiedAt }));
  }
  async resolvePath() { return 'parent-id'; }
  async getContent(id: string) { return this.notes.find((n) => n.id === id)?.body ?? ''; }
  async create(input: CreateNoteInput) {
    const id = `fake-${this.nextId++}`;
    const path = `${input.parentPath}/${input.title}`;
    this.notes.push({ id, title: input.title, body: input.body, path });
    return { id, path };
  }
  async setContent() {}
  async addTag() {}
  async listAll(): Promise<BrainNote[]> {
    return this.notes.map((n) => ({ id: n.id, title: n.title, path: n.path, modifiedAt: n.modifiedAt }));
  }
}

describe('audit', () => {
  it('redacts common secret shapes', () => {
    expect(redact('token sk-abcdefghijklmnopqrstuv here')).toContain('[redacted-secret]');
    expect(redact('ghp_0123456789abcdefghijklmnopqrstuvwx')).toBe('[redacted-secret]');
    expect(redact('nothing secret here')).toBe('nothing secret here');
  });
  it('formatEntry never includes a body field and redacts title/detail', () => {
    const e: AuditEntry = { action: 'remember', backend: 'fake', category: 'lessons', title: 'leak sk-abcdefghijklmnopqrstuv', detail: 'ghp_0123456789abcdefghijklmnopqrstuvwx', noteId: 'n1' };
    const line = formatEntry(e, () => 0);
    expect(line).not.toContain('"body"');
    expect(line).not.toContain('sk-abcdefghijklmnopqrstuv');
    expect(line).not.toContain('ghp_0123456789');
    expect(JSON.parse(line)).toMatchObject({ action: 'remember', noteId: 'n1' });
  });
  it('auditWrite routes to an injected sink and never throws', () => {
    const lines: string[] = [];
    expect(() => auditWrite({ action: 'update', backend: 'fake', noteId: 'x' }, (l) => lines.push(l))).not.toThrow();
    expect(lines).toHaveLength(1);
  });
});

describe('dedup', () => {
  it('similarity is 1 for identical and lower for divergent titles', () => {
    expect(similarity('Git Workflow', 'git workflow')).toBe(1);
    expect(similarity('Git Workflow', 'Docker Networking')).toBeLessThan(0.3);
  });
  it('findDuplicate returns an exact-title match at score 1', async () => {
    const a = new FakeAdapter();
    await a.create({ parentPath: 'Claude Memory/Standards', title: 'Git Workflow', body: 'x', tags: [] });
    const dup = await findDuplicate(a, 'Git Workflow');
    expect(dup?.score).toBe(1);
  });
  it('findDuplicate catches a fuzzy near-duplicate above threshold', async () => {
    const a = new FakeAdapter();
    await a.create({ parentPath: 'Claude Memory/Standards', title: 'Fleet secret key management', body: 'b', tags: [] });
    const dup = await findDuplicate(a, 'Fleet secret key management standard');
    expect(dup).not.toBeNull();
    expect(dup!.score).toBeGreaterThanOrEqual(0.6);
  });
  it('findDuplicate returns null when nothing is close', async () => {
    const a = new FakeAdapter();
    await a.create({ parentPath: 'p', title: 'Totally Unrelated Note', body: 'b', tags: [] });
    expect(await findDuplicate(a, 'Stripe webhook signature verification')).toBeNull();
  });
});

describe('stats', () => {
  it('categoryOf reads the segment after the root', () => {
    expect(categoryOf('Claude Memory/Standards/Git Workflow')).toBe('Standards');
    expect(categoryOf(undefined)).toBe('other');
  });
  it('computeStats counts by category and lists recent notes', async () => {
    const a = new FakeAdapter();
    a.notes.push({ id: '1', title: 'A', body: '', path: 'Claude Memory/Standards/A', modifiedAt: new Date().toISOString() });
    a.notes.push({ id: '2', title: 'B', body: '', path: 'Claude Memory/Standards/B', modifiedAt: '2000-01-01T00:00:00Z' });
    a.notes.push({ id: '3', title: 'C', body: '', path: 'Claude Memory/Decisions/C', modifiedAt: new Date().toISOString() });
    const s = await computeStats(a, { recentDays: 7 });
    expect(s.total).toBe(3);
    expect(s.byCategory.Standards).toBe(2);
    expect(s.byCategory.Decisions).toBe(1);
    expect(s.recent.map((r) => r.title).sort()).toEqual(['A', 'C']); // B is too old
  });
});

describe('citations', () => {
  let dir = '';
  afterEach(() => { if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } } });

  it('extractPaths picks file-path-like tokens, not prose', () => {
    const paths = extractPaths('see `src/foo/bar.ts` and lib/util.py but not a sentence.');
    expect(paths).toContain('src/foo/bar.ts');
    expect(paths).toContain('lib/util.py');
    expect(paths).not.toContain('sentence');
  });
  it('pathExists resolves against roots', () => {
    dir = mkdtempSync(join(tmpdir(), 'brain-cit-'));
    writeFileSync(join(dir, 'real.ts'), '');
    expect(pathExists('real.ts', [dir])).toBeTruthy();
    expect(pathExists('gone.ts', [dir])).toBeFalsy();
  });
  it('checkCitations flags only notes whose cited files are missing', async () => {
    dir = mkdtempSync(join(tmpdir(), 'brain-cit-'));
    writeFileSync(join(dir, 'live.ts'), '');
    const a = new FakeAdapter();
    a.notes.push({ id: '1', title: 'fresh', body: 'see `live.ts`', path: 'p' });
    a.notes.push({ id: '2', title: 'stale', body: 'see `dead/old.ts`', path: 'p' });
    const drift = await checkCitations(a, { roots: [dir] });
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ noteId: '2', missing: ['dead/old.ts'] });
  });
});
