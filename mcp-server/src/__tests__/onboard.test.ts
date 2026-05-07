import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BrainAdapter, BrainNote, CreateNoteInput } from '../adapters/index.js';
import { onboardDirectory } from '../onboard.js';

class FakeAdapter implements BrainAdapter {
  readonly name = 'fake';
  notes: Array<{ id: string; title: string; body: string; tags: string[]; path: string }> = [];
  nextId = 1;

  async ping() {}

  async search(query: string, opts?: { limit?: number; tag?: string; exactTitle?: boolean }): Promise<BrainNote[]> {
    const limit = opts?.limit ?? 20;
    let candidates: typeof this.notes;
    if (opts?.exactTitle) {
      // exact title only — mirrors trilium structured search behaviour
      candidates = this.notes.filter(n => n.title === query);
    } else {
      // full-text: match title or body, mirrors trilium free-text behaviour
      // (body matches can crowd out the real title match when limit is small)
      candidates = this.notes.filter(
        n =>
          n.title.toLowerCase().includes(query.toLowerCase()) ||
          n.body.toLowerCase().includes(query.toLowerCase()),
      );
    }
    return candidates
      .slice(0, limit)
      .map(n => ({ id: n.id, title: n.title, modifiedAt: '2026-05-06', path: n.path }));
  }

  async resolvePath() {
    return 'parent-id';
  }

  async getContent(id: string) {
    return this.notes.find(n => n.id === id)?.body ?? '';
  }

  async create(input: CreateNoteInput): Promise<{ id: string; path: string }> {
    const id = `fake-${this.nextId++}`;
    const path = `${input.parentPath}/${input.title}`;
    this.notes.push({ id, title: input.title, body: input.body, tags: input.tags, path });
    return { id, path };
  }

  async setContent() {}
  async addTag() {}

  async listAll() {
    return this.notes.map(n => ({ id: n.id, title: n.title, path: n.path }));
  }
}

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'brain-onboard-'));
}

function writeFile(dir: string, name: string, content: string) {
  writeFileSync(join(dir, name), content, 'utf8');
}

describe('onboardDirectory', () => {
  let dir: string;
  let adapter: FakeAdapter;

  beforeEach(() => {
    dir = makeDir();
    adapter = new FakeAdapter();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // 1. happy path — 3 files created, source files survive
  it('happy path: creates 3 notes, source files untouched', async () => {
    writeFile(dir, 'feedback_git_commit_style.md', '# Git Commit Style\n\nAlways use conventional commits.');
    writeFile(dir, 'project_secret_scanning.md', '# Secret Scanning\n\nDecision to add gitleaks.');
    writeFile(dir, 'lesson_docker_rootless.md', '# Docker Rootless\n\nWhat: run containers rootless.\nWhy: security hardening.\nEvidence: CVE-2019-5736 mitigation.');

    const report = await onboardDirectory(adapter, { directory: dir, dryRun: false, deleteOnSuccess: false });

    expect(report.created).toBe(3);
    expect(report.skipped).toBe(0);
    expect(report.failed).toBe(0);
    expect(adapter.notes).toHaveLength(3);

    expect(existsSync(join(dir, 'feedback_git_commit_style.md'))).toBe(true);
    expect(existsSync(join(dir, 'project_secret_scanning.md'))).toBe(true);
    expect(existsSync(join(dir, 'lesson_docker_rootless.md'))).toBe(true);

    expect(report.entries.every(e => e.status === 'created')).toBe(true);
    expect(report.entries.every(e => e.sourceDeleted === undefined)).toBe(true);
  });

  // 2. dry-run: nothing written, adapter stays empty, skipped increments
  it('dry-run: no notes created, source files exist, skipped increments', async () => {
    writeFile(dir, 'feedback_dry_test.md', '# Dry Test\n\nSome content here.');
    writeFile(dir, 'lesson_dry_lesson.md', '# Dry Lesson\n\nWhat: a thing.\nWhy: reasons.\nEvidence: tests.');
    writeFile(dir, 'project_dry_project.md', '# Dry Project\n\nA project decision.');

    const report = await onboardDirectory(adapter, { directory: dir, dryRun: true, deleteOnSuccess: false });

    expect(report.dryRun).toBeTruthy();
    expect(report.created).toBe(0);
    expect(report.skipped).toBe(3);
    expect(adapter.notes).toHaveLength(0);
    expect(report.entries.every(e => e.status === 'dry-run')).toBe(true);

    expect(existsSync(join(dir, 'feedback_dry_test.md'))).toBe(true);
  });

  // 3. delete-on-success: source files removed, one entry per file with sourceDeleted=true
  it('delete-on-success: source files removed, single entry per file', async () => {
    writeFile(dir, 'feedback_delete_test.md', '# Delete Test\n\nContent to migrate.');
    writeFile(dir, 'project_delete_project.md', '# Delete Project\n\nA project to delete.');
    writeFile(dir, 'lesson_delete_lesson.md', '# Delete Lesson\n\nWhat: test.\nWhy: deletion.\nEvidence: files gone.');

    const report = await onboardDirectory(adapter, { directory: dir, dryRun: false, deleteOnSuccess: true });

    expect(report.created).toBe(3);
    expect(report.deletedSources).toBe(3);
    expect(report.deletionFailures).toBe(0);
    expect(adapter.notes).toHaveLength(3);
    // exactly one entry per file
    expect(report.entries).toHaveLength(3);
    expect(report.entries.every(e => e.status === 'created')).toBe(true);
    expect(report.entries.every(e => e.sourceDeleted === true)).toBe(true);

    expect(existsSync(join(dir, 'feedback_delete_test.md'))).toBe(false);
    expect(existsSync(join(dir, 'project_delete_project.md'))).toBe(false);
    expect(existsSync(join(dir, 'lesson_delete_lesson.md'))).toBe(false);
  });

  // 4. idempotency: skip if note with same title already exists in the right category
  it('idempotency: skips file if title already exists in adapter', async () => {
    adapter.notes.push({
      id: 'existing-1',
      title: 'Existing thing',
      body: 'pre-existing',
      tags: ['claude-brain'],
      path: 'Claude Memory/Standards/Existing thing',
    });

    writeFile(dir, 'feedback_existing_thing.md', '# Existing thing\n\nThis already exists.');

    const report = await onboardDirectory(adapter, { directory: dir, dryRun: false, deleteOnSuccess: false });

    expect(report.created).toBe(0);
    expect(report.skipped).toBe(1);
    expect(adapter.notes).toHaveLength(1);
    expect(report.entries[0].status).toBe('skipped-exists');
  });

  // 5. decisions/lessons: body structure synthesis when headers missing
  it('synthesises What/Why/Evidence headers for lessons without structure', async () => {
    writeFile(dir, 'lesson_test_thing.md', '# Test Thing\n\nraw content with no structure at all.');

    const report = await onboardDirectory(adapter, { directory: dir, dryRun: false, deleteOnSuccess: false });

    expect(report.created).toBe(1);
    const note = adapter.notes[0];
    expect(note.body).toMatch(/What:/i);
    expect(note.body).toMatch(/Why:/i);
    expect(note.body).toMatch(/Evidence:/i);
    expect(note.body).toContain('raw content with no structure at all');
  });

  // 6. unknown prefix: skipped-no-category
  it('skips file with unrecognised prefix', async () => {
    writeFile(dir, 'random_thing.md', '# Random Thing\n\nSome content.');

    const report = await onboardDirectory(adapter, { directory: dir, dryRun: false, deleteOnSuccess: false });

    expect(report.skipped).toBe(1);
    expect(adapter.notes).toHaveLength(0);
    expect(report.entries[0].status).toBe('skipped-no-category');
    expect(typeof report.entries[0].reason).toBe('string');
  });

  // 7. MEMORY.md and README.md are excluded by default
  it('excludes MEMORY.md and README.md by default', async () => {
    writeFile(dir, 'MEMORY.md', '# Memory\n\nThis should be skipped.');
    writeFile(dir, 'README.md', '# Readme\n\nAlso skipped.');
    writeFile(dir, 'feedback_keep_me.md', '# Keep Me\n\nThis should be processed.');

    const report = await onboardDirectory(adapter, { directory: dir, dryRun: false, deleteOnSuccess: false });

    expect(report.total).toBe(1);
    expect(report.created).toBe(1);
    expect(adapter.notes).toHaveLength(1);
    expect(adapter.notes[0].title).toBe('Keep Me');
  });

  // 8. yaml frontmatter stripped; H1 becomes title; remaining is body
  it('strips yaml frontmatter and derives title from H1', async () => {
    const content = `---
name: foo
date: 2026-05-06
---

# Frontmatter Title

The real body content goes here.`;
    writeFile(dir, 'feedback_frontmatter_file.md', content);

    const report = await onboardDirectory(adapter, { directory: dir, dryRun: false, deleteOnSuccess: false });

    expect(report.created).toBe(1);
    const note = adapter.notes[0];
    expect(note.title).toBe('Frontmatter Title');
    expect(note.body).toContain('The real body content goes here');
    expect(note.body).not.toContain('name: foo');
  });

  // bonus: imported-from-disk tag present on all created notes
  it('includes imported-from-disk tag on all created notes', async () => {
    writeFile(dir, 'standard_git_workflow.md', '# Git Workflow\n\nAlways use conventional commits.');

    await onboardDirectory(adapter, { directory: dir, dryRun: false, deleteOnSuccess: false });

    expect(adapter.notes).toHaveLength(1);
    expect(adapter.notes[0].tags).toContain('imported-from-disk');
  });

  // bonus: decisions body also gets synthesised headers
  it('synthesises What/Why/Evidence for decisions without structure', async () => {
    writeFile(dir, 'decision_use_postgres.md', '# Use Postgres\n\nWe picked postgres for storage.');

    const report = await onboardDirectory(adapter, { directory: dir, dryRun: false, deleteOnSuccess: false });

    expect(report.created).toBe(1);
    const note = adapter.notes[0];
    expect(note.body).toMatch(/What:/i);
    expect(note.body).toMatch(/Why:/i);
    expect(note.body).toMatch(/Evidence:/i);
    expect(note.body).toContain('We picked postgres for storage');
  });

  // regression: a note with the same title in the wrong category must not prevent creation.
  // pre-fix: search returns it, title matches, file is skipped (false-positive).
  // post-fix: category path check rejects the wrong-category match, note is created.
  it('exactTitle+category: same-title note in wrong category does not prevent creation', async () => {
    adapter.notes.push({
      id: 'wrong-cat-1',
      title: 'Test thing',
      body: 'An old lesson with the same title.',
      tags: ['claude-brain'],
      path: 'Claude Memory/Lessons Learned/Test thing', // lessons, not standards
    });

    // feedback_ prefix maps to standards
    writeFile(dir, 'feedback_test_thing.md', '# Test thing\n\nA brand new standard.');

    const report = await onboardDirectory(adapter, { directory: dir, dryRun: false, deleteOnSuccess: false });

    // wrong-category match rejected → new note created under standards
    expect(report.created).toBe(1);
    expect(report.skipped).toBe(0);
    expect(adapter.notes.filter(n => n.title === 'Test thing')).toHaveLength(2);
  });

  // walker safety: symlinks are skipped
  it('symlinks are skipped', async () => {
    writeFile(dir, 'feedback_real.md', '# Real Note\n\nActual content.');
    symlinkSync(join(dir, 'feedback_real.md'), join(dir, 'feedback_symlink.md'));

    const report = await onboardDirectory(adapter, { directory: dir, dryRun: false, deleteOnSuccess: false });

    // only the real file should be counted
    expect(report.total).toBe(1);
    expect(report.created).toBe(1);
    expect(adapter.notes).toHaveLength(1);
  });

  // dry-run counts as skipped
  it('dry-run increments skipped counter', async () => {
    writeFile(dir, 'feedback_a.md', '# Note A\n\nContent.');
    writeFile(dir, 'lesson_b.md', '# Note B\n\nWhat: x.\nWhy: y.\nEvidence: z.');

    const report = await onboardDirectory(adapter, { directory: dir, dryRun: true });

    expect(report.skipped).toBe(2);
    expect(report.created).toBe(0);
  });
});
