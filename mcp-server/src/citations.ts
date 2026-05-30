/**
 * brain_check_citations: the discipline rule "verify before asserting", automated.
 * notes often cite source files; over time those files move or vanish. this walks
 * the brain, extracts file-path-like citations, and flags notes whose cited files
 * no longer exist on disk, so they can be updated or archived.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import type { BrainAdapter } from './adapters/index.js';

// match file-path-like tokens (with an extension and at least one slash), bare or
// inside backticks. deliberately conservative to avoid flagging prose.
const PATH_RE = /`?([~/]?[\w.-]+(?:\/[\w.-]+)+\.[a-z0-9]{1,6})`?/gi;

export function extractPaths(body: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  PATH_RE.lastIndex = 0;
  while ((m = PATH_RE.exec(body || '')) !== null) out.add(m[1]);
  return [...out];
}

// a cited path is considered present if it resolves under any candidate root.
export function pathExists(p: string, roots: string[]): boolean {
  let cand = p;
  if (cand.startsWith('~')) cand = cand.replace(/^~/, process.env.HOME || '');
  if (isAbsolute(cand)) return existsSync(cand);
  return roots.some((r) => existsSync(join(r, cand)));
}

export interface CitationDrift {
  noteId: string;
  title: string;
  missing: string[];
}

export async function checkCitations(
  a: BrainAdapter,
  opts: { roots?: string[]; limit?: number; getContent?: (id: string) => Promise<string> } = {},
): Promise<CitationDrift[]> {
  const roots = opts.roots ?? [process.env.HOME || '.'];
  const read = opts.getContent ?? ((id: string) => a.getContent(id));
  const notes = await a.listAll({ tag: 'claude-brain', limit: opts.limit ?? 1000 });
  const drift: CitationDrift[] = [];
  for (const n of notes) {
    const body = await read(n.id).catch(() => '');
    const missing = extractPaths(body).filter((p) => !pathExists(p, roots));
    if (missing.length) drift.push({ noteId: n.id, title: n.title, missing });
  }
  return drift;
}
