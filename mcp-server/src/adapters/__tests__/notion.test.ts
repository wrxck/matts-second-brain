/**
 * Notion adapter tests — fetch is fully mocked. Asserts URL, method, headers
 * and request body for each operation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotionAdapter } from '../notion.js';

type FetchCall = { url: string; init: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const ROOT = 'root-page-id';

describe('NotionAdapter', () => {
  const calls: FetchCall[] = [];
  const queue: Response[] = [];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    calls.length = 0;
    queue.length = 0;
    process.env.BRAIN_NOTION_TOKEN = 'secret_test';
    process.env.BRAIN_NOTION_ROOT_PAGE = ROOT;
    fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const next = queue.shift();
      if (!next) throw new Error(`No queued response for ${init.method ?? 'GET'} ${url}`);
      return next;
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BRAIN_NOTION_TOKEN;
    delete process.env.BRAIN_NOTION_ROOT_PAGE;
  });

  it('ping fetches the root page with bearer auth + Notion-Version', async () => {
    queue.push(jsonResponse({ id: ROOT }));
    const a = new NotionAdapter();
    await a.ping();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://api.notion.com/v1/pages/${ROOT}`);
    expect(calls[0].init.method).toBe('GET');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret_test');
    expect(headers['Notion-Version']).toBe('2022-06-28');
  });

  it('search POSTs /v1/search with the query and parses titles', async () => {
    queue.push(
      jsonResponse({
        results: [
          {
            id: 'page-1',
            object: 'page',
            last_edited_time: '2024-04-01T00:00:00Z',
            properties: {
              Name: {
                type: 'title',
                title: [{ plain_text: 'Hello ' }, { plain_text: 'World' }],
              },
            },
          },
        ],
      }),
    );
    const a = new NotionAdapter();
    const out = await a.search('hello', { limit: 7 });
    expect(out).toEqual([
      { id: 'page-1', title: 'Hello World', modifiedAt: '2024-04-01T00:00:00Z' },
    ]);
    expect(calls[0].url).toBe('https://api.notion.com/v1/search');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      query: 'hello',
      filter: { property: 'object', value: 'page' },
      page_size: 7,
    });
  });

  it('resolvePath walks child_page blocks and returns the leaf id', async () => {
    queue.push(
      jsonResponse({
        results: [
          { id: 'std-id', type: 'child_page', child_page: { title: 'Standards' } },
        ],
      }),
    );
    queue.push(
      jsonResponse({
        results: [{ id: 'git-id', type: 'child_page', child_page: { title: 'Git' } }],
      }),
    );

    const a = new NotionAdapter();
    const id = await a.resolvePath('Standards/Git');
    expect(id).toBe('git-id');
    expect(calls[0].url).toBe(`https://api.notion.com/v1/blocks/${ROOT}/children`);
    expect(calls[1].url).toBe('https://api.notion.com/v1/blocks/std-id/children');
  });

  it('resolvePath creates missing pages when create=true', async () => {
    queue.push(jsonResponse({ results: [] })); // children of root → empty
    queue.push(jsonResponse({ id: 'new-id' })); // POST /pages → returns created id

    const a = new NotionAdapter();
    const id = await a.resolvePath('Inbox', { create: true });
    expect(id).toBe('new-id');
    expect(calls[1].url).toBe('https://api.notion.com/v1/pages');
    expect(calls[1].init.method).toBe('POST');
    const body = JSON.parse(calls[1].init.body as string);
    expect(body.parent).toEqual({ page_id: ROOT });
    expect(body.properties.title.title[0].text.content).toBe('Inbox');
  });

  it('getContent flattens rich_text blocks into newline-separated lines', async () => {
    queue.push(
      jsonResponse({
        results: [
          {
            type: 'paragraph',
            paragraph: { rich_text: [{ plain_text: 'first ' }, { plain_text: 'line' }] },
          },
          { type: 'heading_1', heading_1: { rich_text: [{ plain_text: 'big' }] } },
          { type: 'image', image: {} }, // no rich_text → skipped
        ],
      }),
    );
    const a = new NotionAdapter();
    const out = await a.getContent('p1');
    expect(out).toBe('first line\nbig');
    expect(calls[0].url).toBe('https://api.notion.com/v1/blocks/p1/children');
  });

  it('create resolves the parent then POSTs a new page with tag + body blocks', async () => {
    queue.push(
      jsonResponse({
        results: [{ id: 'inbox-id', type: 'child_page', child_page: { title: 'Inbox' } }],
      }),
    );
    queue.push(jsonResponse({ id: 'created-id' }));

    const a = new NotionAdapter();
    const out = await a.create({
      parentPath: 'Inbox',
      title: 'My Note',
      body: 'hello',
      tags: ['claude-brain', 'log'],
    });
    expect(out).toEqual({ id: 'created-id', path: 'Inbox/My Note' });

    const createCall = calls[1];
    expect(createCall.url).toBe('https://api.notion.com/v1/pages');
    expect(createCall.init.method).toBe('POST');
    const body = JSON.parse(createCall.init.body as string);
    expect(body.parent).toEqual({ page_id: 'inbox-id' });
    expect(body.properties.title.title[0].text.content).toBe('My Note');
    expect(body.children).toHaveLength(2);
    expect(body.children[0].paragraph.rich_text[0].text.content).toBe('#claude-brain #log');
    expect(body.children[1].paragraph.rich_text[0].text.content).toBe('hello');
  });

  it('setContent throws (intentionally not implemented)', async () => {
    const a = new NotionAdapter();
    await expect(a.setContent('id', 'body')).rejects.toThrow(/not yet implemented/);
  });

  it('addTag PATCHes /blocks/:id/children with a hashtag paragraph', async () => {
    queue.push(jsonResponse({}));
    const a = new NotionAdapter();
    await a.addTag('page-1', 'claude-brain');
    expect(calls[0].url).toBe('https://api.notion.com/v1/blocks/page-1/children');
    expect(calls[0].init.method).toBe('PATCH');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.children[0].paragraph.rich_text[0].text.content).toBe('#claude-brain');
  });

  it('listAll POSTs /search with a small page_size and maps results', async () => {
    queue.push(
      jsonResponse({
        results: [
          {
            id: 'p1',
            object: 'page',
            last_edited_time: '2024-05-01',
            properties: { Name: { type: 'title', title: [{ plain_text: 'A' }] } },
          },
        ],
      }),
    );
    const a = new NotionAdapter();
    const out = await a.listAll({ limit: 50 });
    expect(out).toEqual([{ id: 'p1', title: 'A', modifiedAt: '2024-05-01' }]);
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.filter).toEqual({ property: 'object', value: 'page' });
    expect(body.page_size).toBe(50);
  });
});
