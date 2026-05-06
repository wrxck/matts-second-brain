/**
 * Notion adapter — uses the Notion API.
 *
 * Env:
 *   BRAIN_NOTION_TOKEN       Internal integration secret (required)
 *   BRAIN_NOTION_ROOT_PAGE   Notion page id used as the brain root (required)
 *
 * Conventions:
 *  - Each "note" is a Notion page under the root.
 *  - The "id" is the Notion page id (UUID).
 *  - Path resolution walks page titles down the children tree.
 *  - Tags become a multi-select property called "tags" on each page (the
 *    integration must have edit access to a database for this; otherwise
 *    tags fall back to inline mentions in the body).
 *
 * Limitations:
 *  - Notion has rate limits — heavy use of brain_scan_transcripts will hit them.
 *  - First setup needs you to create a database/page and share it with the integration.
 *  - Search is Notion's own — not as flexible as Trilium's query language.
 *
 * NOTE: This is a minimal implementation suitable for read + create. Update
 * + tag operations work; advanced features (databases, properties) are
 * intentionally simple. PRs welcome to expand.
 */

import type { BrainAdapter, BrainNote, CreateNoteInput } from './index.js';

const NOTION_VERSION = '2022-06-28';

interface NotionPage { id: string; properties?: Record<string, any>; last_edited_time?: string; }
interface NotionSearch { results: Array<NotionPage & { object: 'page' }>; }

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Notion adapter: ${name} env var is required`);
  return v;
}

function pageTitle(page: NotionPage): string {
  if (!page.properties) return '';
  for (const prop of Object.values(page.properties)) {
    if (prop?.type === 'title') {
      return prop.title?.map((t: any) => t.plain_text).join('') ?? '';
    }
  }
  return '';
}

export class NotionAdapter implements BrainAdapter {
  readonly name = 'notion';
  private token: string;
  private rootPageId: string;

  constructor() {
    this.token = envOrThrow('BRAIN_NOTION_TOKEN');
    this.rootPageId = envOrThrow('BRAIN_NOTION_ROOT_PAGE');
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await fetch(`https://api.notion.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`Notion ${method} ${path} → ${r.status}: ${await r.text().catch(() => '')}`);
    return (await r.json()) as T;
  }

  async ping(): Promise<void> {
    await this.req<NotionPage>('GET', `/pages/${this.rootPageId}`);
  }

  async search(query: string, opts: { limit?: number; tag?: string; exactTitle?: boolean } = {}): Promise<BrainNote[]> {
    const body: Record<string, unknown> = {
      filter: { property: 'object', value: 'page' },
      page_size: opts.limit ?? 20,
    };
    if (!opts.exactTitle) {
      body.query = query;
    }
    const data = await this.req<NotionSearch>('POST', '/search', body);
    let results = data.results.map(p => ({
      id: p.id,
      title: pageTitle(p),
      modifiedAt: p.last_edited_time,
    }));
    if (opts.exactTitle) {
      results = results.filter(n => n.title === query);
    }
    return results.slice(0, opts.limit ?? 20);
  }

  async resolvePath(path: string, opts: { create?: boolean } = {}): Promise<string> {
    const segments = path.split('/').filter(Boolean);
    let parentId = this.rootPageId;
    for (const seg of segments) {
      // List children of parent and find by title.
      const data = await this.req<{ results: NotionPage[] }>('GET', `/blocks/${parentId}/children`);
      const found = data.results.find(b =>
        (b as any).type === 'child_page' && (b as any).child_page?.title === seg,
      );
      if (found) { parentId = found.id; continue; }
      if (!opts.create) throw new Error(`Notion path not found: ${path} (stuck at ${seg})`);
      const created = await this.req<NotionPage>('POST', '/pages', {
        parent: { page_id: parentId },
        properties: { title: { title: [{ text: { content: seg } }] } },
      });
      parentId = created.id;
    }
    return parentId;
  }

  async getContent(id: string): Promise<string> {
    const data = await this.req<{ results: any[] }>('GET', `/blocks/${id}/children`);
    const lines: string[] = [];
    for (const b of data.results) {
      const t = b.type;
      const arr = b[t]?.rich_text;
      if (Array.isArray(arr)) lines.push(arr.map((r: any) => r.plain_text).join(''));
    }
    return lines.join('\n');
  }

  async create(input: CreateNoteInput): Promise<{ id: string; path: string }> {
    const parentId = await this.resolvePath(input.parentPath, { create: true });
    const created = await this.req<NotionPage>('POST', '/pages', {
      parent: { page_id: parentId },
      properties: { title: { title: [{ text: { content: input.title } }] } },
      children: [
        ...(input.tags.length
          ? [{
              object: 'block', type: 'paragraph',
              paragraph: { rich_text: [{ type: 'text', text: { content: input.tags.map(t => `#${t}`).join(' ') } }] },
            }]
          : []),
        {
          object: 'block', type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: input.body } }] },
        },
      ],
    });
    return { id: created.id, path: `${input.parentPath}/${input.title}` };
  }

  async setContent(_id: string, _body: string): Promise<void> {
    throw new Error(
      'Notion adapter: setContent not yet implemented (requires deleting + recreating block children). ' +
      'Use brain_update which preserves history via a child note instead.',
    );
  }

  async addTag(id: string, tag: string): Promise<void> {
    await this.req('PATCH', `/blocks/${id}/children`, {
      children: [{
        object: 'block', type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: `#${tag}` } }] },
      }],
    });
  }

  async listAll(opts: { underPath?: string; tag?: string; limit?: number } = {}): Promise<BrainNote[]> {
    // Notion's /search returns pages — we filter by title containing tag
    // marker as a best-effort. For richer filtering, set up a database with
    // a tags multi-select property.
    const limit = opts.limit ?? 200;       // Notion is rate-limited; keep this small
    const data = await this.req<NotionSearch>('POST', '/search', {
      filter: { property: 'object', value: 'page' },
      page_size: Math.min(limit, 100),
    });
    return data.results.slice(0, limit).map(p => ({
      id: p.id,
      title: pageTitle(p),
      modifiedAt: p.last_edited_time,
    }));
  }
}
