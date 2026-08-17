/**
 * .order file codec (docs/ADO-WIKI-FORMAT.md §1).
 *
 * A .order file lists page names (no .md extension) one per line, in display order.
 * The first line of the wiki-root .order is the wiki home page.
 *
 * Round-tripping preserves the file's existing line-ending style and trailing-newline
 * habit so that touching one entry produces a one-line git diff, not a whole-file rewrite.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */

export interface OrderFile {
  /** Page names in display order, without the .md extension. */
  entries: string[];
  eol: "\n" | "\r\n";
  trailingNewline: boolean;
}

export function parseOrderFile(raw: string): OrderFile {
  const content = raw.replace(/^﻿/, "");
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const entries = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return { entries, eol, trailingNewline: content.length === 0 || /\r?\n$/.test(content) };
}

export function serializeOrderFile(order: OrderFile): string {
  if (order.entries.length === 0) return "";
  return order.entries.join(order.eol) + (order.trailingNewline ? order.eol : "");
}

export function emptyOrderFile(): OrderFile {
  return { entries: [], eol: "\n", trailingNewline: true };
}

/** Append a page name if it isn't listed yet. Returns a new OrderFile. */
export function withEntryAppended(order: OrderFile, name: string): OrderFile {
  if (order.entries.includes(name)) return order;
  return { ...order, entries: [...order.entries, name] };
}

/** Remove a page name wherever it appears. */
export function withEntryRemoved(order: OrderFile, name: string): OrderFile {
  if (!order.entries.includes(name)) return order;
  return { ...order, entries: order.entries.filter((entry) => entry !== name) };
}

/** Replace a page name in place, preserving its position. Appends when not present. */
export function withEntryRenamed(order: OrderFile, from: string, to: string): OrderFile {
  if (!order.entries.includes(from)) return withEntryAppended(order, to);
  return { ...order, entries: order.entries.map((entry) => (entry === from ? to : entry)) };
}

/**
 * Rewrite the sequence to match `desired` (drag-to-reorder in the wiki tree).
 *
 * Only entries the file already lists are rearranged, and names in `desired` that are not
 * listed are ignored — the caller reorders what it can see, and pages it does not know about
 * keep their relative position at the end rather than silently vanishing.
 */
export function withEntriesArranged(order: OrderFile, desired: readonly string[]): OrderFile {
  const listed = new Set(order.entries);
  const arranged = desired.filter((name) => listed.has(name));
  const moved = new Set(arranged);
  const entries = [...arranged, ...order.entries.filter((name) => !moved.has(name))];

  return sameSequence(order.entries, entries) ? order : { ...order, entries };
}

/** Move an entry to a new index. */
export function withEntryMoved(order: OrderFile, name: string, toIndex: number): OrderFile {
  const from = order.entries.indexOf(name);
  if (from === -1) return order;
  const entries = [...order.entries];
  entries.splice(from, 1);
  entries.splice(clamp(toIndex, 0, entries.length), 0, name);
  return { ...order, entries };
}

/** Move an entry to the front — the wiki home page, at the wiki root. */
export function withEntryFirst(order: OrderFile, name: string): OrderFile {
  return withEntryMoved(withEntryAppended(order, name), name, 0);
}

export interface ReconcileResult {
  order: OrderFile;
  /** Pages present on disk that were missing from .order (appended alphabetically). */
  added: string[];
  /** Entries in .order with no page on disk (dropped). */
  removed: string[];
  changed: boolean;
}

/**
 * Bring a .order file back in line with what's actually on disk, preserving the sequence
 * of entries that are still valid. Used after edits made outside the plugin (FR-2.2).
 */
export function reconcileOrder(order: OrderFile, pageNamesOnDisk: readonly string[]): ReconcileResult {
  const onDisk = new Set(pageNamesOnDisk);
  const kept: string[] = [];
  const removed: string[] = [];
  const seen = new Set<string>();

  for (const entry of order.entries) {
    if (!onDisk.has(entry)) {
      removed.push(entry);
      continue;
    }
    if (seen.has(entry)) {
      removed.push(entry); // duplicate line
      continue;
    }
    seen.add(entry);
    kept.push(entry);
  }

  const added = pageNamesOnDisk.filter((name) => !seen.has(name)).sort((a, b) => a.localeCompare(b));
  const entries = [...kept, ...added];
  const changed = added.length > 0 || removed.length > 0;

  return { order: { ...order, entries }, added, removed, changed };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}
