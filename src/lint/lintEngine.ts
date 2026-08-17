/**
 * Running the rules — the pure half of the compatibility linter (FR-8.1).
 *
 * `compatLinter.ts` is the adapter that reads files out of the vault and writes fixes back;
 * everything about *what* is wrong and *how it is repaired* lives here, so it can be tested
 * against strings.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */
import { findCodeRanges } from "../links/linkTargets";
import { ALL_RULES } from "./rules";
import {
  applyEdits,
  SEVERITY_ORDER,
  type LintDocument,
  type LintFinding,
  type LintHost,
  type LintRule,
  type LintSeverity,
} from "./types";

export interface LintOptions {
  /** Rule ids to skip. */
  disabled?: readonly string[];
  /** Rules to run instead of the full set — the test seam, and the pre-sync gate's shortcut. */
  rules?: readonly LintRule[];
}

/** Build the document rules see, including the code ranges none of them may edit inside. */
export function lintDocumentOf(path: string, text: string, sizeBytes?: number): LintDocument {
  return {
    path,
    text,
    sizeBytes: sizeBytes ?? byteLength(text),
    codeRanges: findCodeRanges(text),
  };
}

/**
 * Every finding for one page, most severe first, then in document order.
 *
 * A rule that throws is reported as an `info` finding rather than taking the whole run down:
 * a linter that silently stops after the first odd page is worse than one that says so.
 */
export function lintPage(
  doc: LintDocument,
  host: LintHost,
  options: LintOptions = {},
): LintFinding[] {
  const disabled = new Set(options.disabled ?? []);
  const findings: LintFinding[] = [];

  for (const rule of options.rules ?? ALL_RULES) {
    if (disabled.has(rule.id)) continue;
    try {
      for (const finding of rule.run(doc, host)) {
        // Stamped here rather than in every rule, so no rule can forget it.
        findings.push({ ...finding, excerpt: doc.text.slice(finding.from, finding.to) });
      }
    } catch (error) {
      findings.push({
        rule: rule.id,
        severity: "info",
        message: `The "${rule.id}" check could not run on this page (${messageOf(error)}).`,
        path: doc.path,
        from: 0,
        to: 0,
        line: 0,
      });
    }
  }

  return sortFindings(findings);
}

export function sortFindings(findings: LintFinding[]): LintFinding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.path.localeCompare(b.path) ||
      a.from - b.from,
  );
}

export interface FixOutcome {
  text: string;
  /** Findings whose edits were applied. */
  applied: LintFinding[];
  /**
   * Findings that were skipped because an earlier fix in the same run already changed those
   * characters. They are still there on the next pass, so a second run finishes the job.
   */
  deferred: LintFinding[];
}

/**
 * Apply the fixes of a set of findings to one file's text.
 *
 * Overlapping fixes cannot both be right — `[[a|b]]` inside a broken table row belongs to two
 * rules — so the more severe one wins and the other is deferred to the next run instead of being
 * blended into text neither rule asked for.
 */
export function applyFixes(text: string, findings: readonly LintFinding[]): FixOutcome {
  const fixable = sortFindings(findings.filter((finding) => finding.fix !== undefined));
  const applied: LintFinding[] = [];
  const deferred: LintFinding[] = [];
  const claimed: Array<[number, number]> = [];

  for (const finding of fixable) {
    const edits = finding.fix?.edits ?? [];
    const overlaps = edits.some((edit) =>
      claimed.some(([from, to]) => edit.from < to && edit.to > from),
    );
    if (overlaps) {
      deferred.push(finding);
      continue;
    }
    for (const edit of edits) claimed.push([edit.from, Math.max(edit.to, edit.from + 1)]);
    applied.push(finding);
  }

  const edits = applied.flatMap((finding) => finding.fix?.edits ?? []);
  return { text: applyEdits(text, edits), applied, deferred };
}

export function countBySeverity(findings: readonly LintFinding[]): Record<LintSeverity, number> {
  const counts: Record<LintSeverity, number> = { error: 0, warn: 0, info: 0 };
  for (const finding of findings) counts[finding.severity]++;
  return counts;
}

function byteLength(text: string): number {
  // Node and the browser both have TextEncoder; the fallback keeps this module dependency-free.
  return typeof TextEncoder === "undefined" ? text.length : new TextEncoder().encode(text).length;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
