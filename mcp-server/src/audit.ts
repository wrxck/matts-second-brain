/**
 * append-only audit of brain writes. logs metadata (action, category, title, id),
 * never note bodies, and redacts anything that looks like a secret value from the
 * fields it does log. writing must never throw — a failed audit is swallowed.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const AUDIT_PATH = process.env.BRAIN_AUDIT_LOG || join(homedir(), '.claude', 'second-brain', 'audit.log');

// coarse patterns for common secret shapes; redacted before anything is logged.
const SECRET_RE = /(AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g;

export function redact(s: string): string {
  return (s || '').replace(SECRET_RE, '[redacted-secret]');
}

export interface AuditEntry {
  action: 'remember' | 'update' | 'dedupe-skip';
  backend: string;
  category?: string;
  title?: string;
  noteId?: string;
  detail?: string;
}

export function formatEntry(entry: AuditEntry, now: () => number = Date.now): string {
  return JSON.stringify({
    ts: new Date(now()).toISOString(),
    action: entry.action,
    backend: entry.backend,
    category: entry.category,
    title: entry.title ? redact(entry.title) : undefined,
    noteId: entry.noteId,
    detail: entry.detail ? redact(entry.detail) : undefined,
  }) + '\n';
}

export function auditWrite(entry: AuditEntry, sink?: (line: string) => void): void {
  const line = formatEntry(entry);
  try {
    if (sink) { sink(line); return; }
    mkdirSync(dirname(AUDIT_PATH), { recursive: true });
    appendFileSync(AUDIT_PATH, line);
  } catch {
    // auditing must never crash a write path.
  }
}
