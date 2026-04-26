/**
 * srag bridge — exports the brain to a directory of markdown files and
 * delegates chunking + embeddings + semantic query to the `srag` CLI.
 *
 * Why srag: it already does chunking, embedding, and disk-backed search
 * across many repos. We add a synthetic "claude-brain" project that is
 * just the brain notes serialised to markdown so it can be queried with
 * the same tooling.
 *
 * Layout:
 *   ~/.local/share/claude-brain/srag-export/<backend>/<sanitised-id>.md
 *   each file has YAML frontmatter:
 *     ---
 *     id: <backend-native id>
 *     title: <title>
 *     path: <breadcrumb if known>
 *     modifiedAt: <iso>
 *     tags: [...]
 *     ---
 *
 * The CLI is invoked via execFile (no shell). Output is JSON when possible
 * and parsed defensively — srag query --json returns {results:[...]}.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BrainAdapter, BrainNote } from './adapters/index.js';

const SRAG_PROJECT = 'claude-brain';

export function exportDir(adapterName: string): string {
  const base = process.env.BRAIN_SRAG_EXPORT_DIR ??
    join(homedir(), '.local', 'share', 'claude-brain', 'srag-export');
  return join(base, adapterName);
}

function sanitiseFilename(s: string): string {
  return s.replace(/[^\w.-]+/g, '_').slice(0, 180);
}

function frontmatter(note: BrainNote, body: string, extras: Record<string, string> = {}): string {
  const escape = (v: string) => v.replace(/"/g, '\\"');
  const lines = [
    '---',
    `id: "${escape(note.id)}"`,
    `title: "${escape(note.title)}"`,
    note.path ? `path: "${escape(note.path)}"` : null,
    note.modifiedAt ? `modifiedAt: "${escape(note.modifiedAt)}"` : null,
    ...Object.entries(extras).map(([k, v]) => `${k}: "${escape(v)}"`),
    '---',
    '',
  ].filter(Boolean) as string[];
  return lines.join('\n') + body + '\n';
}

export interface ExportResult {
  dir: string;
  written: number;
  skipped: number;
  errors: Array<{ id: string; error: string }>;
}

export async function exportBrain(adapter: BrainAdapter, opts: { clean?: boolean; underPath?: string } = {}): Promise<ExportResult> {
  const dir = exportDir(adapter.name);
  if (opts.clean && existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });

  const notes = await adapter.listAll({ underPath: opts.underPath });
  const result: ExportResult = { dir, written: 0, skipped: 0, errors: [] };
  for (const note of notes) {
    try {
      const body = await adapter.getContent(note.id);
      if (!body || body.length < 5) { result.skipped++; continue; }
      const filename = `${sanitiseFilename(note.id)}__${sanitiseFilename(note.title)}.md`;
      writeFileSync(join(dir, filename), frontmatter(note, body));
      result.written++;
    } catch (e: any) {
      result.errors.push({ id: note.id, error: e.message ?? String(e) });
    }
  }
  return result;
}

function sragBin(): string {
  return process.env.SRAG_BIN ?? 'srag';
}

export function sragInstalled(): boolean {
  const r = spawnSync(sragBin(), ['--help'], { encoding: 'utf8' });
  return r.status === 0;
}

export interface IndexResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function indexExport(adapterName: string): IndexResult {
  const dir = exportDir(adapterName);
  if (!existsSync(dir) || readdirSync(dir).length === 0) {
    return { ok: false, stdout: '', stderr: `export dir empty: ${dir} — run brain_sync_srag first` };
  }
  const r = spawnSync(sragBin(), ['index', '--name', SRAG_PROJECT, dir], { encoding: 'utf8' });
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

export interface SemanticHit {
  /** brain note id parsed from filename prefix (best-effort) */
  noteId?: string;
  /** raw filename returned by srag */
  file: string;
  /** chunk text */
  snippet: string;
  /** similarity / score if srag returns it */
  score?: number;
}

export function querySrag(query: string, _limit = 10): { ok: boolean; hits: SemanticHit[]; raw: string; stderr: string } {
  const r = spawnSync(sragBin(), ['query', '--project', SRAG_PROJECT, '--query', query, '--json'], { encoding: 'utf8' });
  if (r.status !== 0) {
    return { ok: false, hits: [], raw: r.stdout ?? '', stderr: r.stderr ?? `srag exited ${r.status}` };
  }
  const out = r.stdout ?? '';
  // srag --json output shape varies by version; be defensive: try strict
  // JSON parse first, then line-delimited JSON, then return raw.
  let parsed: any = null;
  try { parsed = JSON.parse(out); }
  catch {
    const lines = out.split('\n').filter(l => l.trim().startsWith('{'));
    if (lines.length) { try { parsed = lines.map(l => JSON.parse(l)); } catch { /* fall through */ } }
  }
  const hits: SemanticHit[] = [];
  const collect = (entry: any) => {
    if (!entry) return;
    const file = entry.path ?? entry.file ?? entry.source ?? '';
    const snippet = entry.text ?? entry.content ?? entry.snippet ?? entry.chunk ?? '';
    const score = typeof entry.score === 'number' ? entry.score : (typeof entry.distance === 'number' ? entry.distance : undefined);
    // filename pattern: <sanitisedId>__<sanitisedTitle>.md
    const base = file.split('/').pop() ?? '';
    const noteId = base.includes('__') ? base.split('__')[0] : undefined;
    if (file || snippet) hits.push({ noteId, file, snippet, score });
  };
  if (Array.isArray(parsed)) parsed.forEach(collect);
  else if (parsed?.results) (parsed.results as any[]).forEach(collect);
  else if (parsed?.hits) (parsed.hits as any[]).forEach(collect);
  return { ok: true, hits, raw: out, stderr: r.stderr ?? '' };
}
