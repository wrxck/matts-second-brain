import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server as HttpServer, type ServerResponse } from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export interface TransportOptions {
  transport: 'stdio' | 'http';
  bind: string;
  port: number;
  authTokenFile?: string;
}

export interface McpServerLike {
  connect(transport: Transport): Promise<void>;
  close(): Promise<void>;
}

// same flags as the shared java mcp servers, so one deploy script starts them all
export function parseTransportArgs(argv: string[]): TransportOptions {
  const opts: TransportOptions = { transport: 'stdio', bind: '127.0.0.1', port: 0 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${flag} needs a value`);
    }
    i++;
    switch (flag) {
      case '--transport':
        if (value !== 'stdio' && value !== 'http') {
          throw new Error(`--transport must be stdio or http, got ${value}`);
        }
        opts.transport = value;
        break;
      case '--bind':
        opts.bind = value;
        break;
      case '--port': {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error(`--port must be 1..65535, got ${value}`);
        }
        opts.port = port;
        break;
      }
      case '--auth-token-file':
        opts.authTokenFile = value;
        break;
      default:
        throw new Error(`unknown argument: ${flag}`);
    }
  }
  if (opts.transport === 'http' && (!opts.port || !opts.authTokenFile)) {
    throw new Error('--transport http needs --port and --auth-token-file');
  }
  return opts;
}

export function readToken(file: string): string {
  const token = readFileSync(file, 'utf8').trim();
  if (token.length < 16) {
    throw new Error(`${file} must hold a token of at least 16 characters`);
  }
  return token;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function send(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'text/plain', ...headers });
  res.end(message + '\n');
}

// a new server per request, so nothing one session does is visible to another
export function serveHttp(
  makeServer: () => McpServerLike,
  opts: { bind: string; port: number; token: string },
): Promise<HttpServer> {
  const expected = digest(`Bearer ${opts.token}`);
  const http = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== '/mcp') {
      send(res, 404, 'not found');
      return;
    }
    // hash both sides so the compare takes the same time for any length
    if (!timingSafeEqual(digest(req.headers.authorization ?? ''), expected)) {
      send(res, 401, 'unauthorized', { 'WWW-Authenticate': 'Bearer' });
      return;
    }
    if (req.method !== 'POST') {
      send(res, 405, 'method not allowed', { Allow: 'POST' });
      return;
    }
    const server = makeServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error('mcp request failed:', err);
      if (!res.headersSent) {
        send(res, 500, 'internal error');
      }
    }
  });
  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(opts.port, opts.bind, () => resolve(http));
  });
}
