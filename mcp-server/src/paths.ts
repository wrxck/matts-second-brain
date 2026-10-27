import { realpathSync } from 'node:fs';

const MEMORY_DIR = /^\/(?:root|home\/[^/]+)\/\.claude\/projects\/[^/]+\/memory$/;

export function isMemoryDirectory(realPath: string): boolean {
  return MEMORY_DIR.test(realPath);
}

// the shared service runs as root and onboard can delete files, so it may only touch claude memory dirs
export function assertMemoryDirectory(directory: string): string {
  let real: string;
  try {
    real = realpathSync(directory);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`cannot resolve directory ${directory}: ${msg}`);
  }
  if (!isMemoryDirectory(real)) {
    throw new Error(
      `refusing ${directory}: brain_onboard only reads ~/.claude/projects/<project>/memory directories`,
    );
  }
  return real;
}
