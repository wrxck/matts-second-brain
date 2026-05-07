import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// set required env before importing the adapter
process.env.TRILIUM_URL = 'http://trilium.test';
process.env.TRILIUM_ETAPI_TOKEN = 'test-token';

// dynamic import deferred until after env is set
async function loadAdapter() {
  const { TriliumAdapter } = await import('../adapters/trilium.js');
  return new TriliumAdapter();
}

function makeSearchResponse(results: Array<{ noteId: string; title: string }> = []) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ results }),
    text: async () => '',
  } as unknown as Response;
}

describe('TriliumAdapter.search', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeSearchResponse());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exactTitle=true builds a structured note.title query', async () => {
    const adapter = await loadAdapter();
    await adapter.search('My Note', { exactTitle: true, tag: 'claude-brain' });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url] = fetchSpy.mock.calls[0] as [string, ...unknown[]];
    const searchParam = new URL(url).searchParams.get('search') ?? '';
    expect(searchParam).toContain('note.title = "My Note"');
    expect(searchParam).toContain('#claude_brain');
    // must not be a free-text query
    expect(searchParam).not.toMatch(/^claude_brain\s/);
  });

  it('exactTitle unset builds a free-text tag+query', async () => {
    const adapter = await loadAdapter();
    await adapter.search('My Note', { tag: 'claude-brain' });

    const [url] = fetchSpy.mock.calls[0] as [string, ...unknown[]];
    const searchParam = new URL(url).searchParams.get('search') ?? '';
    expect(searchParam).not.toContain('note.title =');
    expect(searchParam).toContain('#claude_brain');
    expect(searchParam).toContain('My Note');
  });

  it('exactTitle=true with double-quote in query escapes the quote', async () => {
    const adapter = await loadAdapter();
    await adapter.search('Note with "quotes"', { exactTitle: true });

    const [url] = fetchSpy.mock.calls[0] as [string, ...unknown[]];
    const searchParam = new URL(url).searchParams.get('search') ?? '';
    // raw double-quote must not appear unescaped inside the trilium string literal
    expect(searchParam).toContain('note.title = "Note with \\"quotes\\""');
  });

  it('exactTitle=false with double-quote in query does not crash', async () => {
    const adapter = await loadAdapter();
    await expect(adapter.search('Note with "quotes"')).resolves.toEqual([]);
  });
});
