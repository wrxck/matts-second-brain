#!/usr/bin/env node
/**
 * brain-cli — synchronous cli wrapper around the brain adapters.
 *
 * used by the claude code hooks (hooks/*.py) to call into the brain
 * without the latency of spinning up the mcp stdio server. reads the
 * same env (BRAIN_BACKEND, ETAPI token, etc) and the same adapter
 * factory.
 *
 * Commands:
 *   brain recall    --query Q [--category C] [--limit N] [--json]
 *   brain remember  --category C --title T (--body B | --body-file P) [--tag X]*
 *   brain propose   --category C --title T (--body B | --body-file P) [--tag X]* [--session-id S]
 *   brain proposals [--pop] [--session-id S] [--json]
 *   brain apps      [--json]   # list /Apps/<X> note titles, used by hooks for keyword cache
 *
 * Output is plain text by default, or JSON with --json. Designed so the
 * Python hooks can pipe stdin/parse stdout cheaply.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync, readdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { loadAdapter } from './adapters/index.js';

const ROOT_NOTE_TITLE = 'Claude Memory';
const VALID_CATEGORIES = ['standards', 'decisions', 'lessons', 'apps', 'reviews', 'drafts'];

const CACHE_DIR = join(homedir(), '.cache', 'claude-brain');
function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function categoryToSubpath(category: string): string {
  const map: Record<string, string> = {
    standards: 'Standards',
    decisions: 'Decisions',
    lessons: 'Lessons Learned',
    apps: 'Apps',
    reviews: 'Reviews',
    drafts: 'Drafts',
  };
  const v = map[category];
  if (!v) throw new Error(`Unknown category: ${category}`);
  return v;
}

interface Args {
  _: string[];
  flags: Record<string, string | boolean>;
  multi: Record<string, string[]>;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: {}, multi: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        out.flags[key] = true;
      } else {
        if (key === 'tag') {
          out.multi.tag ??= [];
          out.multi.tag.push(next);
        } else {
          out.flags[key] = next;
        }
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function readBody(args: Args): string {
  if (typeof args.flags.body === 'string') return args.flags.body;
  if (typeof args.flags['body-file'] === 'string') {
    return readFileSync(args.flags['body-file'] as string, 'utf8');
  }
  throw new Error('Need --body or --body-file');
}

async function cmdRecall(args: Args) {
  const query = args.flags.query as string;
  if (!query) throw new Error('--query required');
  const category = args.flags.category as string | undefined;
  const limit = Number(args.flags.limit ?? 5);
  const wantJson = !!args.flags.json;

  const a = loadAdapter();
  const results = await a.search(query, { limit, tag: 'claude-brain' });

  let filtered = results;
  if (category) {
    const sub = categoryToSubpath(category);
    filtered = results.filter(r => (r.path ?? '').includes(sub));
  }

  const enriched = await Promise.all(filtered.slice(0, limit).map(async r => ({
    id: r.id,
    title: r.title,
    path: r.path ?? '',
    modifiedAt: r.modifiedAt ?? null,
    excerpt: (await a.getContent(r.id).catch(() => '')).slice(0, 240),
  })));

  if (wantJson) {
    process.stdout.write(JSON.stringify({ backend: a.name, query, results: enriched }) + '\n');
    return;
  }

  if (enriched.length === 0) {
    process.stdout.write(`No matches for "${query}".\n`);
    return;
  }
  for (const r of enriched) {
    process.stdout.write(`• ${r.title}  [${r.path || r.id}]\n`);
    if (r.excerpt) process.stdout.write(`    "${r.excerpt}"\n`);
  }
}

async function cmdRemember(args: Args) {
  const category = args.flags.category as string;
  const title = args.flags.title as string;
  if (!category || !title) throw new Error('--category and --title required');
  if (!VALID_CATEGORIES.includes(category)) throw new Error(`Invalid category: ${category}`);
  const body = readBody(args);
  const tags = ['claude-brain', ...(args.multi.tag ?? [])];

  const a = loadAdapter();
  const sub = categoryToSubpath(category);
  const parentPath = `${ROOT_NOTE_TITLE}/${sub}`;
  const out = await a.create({ parentPath, title, body, tags });
  process.stdout.write(JSON.stringify({ ok: true, id: out.id, path: out.path }) + '\n');
}

interface Proposal {
  ts: string;
  sessionId: string;
  category: string;
  title: string;
  body: string;
  tags: string[];
}

function proposalsFile(sessionId: string): string {
  ensureCacheDir();
  return join(CACHE_DIR, `proposals-${sessionId}.jsonl`);
}

async function cmdPropose(args: Args) {
  const category = args.flags.category as string;
  const title = args.flags.title as string;
  if (!category || !title) throw new Error('--category and --title required');
  const body = readBody(args);
  const tags = args.multi.tag ?? [];
  const sessionId = (args.flags['session-id'] as string) || 'default';
  const p: Proposal = {
    ts: new Date().toISOString(),
    sessionId,
    category,
    title,
    body,
    tags,
  };
  appendFileSync(proposalsFile(sessionId), JSON.stringify(p) + '\n');
  process.stdout.write(JSON.stringify({ ok: true, queued: proposalsFile(sessionId) }) + '\n');
}

async function cmdProposals(args: Args) {
  ensureCacheDir();
  const wantJson = !!args.flags.json;
  const pop = !!args.flags.pop;
  const sessionId = args.flags['session-id'] as string | undefined;

  const files = readdirSync(CACHE_DIR).filter(f => f.startsWith('proposals-') && f.endsWith('.jsonl'));
  const all: Proposal[] = [];
  for (const f of files) {
    if (sessionId && !f.includes(sessionId)) continue;
    const lines = readFileSync(join(CACHE_DIR, f), 'utf8').split('\n').filter(Boolean);
    for (const l of lines) {
      try { all.push(JSON.parse(l)); } catch { /* skip */ }
    }
    if (pop) {
      try { unlinkSync(join(CACHE_DIR, f)); } catch { /* ignore */ }
    }
  }

  if (wantJson) {
    process.stdout.write(JSON.stringify({ proposals: all, drained: pop }) + '\n');
    return;
  }
  if (all.length === 0) {
    process.stdout.write('No pending proposals.\n');
    return;
  }
  process.stdout.write(`${all.length} pending proposal(s):\n`);
  all.forEach((p, i) => {
    process.stdout.write(`  ${i + 1}. [${p.category}] ${p.title}  (session=${p.sessionId}, ${p.ts})\n`);
    process.stdout.write(`     ${p.body.slice(0, 160).replace(/\n/g, ' ')}\n`);
  });
  if (pop) process.stdout.write('(queue drained)\n');
}

async function cmdApps(args: Args) {
  const wantJson = !!args.flags.json;
  const a = loadAdapter();
  // list anything under Claude Memory/Apps
  let items: string[] = [];
  try {
    const all = await a.listAll({ underPath: `${ROOT_NOTE_TITLE}/Apps`, tag: 'claude-brain', limit: 200 });
    items = Array.from(new Set(all.map(n => n.title))).sort();
  } catch {
    // best-effort: empty list
  }
  if (wantJson) {
    process.stdout.write(JSON.stringify({ apps: items }) + '\n');
    return;
  }
  for (const t of items) process.stdout.write(t + '\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  try {
    switch (cmd) {
      case 'recall':    await cmdRecall(args); break;
      case 'remember':  await cmdRemember(args); break;
      case 'propose':   await cmdPropose(args); break;
      case 'proposals': await cmdProposals(args); break;
      case 'apps':      await cmdApps(args); break;
      case '--help':
      case '-h':
      case 'help':
      case undefined:
        process.stdout.write(
          'brain-cli — usage:\n' +
          '  brain recall    --query Q [--category C] [--limit N] [--json]\n' +
          '  brain remember  --category C --title T (--body B | --body-file P) [--tag X]*\n' +
          '  brain propose   --category C --title T (--body B | --body-file P) [--tag X]* [--session-id S]\n' +
          '  brain proposals [--pop] [--session-id S] [--json]\n' +
          '  brain apps      [--json]\n',
        );
        break;
      default:
        process.stderr.write(`unknown command: ${cmd}\n`);
        process.exit(2);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (args.flags.json) {
      process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n');
    } else {
      process.stderr.write(`error: ${msg}\n`);
    }
    process.exit(1);
  }
}

main();
