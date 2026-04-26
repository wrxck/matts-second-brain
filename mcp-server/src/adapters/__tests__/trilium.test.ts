/**
 * Trilium adapter tests — fully mocked: `fetch` is replaced and the ETAPI
 * token is supplied via env so loadConfig() never reads disk.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TriliumAdapter } from '../trilium.js';

type FetchCall = { url: string; init: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html' } });
}

function emptyResponse(status = 200): Response {
  // Avoid 204 — node's Response constructor rejects 204 with a body, and
  // we want a uniform shape. Status 200 with empty body works for adapters
  // that don't read the body.
  return new Response('{}', { status, headers: { 'content-type': 'application/json' } });
}

describe('TriliumAdapter', () => {
  const calls: FetchCall[] = [];
  const queue: Response[] = [];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    calls.length = 0;
    queue.length = 0;
    process.env.TRILIUM_URL = 'http://trilium.test';
    process.env.TRILIUM_ETAPI_TOKEN = 'test-token-abc';
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
    delete process.env.TRILIUM_URL;
    delete process.env.TRILIUM_ETAPI_TOKEN;
  });

  it('ping hits /etapi/app-info with the token header', async () => {
    queue.push(jsonResponse({ appVersion: '0.x' }));
    const a = new TriliumAdapter();
    await a.ping();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://trilium.test/etapi/app-info');
    expect(calls[0].init.method).toBe('GET');
    expect((calls[0].init.headers as any).Authorization).toBe('test-token-abc');
  });

  it('search builds query with tag prefix and parses results', async () => {
    queue.push(
      jsonResponse({
        results: [
          { noteId: 'n1', title: 'First', dateModified: '2024-01-01' },
          { noteId: 'n2', title: 'Second' },
        ],
      }),
    );
    const a = new TriliumAdapter();
    const out = await a.search('hello world', { tag: 'claude-brain', limit: 5 });
    expect(out).toEqual([
      { id: 'n1', title: 'First', modifiedAt: '2024-01-01' },
      { id: 'n2', title: 'Second', modifiedAt: undefined },
    ]);
    // Hyphen normalised to underscore in the search query.
    const url = new URL(calls[0].url);
    expect(url.searchParams.get('search')).toBe('#claude_brain hello world');
    expect(url.searchParams.get('limit')).toBe('5');
  });

  it('addTag normalises hyphenated labels to underscores', async () => {
    queue.push(emptyResponse());
    const a = new TriliumAdapter();
    await a.addTag('note-id-1', 'claude-brain');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://trilium.test/etapi/attributes');
    expect(calls[0].init.method).toBe('POST');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toEqual({ noteId: 'note-id-1', type: 'label', name: 'claude_brain', value: '' });
  });

  it('getContent strips HTML and collapses whitespace', async () => {
    queue.push(textResponse('<pre>hello\n  <b>world</b></pre>'));
    const a = new TriliumAdapter();
    const out = await a.getContent('n1');
    expect(out).toBe('hello world');
  });

  it('resolvePath creates intermediates when create=true', async () => {
    queue.push(jsonResponse({ results: [] })); // search "Standards" → empty
    queue.push(jsonResponse({ note: { noteId: 'std-id' } })); // create "Standards"
    queue.push(jsonResponse({ results: [] })); // search "Git" under std-id → empty
    queue.push(jsonResponse({ note: { noteId: 'git-id' } })); // create "Git"

    const a = new TriliumAdapter();
    const id = await a.resolvePath('Standards/Git', { create: true });
    expect(id).toBe('git-id');

    const creates = calls.filter(c => c.url.endsWith('/etapi/create-note'));
    expect(creates).toHaveLength(2);
    expect(JSON.parse(creates[0].init.body as string).title).toBe('Standards');
    expect(JSON.parse(creates[1].init.body as string).title).toBe('Git');
    expect(JSON.parse(creates[1].init.body as string).parentNoteId).toBe('std-id');
  });

  it('create resolves parent, creates note, then attaches normalised tags', async () => {
    queue.push(jsonResponse({ results: [{ noteId: 'inbox-id', title: 'Inbox' }] })); // resolve "Inbox"
    queue.push(jsonResponse({ note: { noteId: 'new-id' } })); // create-note
    queue.push(emptyResponse()); // addTag "claude-brain"
    queue.push(emptyResponse()); // addTag "memory"

    const a = new TriliumAdapter();
    const out = await a.create({
      parentPath: 'Inbox',
      title: 'My Note',
      body: 'hello & <world>',
      tags: ['claude-brain', 'memory'],
    });
    expect(out).toEqual({ id: 'new-id', path: 'Inbox/My Note' });

    const createNote = calls.find(
      c => c.url.endsWith('/etapi/create-note') && (c.init.body as string).includes('My Note'),
    )!;
    const body = JSON.parse(createNote.init.body as string);
    expect(body.parentNoteId).toBe('inbox-id');
    expect(body.title).toBe('My Note');
    expect(body.content).toBe('<pre>hello &amp; &lt;world&gt;</pre>');

    const tagCalls = calls.filter(c => c.url.endsWith('/etapi/attributes'));
    expect(tagCalls.map(c => JSON.parse(c.init.body as string).name)).toEqual([
      'claude_brain',
      'memory',
    ]);
  });

  it('setContent PUTs HTML-escaped <pre> body', async () => {
    queue.push(emptyResponse());
    const a = new TriliumAdapter();
    await a.setContent('n1', 'a < b & c');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://trilium.test/etapi/notes/n1/content');
    expect(calls[0].init.method).toBe('PUT');
    expect(calls[0].init.body).toBe('<pre>a &lt; b &amp; c</pre>');
    expect((calls[0].init.headers as any)['Content-Type']).toBe('text/plain');
  });

  it('listAll defaults to #claude_brain tag and returns notes', async () => {
    queue.push(
      jsonResponse({ results: [{ noteId: 'a', title: 'A', dateModified: '2024-02-02' }] }),
    );
    const a = new TriliumAdapter();
    const out = await a.listAll();
    expect(out).toEqual([{ id: 'a', title: 'A', modifiedAt: '2024-02-02' }]);
    const url = new URL(calls[0].url);
    expect(url.searchParams.get('search')).toBe('#claude_brain');
    expect(url.searchParams.get('orderBy')).toBe('dateModified');
  });

  it('throws a useful error when the ETAPI returns non-2xx', async () => {
    queue.push(new Response('nope', { status: 401 }));
    const a = new TriliumAdapter();
    await expect(a.ping()).rejects.toThrow(/401/);
  });
});
