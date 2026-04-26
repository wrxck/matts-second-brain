---
title: Writing your own backend
description: One file. Implement seven methods. Register in the factory.
---

The brain backend is defined by a single TypeScript interface in [`mcp-server/src/adapters/index.ts`](https://github.com/wrxck/matts-second-brain/blob/main/mcp-server/src/adapters/index.ts):

```ts
export interface BrainAdapter {
  readonly name: string;

  ping(): Promise<void>;

  search(query: string, opts?: { limit?: number; tag?: string }): Promise<BrainNote[]>;

  resolvePath(path: string, opts?: { create?: boolean }): Promise<string>;

  getContent(id: string): Promise<string>;

  create(input: CreateNoteInput): Promise<{ id: string; path: string }>;

  setContent(id: string, body: string): Promise<void>;

  addTag(id: string, tag: string): Promise<void>;
}
```

That's the whole API surface. Implement these seven methods, drop the file in `mcp-server/src/adapters/`, register it in the factory in `index.ts`, ship.

## Steps

1. **Create `mcp-server/src/adapters/<your-backend>.ts`** following the shape of `obsidian.ts` (simplest reference) or `trilium.ts` (most feature-rich reference).
2. **Decide your storage idiom**:
   - File-based? See `obsidian.ts` — `id` = relative path, paths = directories.
   - API-based? See `notion.ts` — `id` = backend-native uuid, paths walked via API calls.
   - Database? Either works.
3. **Decide your tag mechanism**:
   - First-class labels? (Trilium)
   - Inline `#tags` in body? (Obsidian)
   - Properties / multi-select? (Notion)
4. **Decide your search strategy**:
   - The interface only requires "free-text search returning matching notes". Use the most natural fit for your backend (full-text search, grep, vector embeddings, …).
5. **Add your backend to the factory** in `adapters/index.ts`:
   ```ts
   import { MyBackendAdapter } from './my-backend.js';

   export function loadAdapter(): BrainAdapter {
     const backend = (process.env.BRAIN_BACKEND ?? 'trilium').toLowerCase();
     switch (backend) {
       case 'trilium':    return new TriliumAdapter();
       case 'obsidian':   return new ObsidianAdapter();
       case 'notion':     return new NotionAdapter();
       case 'my-backend': return new MyBackendAdapter();
       default:
         throw new Error(`Unknown BRAIN_BACKEND="${backend}"`);
     }
   }
   ```
6. **Document required env vars** in your file's top-of-file comment.
7. **Open a PR** — the adapter test suite (`mcp-server/tests/adapters/`) covers the interface contract, run it against your new adapter to validate behaviour.

## Things to watch

- **Idempotency**: `resolvePath(path, { create: true })` should not throw if the path already exists.
- **`brain_remember` enforcement**: the MCP layer enforces the *what / why / evidence* structure for `decisions` and `lessons`. Your adapter doesn't need to.
- **Tag semantics**: every `brain_remember` call asks the adapter to attach `#claude-brain`. Make sure your search respects it as a filter (or fake it via convention).
- **`getContent` should return clean text**: strip HTML / markdown / block formatting where reasonable. The MCP shows excerpts; users read them.
