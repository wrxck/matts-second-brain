/**
 * BrainAdapter — the interface every backend implements. Lets users swap
 * Trilium for Obsidian, Notion, or any other note store without touching
 * the MCP tool layer.
 *
 * Selection is driven by env / config:
 *   BRAIN_BACKEND=trilium|obsidian|notion       (default: trilium)
 * Backend-specific env documented in each adapter file.
 */

export interface BrainNote {
  /** Backend-native id. Opaque to callers — only used to round-trip into
   *  update/get/addLabel calls. */
  id: string;
  title: string;
  /** ISO timestamp; some backends may omit. */
  modifiedAt?: string;
  /** Path-like breadcrumb, e.g. "Claude Memory/Standards/Git Workflow". */
  path?: string;
}

export interface CreateNoteInput {
  /** Path of the parent. Created on the fly if missing (and if backend supports). */
  parentPath: string;
  title: string;
  /** Plain text body. Adapter may HTML-escape, markdown-format, etc as appropriate. */
  body: string;
  /** Tags to attach. Trilium uses labels; Obsidian uses #tags in body; Notion uses
   *  multi_select properties. Adapter handles the mapping. */
  tags: string[];
}

export interface BrainAdapter {
  /** Identifier for log output: 'trilium' | 'obsidian' | 'notion' | etc. */
  readonly name: string;

  /** Confirm the backend is reachable + credentials work. Throws on failure. */
  ping(): Promise<void>;

  /** Free-text search. Should respect tags + breadcrumb context if the backend
   *  supports them. limit is advisory.
   *  When exactTitle=true, only notes whose title equals the query exactly
   *  should be returned. Backends that cannot natively filter by title must
   *  post-filter by n.title === query. */
  search(query: string, opts?: { limit?: number; tag?: string; exactTitle?: boolean }): Promise<BrainNote[]>;

  /** Resolve a path-like string ("Claude Memory/Standards") to an id. If
   *  create=true, build any missing intermediates. */
  resolvePath(path: string, opts?: { create?: boolean }): Promise<string>;

  /** Read body content as plain text (HTML/markdown stripped where reasonable). */
  getContent(id: string): Promise<string>;

  /** Create a note. Returns the new note's id + canonical path. */
  create(input: CreateNoteInput): Promise<{ id: string; path: string }>;

  /** Replace a note's body. */
  setContent(id: string, body: string): Promise<void>;

  /** Best-effort: attach a tag/label to an existing note. No-op if backend
   *  uses inline tags and the body needs editing — adapter decides. */
  addTag(id: string, tag: string): Promise<void>;

  /** Walk the entire brain (filtered to claude-brain tagged notes when the
   *  backend supports it). Used by the srag exporter for full-corpus
   *  chunking + embedding. Adapters MAY cap at a sane upper bound — return
   *  what they can and let the caller paginate later if needed. */
  listAll(opts?: { underPath?: string; tag?: string; limit?: number }): Promise<BrainNote[]>;
}

import { TriliumAdapter } from './trilium.js';
import { ObsidianAdapter } from './obsidian.js';
import { NotionAdapter } from './notion.js';

/** Factory: pick an adapter from env. */
export function loadAdapter(): BrainAdapter {
  const backend = (process.env.BRAIN_BACKEND ?? 'trilium').toLowerCase();
  switch (backend) {
    case 'trilium':  return new TriliumAdapter();
    case 'obsidian': return new ObsidianAdapter();
    case 'notion':   return new NotionAdapter();
    default:
      throw new Error(`Unknown BRAIN_BACKEND="${backend}". Valid: trilium, obsidian, notion.`);
  }
}
