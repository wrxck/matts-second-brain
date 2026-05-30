/**
 * near-duplicate detection for brain_remember. before a new note is written we
 * look for an existing note with the same or a very similar title, so the model
 * is nudged to brain_update instead of growing a pile of near-duplicates.
 */
import type { BrainAdapter } from './adapters/index.js';

// normalise a title to a bag of comparable words.
export function normaliseTitle(t: string): string {
  return (t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// jaccard similarity over word sets — cheap and dependency-free.
export function similarity(a: string, b: string): number {
  const wa = new Set(normaliseTitle(a).split(' ').filter(Boolean));
  const wb = new Set(normaliseTitle(b).split(' ').filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

export interface DupCandidate {
  id: string;
  title: string;
  score: number;
  path?: string;
}

// find the closest existing claude-brain note to `title`. an exact-title match
// scores 1; otherwise the best fuzzy match at or above `threshold` is returned.
export async function findDuplicate(
  a: BrainAdapter,
  title: string,
  opts: { threshold?: number; limit?: number } = {},
): Promise<DupCandidate | null> {
  const threshold = opts.threshold ?? 0.6;
  try {
    const exact = await a.search(title, { limit: 1, tag: 'claude-brain', exactTitle: true });
    if (exact.length) return { id: exact[0].id, title: exact[0].title, score: 1, path: exact[0].path };
  } catch {
    // fall through to fuzzy search
  }
  let best: DupCandidate | null = null;
  try {
    const cands = await a.search(title, { limit: opts.limit ?? 10, tag: 'claude-brain' });
    for (const c of cands) {
      const s = similarity(title, c.title);
      if (s >= threshold && (!best || s > best.score)) best = { id: c.id, title: c.title, score: s, path: c.path };
    }
  } catch {
    // no candidates
  }
  return best;
}
