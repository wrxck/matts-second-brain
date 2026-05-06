import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { BrainAdapter } from './adapters/index.js';

export type ValidCategory = 'standards' | 'decisions' | 'lessons' | 'apps' | 'reviews' | 'drafts';

export interface OnboardOptions {
  /** directory to scan for *.md memory files. required. */
  directory: string;
  /** if true, simulate without writing to brain or deleting source files. */
  dryRun?: boolean;
  /** if true, delete source files after a successful brain_remember. default false. */
  deleteOnSuccess?: boolean;
  /** override the default prefix→category mapping. */
  categoryMap?: Record<string, ValidCategory>;
  /** filenames to skip (basename match, case-sensitive). default: ['MEMORY.md', 'README.md']. */
  excludeFiles?: string[];
}

export interface OnboardEntry {
  file: string;
  category: ValidCategory | null;
  title: string;
  noteId: string | null;
  status: 'created' | 'skipped-exists' | 'skipped-no-category' | 'dry-run' | 'failed' | 'deleted-source';
  reason?: string;
}

export interface OnboardReport {
  directory: string;
  dryRun: boolean;
  total: number;
  created: number;
  skipped: number;
  failed: number;
  deletedSources: number;
  entries: OnboardEntry[];
}

const DEFAULT_CATEGORY_MAP: Record<string, ValidCategory> = {
  feedback: 'standards',
  reference: 'standards',
  standard: 'standards',
  project: 'decisions',
  decision: 'decisions',
  lesson: 'lessons',
};

const ROOT_NOTE_TITLE = 'Claude Memory';

const CATEGORY_PATH: Record<ValidCategory, string> = {
  standards: 'Standards',
  decisions: 'Decisions',
  lessons: 'Lessons Learned',
  apps: 'Apps',
  reviews: 'Reviews',
  drafts: 'Drafts',
};

const CONTENT_KEYWORDS = ['bounty', 'git', 'fleet', 'nginx', 'docker', 'postgres', 'stripe', 'guardian'];

/** strip yaml frontmatter from content, returning the rest. */
function stripFrontmatter(raw: string): string {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('---')) return raw;
  const after = trimmed.slice(3);
  const closeIdx = after.indexOf('\n---');
  if (closeIdx === -1) return raw;
  return after.slice(closeIdx + 4);
}

/** extract title from content: first H1 heading, or derive from filename. */
function extractTitle(content: string, filename: string): string {
  const lines = content.split('\n');
  for (const line of lines) {
    const m = line.match(/^#\s+(.+)/);
    if (m) return m[1].trim();
  }
  // derive from filename: drop prefix (before first _), replace _/- with spaces, title-case first letter
  const base = basename(filename, '.md');
  const withoutPrefix = base.includes('_') ? base.slice(base.indexOf('_') + 1) : base;
  const spaced = withoutPrefix.replace(/[_-]/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** strip the first H1 line from content. */
function stripH1(content: string): string {
  return content.replace(/^#\s+.+\n?/m, '');
}

/** check if body already has the required decision/lesson structure. */
function hasStructure(body: string): boolean {
  return /what:/i.test(body) && /why:/i.test(body) && /evidence:/i.test(body);
}

/** synthesise required headers around existing content. */
function synthesiseStructure(body: string): string {
  const trimmed = body.trim();
  const firstPara = trimmed.split(/\n\n/)[0] ?? '';
  const header = [
    `What: ${firstPara}`,
    'Why: imported from on-disk memory; original reasoning preserved below.',
    'Evidence: see the original content below.',
    '',
    '--- original content ---',
    '',
    trimmed,
  ].join('\n');
  return header;
}

/** derive tags from filename prefix and body keywords. always includes imported-from-disk. */
function deriveTags(prefix: string, body: string): string[] {
  const tags: string[] = ['imported-from-disk'];
  if (prefix && !tags.includes(prefix)) tags.push(prefix);
  for (const kw of CONTENT_KEYWORDS) {
    if (body.toLowerCase().includes(kw) && !tags.includes(kw)) {
      tags.push(kw);
      if (tags.length >= 6) break;
    }
  }
  return tags.slice(0, 6);
}

export async function onboardDirectory(adapter: BrainAdapter, opts: OnboardOptions): Promise<OnboardReport> {
  const {
    directory,
    dryRun = false,
    deleteOnSuccess = false,
    categoryMap = DEFAULT_CATEGORY_MAP,
    excludeFiles = ['MEMORY.md', 'README.md'],
  } = opts;

  const report: OnboardReport = {
    directory,
    dryRun,
    total: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    deletedSources: 0,
    entries: [],
  };

  let allFiles: string[];
  try {
    allFiles = readdirSync(directory).filter(f => f.endsWith('.md'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`cannot read directory ${directory}: ${msg}`);
  }

  const files = allFiles.filter(f => !excludeFiles.includes(basename(f)));
  report.total = files.length;

  for (const filename of files) {
    const filePath = join(directory, filename);
    const base = basename(filename, '.md');
    const prefix = base.includes('_') ? base.split('_')[0].toLowerCase() : base.toLowerCase();
    const category: ValidCategory | null = categoryMap[prefix] ?? null;

    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      report.failed++;
      report.entries.push({ file: filename, category, title: '', noteId: null, status: 'failed', reason: msg });
      continue;
    }

    const withoutFrontmatter = stripFrontmatter(raw);
    const title = extractTitle(withoutFrontmatter, filename);

    if (title.length < 3) {
      report.skipped++;
      report.entries.push({ file: filename, category, title, noteId: null, status: 'skipped-no-category', reason: 'title too short (< 3 chars)' });
      continue;
    }

    if (!category) {
      report.skipped++;
      report.entries.push({
        file: filename,
        category: null,
        title,
        noteId: null,
        status: 'skipped-no-category',
        reason: `prefix "${prefix}" not in category map`,
      });
      continue;
    }

    if (dryRun) {
      report.entries.push({ file: filename, category, title, noteId: null, status: 'dry-run' });
      continue;
    }

    // idempotency check: search by title and see if an exact match exists
    let existing: Awaited<ReturnType<typeof adapter.search>>;
    try {
      existing = await adapter.search(title, { tag: 'claude-brain', limit: 5 });
    } catch {
      existing = [];
    }
    const exact = existing.filter(n => n.title === title);
    if (exact.length >= 2) {
      report.skipped++;
      report.entries.push({ file: filename, category, title, noteId: null, status: 'skipped-exists', reason: 'multiple existing notes match title' });
      continue;
    }
    if (exact.length === 1) {
      report.skipped++;
      report.entries.push({ file: filename, category, title, noteId: exact[0].id, status: 'skipped-exists' });
      continue;
    }

    // build body
    let body = stripH1(withoutFrontmatter).trim();
    if ((category === 'decisions' || category === 'lessons') && !hasStructure(body)) {
      body = synthesiseStructure(body);
    }

    const tags = deriveTags(prefix, body);
    const parentPath = `${ROOT_NOTE_TITLE}/${CATEGORY_PATH[category]}`;

    let created: { id: string; path: string };
    try {
      created = await adapter.create({ parentPath, title, body, tags: ['claude-brain', ...tags] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      report.failed++;
      report.entries.push({ file: filename, category, title, noteId: null, status: 'failed', reason: msg });
      continue;
    }

    report.created++;
    report.entries.push({ file: filename, category, title, noteId: created.id, status: 'created' });

    if (deleteOnSuccess) {
      try {
        rmSync(filePath);
        report.deletedSources++;
        report.entries.push({ file: filename, category, title, noteId: created.id, status: 'deleted-source' });
      } catch {
        // non-fatal: note was created, source deletion just failed
      }
    }
  }

  return report;
}
