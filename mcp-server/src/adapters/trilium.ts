/**
 * Trilium Notes adapter.
 *
 * Env:
 *   TRILIUM_URL              (default: http://127.0.0.1:8787)
 *   TRILIUM_ETAPI_TOKEN      (required if not in token files below)
 *
 * Token resolution if env unset:
 *   1. /etc/claude-brain/trilium-token (multi-user shared, mode 0640 group claude)
 *   2. ~/.trilium-mcp/config.properties (compatibility with the Java MCP layout)
 */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BrainAdapter, BrainNote, CreateNoteInput } from './index.js';

interface Config { url: string; token: string; }

function loadConfig(): Config {
  const url = process.env.TRILIUM_URL ?? 'http://127.0.0.1:8787';
  if (process.env.TRILIUM_ETAPI_TOKEN) return { url, token: process.env.TRILIUM_ETAPI_TOKEN };

  const sharedPath = '/etc/claude-brain/trilium-token';
  if (existsSync(sharedPath)) {
    try {
      const t = readFileSync(sharedPath, 'utf8').trim();
      if (t) return { url, token: t };
    } catch { /* not readable — try next */ }
  }

  const userPath = join(homedir(), '.trilium-mcp', 'config.properties');
  if (existsSync(userPath)) {
    const c = readFileSync(userPath, 'utf8');
    const tokenMatch = c.match(/^trilium\.token\s*=\s*(.+)$/m);
    const urlMatch = c.match(/^trilium\.url\s*=\s*(.+)$/m);
    if (tokenMatch) return { url: urlMatch ? urlMatch[1].trim() : url, token: tokenMatch[1].trim() };
  }

  throw new Error(
    'Trilium adapter: no ETAPI token found. Set TRILIUM_ETAPI_TOKEN, write to ' +
      '/etc/claude-brain/trilium-token (multi-user), or create ~/.trilium-mcp/config.properties.',
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' } as const)[ch as '<' | '>' | '&']);
}

/** escape backslashes and double-quotes for use inside trilium structured-search string literals. */
function escapeQuotes(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Trilium label names cannot contain '-'; the UI silently converts to '_'.
 *  Normalise so callers can use the friendlier "claude-brain" everywhere. */
function normaliseLabel(tag: string): string {
  return tag.replace(/-/g, '_');
}

export class TriliumAdapter implements BrainAdapter {
  readonly name = 'trilium';
  private cfg: Config;

  constructor() {
    this.cfg = loadConfig();
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await fetch(`${this.cfg.url}/etapi${path}`, {
      method,
      headers: {
        Authorization: this.cfg.token,
        'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json',
      },
      body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    if (!r.ok) throw new Error(`Trilium ${method} ${path} → ${r.status}: ${await r.text().catch(() => '')}`);
    if (r.status === 204) return undefined as T;
    const ct = r.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) return (await r.json()) as T;
    return (await r.text()) as T;
  }

  async ping(): Promise<void> {
    await this.req('GET', '/app-info');
  }

  async search(query: string, opts: { limit?: number; tag?: string; exactTitle?: boolean } = {}): Promise<BrainNote[]> {
    const limit = opts.limit ?? 20;
    let q: string;
    if (opts.exactTitle) {
      const escaped = escapeQuotes(query);
      q = opts.tag
        ? `note.title = "${escaped}" #${normaliseLabel(opts.tag)}`
        : `note.title = "${escaped}"`;
    } else {
      q = opts.tag ? `#${normaliseLabel(opts.tag)} ${query}` : query;
    }
    const params = new URLSearchParams({ search: q, limit: String(limit), orderBy: 'dateModified', orderDirection: 'desc' });
    const data = await this.req<{ results: Array<{ noteId: string; title: string; dateModified?: string; paths?: Array<{ path: string }> }> }>(
      'GET', `/notes?${params}`,
    );
    return (data.results ?? []).map(n => ({
      id: n.noteId,
      title: n.title,
      modifiedAt: n.dateModified,
      // first path breadcrumb if trilium returns it; falls through to undefined otherwise
      path: n.paths?.[0]?.path,
    }));
  }

  async resolvePath(path: string, opts: { create?: boolean } = {}): Promise<string> {
    const segments = path.split('/').filter(Boolean);
    let parentId = 'root';
    for (const seg of segments) {
      const found = await this.search(`note.parents.noteId = "${escapeQuotes(parentId)}" AND note.title = "${escapeQuotes(seg)}"`, { limit: 1 });
      if (found.length > 0) { parentId = found[0].id; continue; }
      if (!opts.create) throw new Error(`Trilium path not found: ${path} (stuck at ${seg})`);
      const created = await this.req<{ note: { noteId: string } }>('POST', '/create-note', {
        parentNoteId: parentId, title: seg, type: 'text', content: '',
      });
      parentId = created.note.noteId;
    }
    return parentId;
  }

  async getContent(id: string): Promise<string> {
    const html = await this.req<string>('GET', `/notes/${id}/content`);
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  async create(input: CreateNoteInput): Promise<{ id: string; path: string }> {
    const parentId = await this.resolvePath(input.parentPath, { create: true });
    const created = await this.req<{ note: { noteId: string } }>('POST', '/create-note', {
      parentNoteId: parentId,
      title: input.title,
      type: 'text',
      content: `<pre>${escapeHtml(input.body)}</pre>`,
    });
    for (const tag of input.tags) await this.addTag(created.note.noteId, tag);
    return { id: created.note.noteId, path: `${input.parentPath}/${input.title}` };
  }

  async setContent(id: string, body: string): Promise<void> {
    await this.req('PUT', `/notes/${id}/content`, `<pre>${escapeHtml(body)}</pre>`);
  }

  async addTag(id: string, tag: string): Promise<void> {
    await this.req('POST', '/attributes', { noteId: id, type: 'label', name: normaliseLabel(tag), value: '' });
  }

  async listAll(opts: { underPath?: string; tag?: string; limit?: number } = {}): Promise<BrainNote[]> {
    const limit = opts.limit ?? 5000;
    const tag = opts.tag ?? 'claude-brain';
    let q = `#${normaliseLabel(tag)}`;
    if (opts.underPath) {
      const rootId = await this.resolvePath(opts.underPath, { create: false }).catch(() => null);
      if (rootId) q = `${q} note.ancestors.noteId = "${rootId}"`;
    }
    const params = new URLSearchParams({ search: q, limit: String(limit), orderBy: 'dateModified', orderDirection: 'desc' });
    const data = await this.req<{ results: Array<{ noteId: string; title: string; dateModified?: string }> }>(
      'GET', `/notes?${params}`,
    );
    return (data.results ?? []).map(n => ({ id: n.noteId, title: n.title, modifiedAt: n.dateModified }));
  }
}
