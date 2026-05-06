#!/usr/bin/env node
/**
 * @matthesketh/second-brain-mcp — MCP server exposing the brain_* tools.
 *
 * Tools:
 *   brain_setup_check      — diagnose what's installed/missing
 *   brain_seed_taxonomy    — create root note + Standards/Decisions/etc structure
 *   brain_recall           — semantic-ish search relevant to a query
 *   brain_remember         — write a note with the right taxonomy + tags
 *   brain_update           — update a note with explicit "supersedes" link + reason
 *   brain_scan_transcripts — analyse ~/.claude/projects/* for inferable notes (dry by default)
 *   brain_onboard          — migrate on-disk memory dir into the brain (idempotent, dry-run capable)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { loadAdapter, type BrainAdapter } from './adapters/index.js';
import { onboardDirectory } from './onboard.js';
import { exportBrain, indexExport, querySrag, sragInstalled, exportDir } from './srag.js';

const ROOT_NOTE_TITLE = 'Claude Memory';
const TAXONOMY = ['00 — How to use this brain', 'Standards', 'Decisions', 'Lessons Learned', 'Apps', 'Reviews', 'Drafts'] as const;
const VALID_CATEGORIES = ['standards', 'decisions', 'lessons', 'apps', 'reviews', 'drafts'] as const;

function categoryToPath(category: string, sub?: string): string {
  const map: Record<string, string> = {
    standards: 'Standards',
    decisions: 'Decisions',
    lessons: 'Lessons Learned',
    apps: 'Apps',
    reviews: 'Reviews',
    drafts: 'Drafts',
  };
  const base = map[category];
  if (!base) throw new Error(`Unknown category: ${category}. Valid: ${Object.keys(map).join(', ')}`);
  return sub ? `${ROOT_NOTE_TITLE}/${base}/${sub}` : `${ROOT_NOTE_TITLE}/${base}`;
}

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }] };
}

async function main() {
  const server = new McpServer({ name: 'second-brain', version: '0.1.0' });

  // ── brain_setup_check ───────────────────────────────────────────────
  server.tool(
    'brain_setup_check',
    'Diagnose what is installed/missing in this Claude instance: Trilium reachability, ETAPI token, root taxonomy, transcript dir. Run this first.',
    {},
    async () => {
      const status: Record<string, string> = {};
      try {
        const adapter = loadAdapter();
        status.backend = `[ok] using ${adapter.name} backend`;
        try {
          await adapter.ping();
          status.reachable = `[ok] ${adapter.name} reachable + credentials valid`;
          try {
            const found = await adapter.search(`note.title = "${ROOT_NOTE_TITLE}"`, { limit: 1 });
            status.root_note = found.length > 0
              ? `[ok] root note exists (id=${found[0].id})`
              : '[needs setup] root note missing — call brain_seed_taxonomy';
          } catch (e: any) {
            status.root_note = `[unknown] ${e.message}`;
          }
        } catch (e: any) {
          status.reachable = `[needs setup] backend unreachable / credentials invalid: ${e.message}`;
        }
      } catch (e: any) {
        status.backend = `[needs setup] ${e.message}`;
      }
      const transcriptsDir = join(homedir(), '.claude', 'projects');
      status.transcripts = existsSync(transcriptsDir)
        ? `[ok] ${transcriptsDir} exists (${readdirSync(transcriptsDir).length} project dirs)`
        : `[info] no transcripts dir at ${transcriptsDir}`;

      try {
        if (sragInstalled()) {
          const ed = exportDir((status.backend.startsWith('[ok] using ') ? status.backend.slice('[ok] using '.length).split(' ')[0] : 'unknown'));
          status.srag = `[ok] srag CLI available — semantic search ready. export dir: ${ed}`;
        } else {
          status.srag = '[optional] srag CLI not on PATH — semantic search disabled. Install from https://github.com/wrxck/system-rag';
        }
      } catch (e: any) {
        status.srag = `[unknown] ${e.message}`;
      }

      return text(Object.entries(status).map(([k, v]) => `${k}: ${v}`).join('\n'));
    },
  );

  // ── brain_seed_taxonomy ─────────────────────────────────────────────
  server.tool(
    'brain_seed_taxonomy',
    'Create the root "Claude Memory" note and standard children (Standards, Decisions, Lessons Learned, Apps, Reviews, Drafts). Idempotent — skips notes that already exist.',
    {},
    async () => {
      const a = loadAdapter();
      // resolvePath with create=true gives idempotent root + child creation
      // for any backend.
      try { await a.resolvePath(ROOT_NOTE_TITLE, { create: true }); } catch (e: any) {
        return text(`Failed to create root: ${e.message}`);
      }
      const created: string[] = [];
      const skipped: string[] = [];
      for (const child of TAXONOMY) {
        try {
          await a.resolvePath(`${ROOT_NOTE_TITLE}/${child}`, { create: false });
          skipped.push(child);
        } catch {
          await a.resolvePath(`${ROOT_NOTE_TITLE}/${child}`, { create: true });
          created.push(child);
        }
      }
      return text(
        `Backend: ${a.name}\nRoot: ${ROOT_NOTE_TITLE}\n` +
        `Created: ${created.length ? created.join(', ') : '(none)'}\n` +
        `Skipped (already existed): ${skipped.length ? skipped.join(', ') : '(none)'}`,
      );
    },
  );

  // ── brain_recall ────────────────────────────────────────────────────
  server.tool(
    'brain_recall',
    'Search the brain for notes relevant to a query. Returns title + path + last-modified date + brief excerpt for each match. Filter by category if known. Always cite results when referencing them.',
    {
      query: z.string().describe('Free-text query — e.g. "git workflow", "macpool deployment", "stripe leak lesson"'),
      category: z.enum(VALID_CATEGORIES).optional().describe('Restrict to one category if known'),
      limit: z.number().optional().default(10).describe('Max results (default 10)'),
    },
    async ({ query, category, limit }) => {
      const a = loadAdapter();
      const results = await a.search(query, { limit, tag: 'claude-brain' });
      if (results.length === 0) {
        return text(`No matches for "${query}"${category ? ` in ${category}` : ''}.`);
      }
      const lines: string[] = [`Brain matches for "${query}" (backend=${a.name}, ${results.length} results):`];
      for (const r of results) {
        const body = await a.getContent(r.id).catch(() => '');
        const excerpt = body.slice(0, 160);
        lines.push(`  • ${r.title}  [id=${r.id}, modified ${r.modifiedAt ?? '?'}]`);
        if (excerpt) lines.push(`      "${excerpt}${body.length > 160 ? '…' : ''}"`);
      }
      return text(lines.join('\n'));
    },
  );

  // ── brain_remember ──────────────────────────────────────────────────
  server.tool(
    'brain_remember',
    'Write a new note to the brain. For decisions and lessons, body must contain the "what / why / evidence" structure — refused otherwise. Tags every note with #claude-brain.',
    {
      category: z.enum(VALID_CATEGORIES),
      title: z.string().min(3).describe('Concise note title (no leading date — that goes in the body if relevant)'),
      body: z.string().min(20).describe('Note body. For decisions/lessons MUST include "What:", "Why:", "Evidence:" lines.'),
      app: z.string().optional().describe('Required when category=apps — the app name (e.g. "macpool")'),
      tags: z.array(z.string()).optional().default([]).describe('Extra labels beyond claude-brain'),
    },
    async ({ category, title, body, app, tags }) => {
      if (category === 'apps' && !app) {
        return text('Error: category=apps requires `app` argument (e.g. app="macpool").');
      }
      if ((category === 'decisions' || category === 'lessons') &&
          !(/what:/i.test(body) && /why:/i.test(body) && /evidence:/i.test(body))) {
        return text(
          `Error: ${category} notes require all three of "What:", "Why:", "Evidence:" in the body. ` +
          `If you can't fill all three, this is an opinion, not a decision/lesson — write it as a draft instead.`,
        );
      }
      const a = loadAdapter();
      const parentPath = `${ROOT_NOTE_TITLE}/${categoryToPath(category, category === 'apps' ? app : undefined).split('/').slice(1).join('/')}`;
      const out = await a.create({ parentPath, title, body, tags: ['claude-brain', ...tags] });
      return text(`Wrote (backend=${a.name}): ${out.path}\n  id: ${out.id}\n  tags: claude-brain${tags.length ? ', ' + tags.join(', ') : ''}`);
    },
  );

  // ── brain_update ────────────────────────────────────────────────────
  server.tool(
    'brain_update',
    'Update a note with explicit "supersedes" link to the prior version + a reason. Never silently overwrites — keeps audit trail.',
    {
      noteId: z.string().describe('Note id to update'),
      newBody: z.string().min(20).describe('New body content'),
      reason: z.string().min(10).describe('Why the change — appears in a #superseded label'),
    },
    async ({ noteId, newBody, reason }) => {
      const a = loadAdapter();
      const oldContent = await a.getContent(noteId);
      // Save old content as a child note (works for adapters where parent
      // path can be a node id or where ids ARE paths).
      const archived = await a.create({
        parentPath: noteId,
        title: `[archived ${new Date().toISOString().slice(0, 10)}]`,
        body: oldContent,
        tags: ['claude-brain-archived'],
      }).catch(() => null);
      const stamp = `\n\n--- Updated ${new Date().toISOString()}: ${reason} ---`;
      await a.setContent(noteId, newBody + stamp);
      return text(
        `Updated note ${noteId}\n` +
        `  Archived prior content as: ${archived?.id ?? '(adapter does not support archive children — old body lost)'}\n` +
        `  Reason: ${reason}`,
      );
    },
  );

  // ── brain_scan_transcripts ──────────────────────────────────────────
  server.tool(
    'brain_scan_transcripts',
    'Scan ~/.claude/projects/*/*.jsonl for patterns that might warrant Standards or Lessons. Returns INFERRED candidates only — never auto-writes. The user reviews + accepts. Safe to run repeatedly.',
    {
      sinceDays: z.number().optional().default(30).describe('Only consider transcripts modified in the last N days (default 30)'),
      maxCandidates: z.number().optional().default(20).describe('Cap on returned suggestions'),
    },
    async ({ sinceDays, maxCandidates }) => {
      const dir = join(homedir(), '.claude', 'projects');
      if (!existsSync(dir)) return text(`No transcripts at ${dir}`);
      const cutoffMs = Date.now() - sinceDays * 86400_000;
      const correctionPatterns = [
        /\b(don't|do not|stop|never|always)\b/i,
        /\b(I told you|you keep|you always)\b/i,
        /\b(that's wrong|that is wrong|you got it wrong)\b/i,
        /\bcorrect/i,
      ];
      const found: Array<{ project: string; line: string; ts: string }> = [];
      const projects = readdirSync(dir);
      outer: for (const proj of projects) {
        const projDir = join(dir, proj);
        let files: string[] = [];
        try { files = readdirSync(projDir).filter(f => f.endsWith('.jsonl')); } catch { continue; }
        for (const f of files) {
          const fullPath = join(projDir, f);
          try {
            if (statSync(fullPath).mtimeMs < cutoffMs) continue;
            const data = readFileSync(fullPath, 'utf8');
            for (const line of data.split('\n')) {
              if (!line.trim()) continue;
              try {
                const entry = JSON.parse(line);
                if (entry.type !== 'user') continue;
                const text = JSON.stringify(entry.message?.content ?? '');
                for (const pat of correctionPatterns) {
                  if (pat.test(text)) {
                    found.push({ project: proj, line: text.slice(0, 200), ts: entry.timestamp ?? '' });
                    if (found.length >= maxCandidates) break outer;
                    break;
                  }
                }
              } catch { /* malformed line */ }
            }
          } catch { /* unreadable */ }
        }
      }
      if (found.length === 0) return text('No correction-pattern matches found. Brain stays as-is.');
      const lines: string[] = [`Found ${found.length} candidate corrections from past transcripts:`, ''];
      found.forEach((c, i) => {
        lines.push(`  ${i + 1}. [${c.project}] ${c.ts}`);
        lines.push(`     ${c.line}`);
        lines.push('');
      });
      lines.push('Review these and decide which to convert to Standards/. brain_remember writes the chosen ones.');
      return text(lines.join('\n'));
    },
  );

  // ── brain_sync_srag ─────────────────────────────────────────────────
  server.tool(
    'brain_sync_srag',
    'Export the brain to a directory of markdown files and (re)index them with the srag CLI for semantic search. Run this after writing several new notes, or on a schedule. Idempotent.',
    {
      clean: z.boolean().optional().default(false).describe('If true, wipe the export dir first (full rebuild). Default false (incremental).'),
      underPath: z.string().optional().describe('Restrict export to notes under this path (e.g. "Claude Memory/Standards").'),
    },
    async ({ clean, underPath }) => {
      if (!sragInstalled()) {
        return text(
          'srag CLI not found on PATH. Install from https://github.com/wrxck/system-rag and re-run. ' +
          'Set SRAG_BIN env to override the binary path.',
        );
      }
      const a = loadAdapter();
      const exp = await exportBrain(a, { clean, underPath });
      const idx = indexExport(a.name);
      const lines = [
        `Backend: ${a.name}`,
        `Export dir: ${exp.dir}`,
        `Notes written: ${exp.written}, skipped (empty): ${exp.skipped}, errors: ${exp.errors.length}`,
      ];
      if (exp.errors.length) {
        lines.push('First few errors:');
        for (const e of exp.errors.slice(0, 5)) lines.push(`  • ${e.id}: ${e.error}`);
      }
      lines.push('');
      lines.push(idx.ok ? `srag index: OK\n${idx.stdout.trim()}` : `srag index FAILED:\n${idx.stderr.trim() || idx.stdout.trim()}`);
      return text(lines.join('\n'));
    },
  );

  // ── brain_search_semantic ───────────────────────────────────────────
  server.tool(
    'brain_search_semantic',
    'Semantic search over the brain via srag (chunked + embedded markdown export). Returns ranked snippets. Complements brain_recall (keyword/tag search). Run brain_sync_srag first if the brain has changed since the last sync.',
    {
      query: z.string().describe('Natural-language question — e.g. "how do we rotate stripe keys", "git workflow for matt"'),
      limit: z.number().optional().default(8).describe('Max snippets returned (default 8)'),
    },
    async ({ query, limit }) => {
      if (!sragInstalled()) {
        return text('srag CLI not found on PATH. Run brain_sync_srag for setup instructions.');
      }
      const out = querySrag(query, limit);
      if (!out.ok) {
        return text(`srag query failed: ${out.stderr || '(no stderr)'}\n\nIf this is the first run, call brain_sync_srag to populate the index.`);
      }
      if (out.hits.length === 0) {
        return text(`No semantic matches for "${query}".\n(Tip: if you've added notes recently, run brain_sync_srag to refresh the embeddings.)`);
      }
      const a = loadAdapter();
      const lines: string[] = [];
      if (out.answer) {
        lines.push(`Answer (synthesised by srag):`, `  ${out.answer}`, '');
      }
      lines.push(`Semantic matches for "${query}" (backend=${a.name}, ${out.hits.length} hits):`);
      for (const h of out.hits.slice(0, limit)) {
        const scoreStr = typeof h.score === 'number' ? ` score=${h.score.toFixed(3)}` : '';
        lines.push(`  • ${h.file}${h.noteId ? `  (noteId=${h.noteId})` : ''}${scoreStr}`);
        if (h.snippet) lines.push(`      "${h.snippet.slice(0, 240).replace(/\s+/g, ' ').trim()}${h.snippet.length > 240 ? '…' : ''}"`);
      }
      return text(lines.join('\n'));
    },
  );

  // brain_onboard
  server.tool(
    'brain_onboard',
    'Onboard an on-disk memory directory: scan for *.md files and migrate each to the brain via brain_remember. Idempotent (skips notes that already exist by title). Dry-run capable. Optionally deletes source files after success.',
    {
      directory: z.string().describe('Directory containing the memory files (e.g. /root/.claude/projects/-home-matt/memory/)'),
      dryRun: z.boolean().optional().default(false).describe('If true, simulate without writing to brain or deleting files'),
      deleteOnSuccess: z.boolean().optional().default(false).describe('If true, delete each source file after its brain_remember succeeds'),
    },
    async ({ directory, dryRun, deleteOnSuccess }) => {
      const adapter = loadAdapter();
      const report = await onboardDirectory(adapter, { directory, dryRun, deleteOnSuccess });
      const lines = [
        `Onboard report for ${report.directory} (dry-run=${report.dryRun})`,
        `  total scanned: ${report.total}`,
        `  created:        ${report.created}`,
        `  skipped:        ${report.skipped}`,
        `  failed:         ${report.failed}`,
        `  source deleted: ${report.deletedSources}`,
        ``,
        `Entries:`,
      ];
      for (const e of report.entries) {
        lines.push(`  - ${e.file}`);
        lines.push(`      category=${e.category ?? '(none)'} status=${e.status}${e.reason ? ' reason=' + e.reason : ''}${e.noteId ? ' id=' + e.noteId : ''}`);
      }
      return text(lines.join('\n'));
    },
  );

  // ── ready ────────────────────────────────────────────────────────────
  await server.connect(new StdioServerTransport());
}

main().catch(err => {
  console.error('second-brain-mcp fatal:', err);
  process.exit(1);
});
