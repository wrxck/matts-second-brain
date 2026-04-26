/**
 * Obsidian adapter tests — uses a real temporary vault on disk.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObsidianAdapter } from '../obsidian.js';

describe('ObsidianAdapter', () => {
  let vault: string;

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), 'obsidian-test-'));
    process.env.BRAIN_OBSIDIAN_VAULT = vault;
  });

  afterEach(() => {
    delete process.env.BRAIN_OBSIDIAN_VAULT;
    rmSync(vault, { recursive: true, force: true });
  });

  it('ping succeeds when vault exists', async () => {
    const a = new ObsidianAdapter();
    await expect(a.ping()).resolves.toBeUndefined();
  });

  it('search returns notes matching the substring, ordered by recency', async () => {
    mkdirSync(join(vault, 'Standards'), { recursive: true });
    writeFileSync(join(vault, 'Standards', 'Git.md'), '#claude-brain\nUse conventional commits.\n');
    writeFileSync(join(vault, 'Standards', 'Other.md'), 'Unrelated content.\n');
    // Bump mtime of the Git note so it's newer.
    const fresh = Date.now() / 1000;
    utimesSync(join(vault, 'Standards', 'Git.md'), fresh, fresh);
    utimesSync(join(vault, 'Standards', 'Other.md'), fresh - 100, fresh - 100);

    const a = new ObsidianAdapter();
    const out = await a.search('conventional');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('Standards/Git');
    expect(out[0].title).toBe('Git');
  });

  it('search with tag filters out notes that do not contain the tag', async () => {
    writeFileSync(join(vault, 'Tagged.md'), '#claude-brain\nbody');
    writeFileSync(join(vault, 'Untagged.md'), 'plain body');

    const a = new ObsidianAdapter();
    const tagged = await a.search('body', { tag: 'claude-brain' });
    expect(tagged.map(n => n.id)).toEqual(['Tagged']);
  });

  it('resolvePath creates intermediate directories when create=true', async () => {
    const a = new ObsidianAdapter();
    const out = await a.resolvePath('Foo/Bar', { create: true });
    expect(out).toBe('Foo/Bar');
    expect(existsSync(join(vault, 'Foo', 'Bar'))).toBe(true);
  });

  it('resolvePath throws when create=false and the path is missing', async () => {
    const a = new ObsidianAdapter();
    await expect(a.resolvePath('Nope', { create: false })).rejects.toThrow(/not found/);
  });

  it('create writes a markdown file with tag line + body in the right place', async () => {
    const a = new ObsidianAdapter();
    const { id, path } = await a.create({
      parentPath: 'Memory',
      title: 'Today',
      body: 'Hello world',
      tags: ['claude-brain', 'log'],
    });
    expect(id).toBe('Memory/Today');
    expect(path).toBe('Memory/Today');

    const file = join(vault, 'Memory', 'Today.md');
    expect(existsSync(file)).toBe(true);
    const contents = readFileSync(file, 'utf8');
    expect(contents).toBe('#claude-brain #log\n\nHello world\n');
  });

  it('getContent reads the raw markdown body', async () => {
    mkdirSync(join(vault, 'X'));
    writeFileSync(join(vault, 'X', 'Y.md'), 'raw body\nline 2');
    const a = new ObsidianAdapter();
    expect(await a.getContent('X/Y')).toBe('raw body\nline 2');
  });

  it('setContent overwrites an existing note', async () => {
    writeFileSync(join(vault, 'Note.md'), 'old');
    const a = new ObsidianAdapter();
    await a.setContent('Note', 'new content');
    expect(readFileSync(join(vault, 'Note.md'), 'utf8')).toBe('new content');
  });

  it('addTag prepends the tag and is idempotent', async () => {
    writeFileSync(join(vault, 'Note.md'), 'body');
    const a = new ObsidianAdapter();
    await a.addTag('Note', 'mem');
    expect(readFileSync(join(vault, 'Note.md'), 'utf8')).toBe('#mem\nbody');
    await a.addTag('Note', 'mem'); // already present
    expect(readFileSync(join(vault, 'Note.md'), 'utf8')).toBe('#mem\nbody');
  });

  it('listAll walks the vault and respects the tag filter', async () => {
    mkdirSync(join(vault, 'A'));
    writeFileSync(join(vault, 'A', 'one.md'), '#claude-brain\n1');
    writeFileSync(join(vault, 'A', 'two.md'), 'no tag');

    const a = new ObsidianAdapter();
    const all = await a.listAll();
    expect(all.map(n => n.id).sort()).toEqual(['A/one', 'A/two']);
    const tagged = await a.listAll({ tag: 'claude-brain' });
    expect(tagged.map(n => n.id)).toEqual(['A/one']);
  });
});
