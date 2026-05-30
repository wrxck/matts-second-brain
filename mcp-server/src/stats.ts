/**
 * brain_stats: counts of notes by category, total, and the most recently
 * touched notes. backend-agnostic — built on listAll over claude-brain notes.
 */
import type { BrainAdapter } from './adapters/index.js';

const ROOT = 'Claude Memory';

// derive the top-level category segment from a note path breadcrumb.
export function categoryOf(path?: string): string {
  if (!path) return 'other';
  const parts = path.split('/').filter(Boolean);
  const idx = parts.indexOf(ROOT);
  const seg = idx >= 0 ? parts[idx + 1] : parts[1] ?? parts[0];
  return seg || 'other';
}

export interface BrainStats {
  total: number;
  byCategory: Record<string, number>;
  recent: Array<{ title: string; modifiedAt?: string }>;
}

export async function computeStats(a: BrainAdapter, opts: { recentDays?: number; recentLimit?: number } = {}): Promise<BrainStats> {
  const all = await a.listAll({ tag: 'claude-brain', limit: 5000 });
  const byCategory: Record<string, number> = {};
  for (const n of all) {
    const cat = categoryOf(n.path);
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
  }
  const recentDays = opts.recentDays ?? 7;
  const cutoff = Date.now() - recentDays * 86400_000;
  const recent = all
    .filter((n) => n.modifiedAt && Date.parse(n.modifiedAt) >= cutoff)
    .sort((x, y) => Date.parse(y.modifiedAt as string) - Date.parse(x.modifiedAt as string))
    .slice(0, opts.recentLimit ?? 10)
    .map((n) => ({ title: n.title, modifiedAt: n.modifiedAt }));
  return { total: all.length, byCategory, recent };
}
