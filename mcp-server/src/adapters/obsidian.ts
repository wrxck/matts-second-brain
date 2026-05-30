/**
 * Obsidian adapter — operates on a vault directory of markdown files.
 *
 * Env:
 *   BRAIN_OBSIDIAN_VAULT     Absolute path to the vault root (required)
 *
 * Conventions:
 *  - Each "note" is a `.md` file. The "id" is the relative path from the
 *    vault root, with `.md` stripped.
 *  - Folders correspond to taxonomy paths ("Standards/Git Workflow.md"
 *    in the vault = path "Standards/Git Workflow").
 *  - Tags are written inline as `#tag` near the top of the body.
 *  - Search is grep-based, ranked by recency. No full embeddings yet —
 *    layer srag on top if you want semantic search.
 *
 * Limitations vs Trilium:
 *  - No native attribute system; tags live in the markdown itself.
 *  - Search is substring, not semantic.
 *  - Resolving paths means making directories on disk.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { BrainAdapter, BrainNote, CreateNoteInput } from './index.js';

function vaultRoot(): string {
  const v = process.env.BRAIN_OBSIDIAN_VAULT;
  if (!v) throw new Error('Obsidian adapter: BRAIN_OBSIDIAN_VAULT env var must point at the vault root');
  if (!existsSync(v)) throw new Error(`Obsidian adapter: vault not found at ${v}`);
  return v;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;   // skip hidden (.obsidian, .git)
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && entry.name.endsWith('.md')) yield full;
  }
}

function pathToId(vault: string, full: string): string {
  return relative(vault, full).replace(/\.md$/, '');
}

function idToPath(vault: string, id: string): string {
  return join(vault, `${id}.md`);
}

export class ObsidianAdapter implements BrainAdapter {
  readonly name = 'obsidian';
  private vault: string;

  constructor() {
    this.vault = vaultRoot();
  }

  async ping(): Promise<void> {
    if (!existsSync(this.vault)) throw new Error(`vault missing: ${this.vault}`);
  }

  async search(query: string, opts: { limit?: number; tag?: string; exactTitle?: boolean } = {}): Promise<BrainNote[]> {
    const limit = opts.limit ?? 20;
    const needle = query.toLowerCase();
    const tagNeedle = opts.tag ? `#${opts.tag.toLowerCase()}` : null;
    const matches: Array<{ id: string; title: string; mtime: number }> = [];
    for (const file of walk(this.vault)) {
      let body: string;
      try { body = readFileSync(file, 'utf8'); } catch { continue; }
      const lower = body.toLowerCase();
      if (tagNeedle && !lower.includes(tagNeedle)) continue;
      if (needle && !lower.includes(needle) && !file.toLowerCase().includes(needle)) continue;
      const id = pathToId(this.vault, file);
      const title = id.split('/').pop()!;
      if (opts.exactTitle && title !== query) continue;
      matches.push({ id, title, mtime: statSync(file).mtimeMs });
    }
    matches.sort((a, b) => b.mtime - a.mtime);
    return matches.slice(0, limit).map(m => ({
      id: m.id,
      title: m.title,
      modifiedAt: new Date(m.mtime).toISOString(),
      path: m.id,
    }));
  }

  async resolvePath(path: string, opts: { create?: boolean } = {}): Promise<string> {
    // For Obsidian a "path id" IS the directory path — there's no separate
    // id system. We just ensure the directory exists if create=true.
    const dir = join(this.vault, path);
    if (!existsSync(dir)) {
      if (!opts.create) throw new Error(`Obsidian path not found: ${path}`);
      mkdirSync(dir, { recursive: true });
    }
    return path;   // the path IS the id for parent purposes
  }

  async getContent(id: string): Promise<string> {
    const file = idToPath(this.vault, id);
    if (!existsSync(file)) throw new Error(`Obsidian note not found: ${id}`);
    return readFileSync(file, 'utf8');
  }

  async create(input: CreateNoteInput): Promise<{ id: string; path: string }> {
    await this.resolvePath(input.parentPath, { create: true });
    const safeTitle = input.title.replace(/[/\\]/g, '_');
    const id = `${input.parentPath}/${safeTitle}`;
    const file = idToPath(this.vault, id);
    if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
    const tagLine = input.tags.length ? input.tags.map(t => `#${t}`).join(' ') + '\n\n' : '';
    writeFileSync(file, `${tagLine}${input.body}\n`);
    return { id, path: id };
  }

  async setContent(id: string, body: string): Promise<void> {
    const file = idToPath(this.vault, id);
    if (!existsSync(file)) throw new Error(`Obsidian note not found: ${id}`);
    writeFileSync(file, body);
  }

  async addTag(id: string, tag: string): Promise<void> {
    const file = idToPath(this.vault, id);
    if (!existsSync(file)) throw new Error(`Obsidian note not found: ${id}`);
    const body = readFileSync(file, 'utf8');
    if (body.includes(`#${tag}`)) return;       // already present
    writeFileSync(file, `#${tag}\n${body}`);    // prepend
  }

  async listAll(opts: { underPath?: string; tag?: string; limit?: number } = {}): Promise<BrainNote[]> {
    const limit = opts.limit ?? 5000;
    const tagNeedle = opts.tag ? `#${opts.tag.toLowerCase()}` : null;
    const root = opts.underPath ? join(this.vault, opts.underPath) : this.vault;
    const out: BrainNote[] = [];
    if (!existsSync(root)) return out;
    for (const file of walk(root)) {
      if (out.length >= limit) break;
      if (tagNeedle) {
        try {
          if (!readFileSync(file, 'utf8').toLowerCase().includes(tagNeedle)) continue;
        } catch { continue; }
      }
      const id = pathToId(this.vault, file);
      out.push({ id, title: id.split('/').pop()!, modifiedAt: new Date(statSync(file).mtimeMs).toISOString(), path: id });
    }
    return out;
  }
}
