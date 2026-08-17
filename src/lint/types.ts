/**
 * Shared vocabulary of the compatibility linter (FR-8).
 *
 * A finding always points at a character range of one file, so the results pane can reveal it
 * and a fix can be applied without re-parsing anything. Fixes are plain text edits: applying
 * several at once is then a sort and a splice, and every fix is reviewable as a `git diff`.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */
import type { ConverterHost } from "../links/linkConverter";

/** error = breaks or garbles on ADO · warn = degrades · info = cosmetic (SYNTAX-MAPPING §1). */
export type LintSeverity = "error" | "warn" | "info";

export const SEVERITY_ORDER: Record<LintSeverity, number> = { error: 0, warn: 1, info: 2 };

export interface LintEdit {
  from: number;
  to: number;
  text: string;
}

export interface LintFix {
  /** Shown on the button, e.g. 'Convert to an Azure DevOps link'. */
  description: string;
  edits: LintEdit[];
}

export interface LintFinding {
  /** Stable rule id, used for filtering and for the settings that switch a rule off. */
  rule: string;
  severity: LintSeverity;
  message: string;
  /** Vault path of the file, or '' for a finding about the vault itself. */
  path: string;
  /** Character offsets in the file. Equal when the finding is about the file as a whole. */
  from: number;
  to: number;
  /** 0-based line, filled in by the linter for display. */
  line: number;
  /**
   * The text the finding was computed from, filled in centrally by `lintPage`.
   *
   * Fixes are character offsets, so a page edited between the scan and the fix must be
   * re-scanned rather than patched at coordinates that now point somewhere else.
   */
  excerpt?: string;
  fix?: LintFix;
  /** What to do when the repair is not a text edit (a rename, a move, a settings change). */
  advice?: string;
}

export interface LintDocument {
  path: string;
  text: string;
  /** Size on disk. Not `text.length`: the limit is bytes and the text is UTF-16 code units. */
  sizeBytes: number;
  /** Fenced blocks and inline code spans — no rule may edit inside these. */
  codeRanges: ReadonlyArray<[number, number]>;
}

/** The vault facts a pure rule cannot work out for itself. */
export interface LintHost {
  /** True when an ADO destination written in `fromPath` points at something that exists. */
  resolves(href: string, fromPath: string): boolean;
  /** The wikilink converter's view of the vault, for the `[[Page]]` → `[Page](/Page)` fix. */
  converterHost(fromPath: string): ConverterHost;
}

export interface LintRule {
  id: string;
  /** One line, shown in the settings list of rules. */
  description: string;
  run(doc: LintDocument, host: LintHost): LintFinding[];
}

/** Is this offset inside fenced or inline code? */
export function inCode(doc: LintDocument, offset: number): boolean {
  return doc.codeRanges.some(([start, end]) => offset >= start && offset < end);
}

/**
 * Character offset of the start of every line, plus one entry past the end so a rule can ask
 * about the line "below" the last one without a bounds check.
 */
export function lineStarts(lines: readonly string[]): number[] {
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  starts.push(offset);
  return starts;
}

/** 0-based line number of an offset. */
export function lineOf(text: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/**
 * Apply fixes to a file's text.
 *
 * Edits are applied last-first so earlier offsets stay valid, and an edit that overlaps one
 * already applied is dropped: two fixes for the same characters cannot both be right, and
 * silently interleaving them would produce text neither rule asked for.
 */
export function applyEdits(text: string, edits: readonly LintEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.from - a.from || b.to - a.to);
  let out = text;
  let lastFrom = Number.MAX_SAFE_INTEGER;

  for (const edit of sorted) {
    if (edit.to > lastFrom) continue;
    out = out.slice(0, edit.from) + edit.text + out.slice(edit.to);
    lastFrom = edit.from;
  }
  return out;
}
