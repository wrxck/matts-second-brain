import { mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { parseTransportArgs, readToken, serveHttp } from '../http.js';

const TOKEN = 'test-token-0123456789abcdef';

function makeServer(): Server {
  const server = new Server({ name: 't', version: '0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: {} } }],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => ({
    content: [{ type: 'text', text: `echo ${JSON.stringify(req.params.arguments ?? {})}` }],
  }));
  return server;
}

describe('parseTransportArgs', () => {
  it('defaults to stdio', () => {
    expect(parseTransportArgs([]).transport).toBe('stdio');
  });

  it('reads the http flags', () => {
    const o = parseTransportArgs(['--transport', 'http', '--bind', '127.0.0.1', '--port', '7410', '--auth-token-file', '/x']);
    expect(o).toEqual({ transport: 'http', bind: '127.0.0.1', port: 7410, authTokenFile: '/x' });
  });

  it('rejects http with no token file', () => {
    expect(() => parseTransportArgs(['--transport', 'http', '--port', '7410'])).toThrow(/auth-token-file/);
  });

  it('rejects a bad port and an unknown flag', () => {
    expect(() => parseTransportArgs(['--port', '70000'])).toThrow(/1\.\.65535/);
    expect(() => parseTransportArgs(['--verbose', '1'])).toThrow(/unknown argument/);
    expect(() => parseTransportArgs(['--port'])).toThrow(/needs a value/);
  });
});

describe('readToken', () => {
  it('rejects a short token', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-'));
    writeFileSync(join(dir, 't'), 'short\n');
    expect(() => readToken(join(dir, 't'))).toThrow(/at least 16/);
    writeFileSync(join(dir, 't'), `${TOKEN}\n`);
    expect(readToken(join(dir, 't'))).toBe(TOKEN);
  });
});

describe('serveHttp', () => {
  let url = '';
  let close = (): void => {};

  beforeAll(async () => {
    const http = await serveHttp(makeServer, { bind: '127.0.0.1', port: 0, token: TOKEN });
    url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
    close = () => http.close();
  });

  afterAll(() => close());

  const rpc = (body: unknown, auth = `Bearer ${TOKEN}`) =>
    fetch(url, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    });

  it('refuses a request with no token or a wrong token', async () => {
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, '')).status).toBe(401);
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, `Bearer ${TOKEN}x`)).status).toBe(401);
  });

  it('refuses GET and other paths', async () => {
    expect((await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(405);
    expect((await fetch(url.replace('/mcp', '/other'))).status).toBe(404);
  });

  it('answers initialize, tools/list and tools/call', async () => {
    const init = await rpc({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
    });
    expect(init.status).toBe(200);
    expect((await init.json()).result.serverInfo.name).toBe('t');

    const list = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(['echo']);

    const call = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { a: 1 } } })).json();
    expect(call.result.content[0].text).toBe('echo {"a":1}');
  });

  it('serves parallel requests', async () => {
    const results = await Promise.all(
      [1, 2, 3, 4].map(async (n) => (await rpc({ jsonrpc: '2.0', id: n, method: 'tools/call', params: { name: 'echo', arguments: { n } } })).json()),
    );
    expect(results.map((r) => r.result.content[0].text)).toEqual([1, 2, 3, 4].map((n) => `echo {"n":${n}}`));
  });
});
