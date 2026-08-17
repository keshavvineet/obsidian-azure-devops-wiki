/**
 * `:::` blocks and Mermaid — ADO-WIKI-FORMAT §4.1.
 *
 * Obsidian renders every Mermaid dialect; Azure DevOps renders a subset. A diagram that looks
 * right locally and fails on the wiki is exactly the kind of thing that is only discovered
 * after publishing, so it is worth a rule even though nothing is technically "wrong".
 *
 * PURE MODULE — must not import from 'obsidian'.
 */
import { findColonBlocks } from "../../links/adoBlocks";
import {
  inCode,
  lineStarts,
  type LintDocument,
  type LintFinding,
  type LintRule,
} from "../types";

/** Mermaid sources, whichever fence carries them. */
const MERMAID_FENCE = /^ {0,3}```+\s*mermaid[ \t]*$/;

export const unterminatedBlockRule: LintRule = {
  id: "unterminated-colon-block",
  description: "A ::: block with no closing fence",

  run(doc: LintDocument): LintFinding[] {
    const lines = doc.text.split("\n");
    const starts = lineStarts(lines);
    const findings: LintFinding[] = [];

    for (const block of findColonBlocks(doc.text)) {
      if (block.closed || inCode(doc, starts[block.startLine])) continue;
      findings.push({
        rule: unterminatedBlockRule.id,
        severity: "warn",
        message: `This "::: ${block.keyword}" block is never closed, so the rest of the page is inside it.`,
        path: doc.path,
        from: starts[block.startLine],
        to: starts[block.startLine] + lines[block.startLine].length,
        line: block.startLine,
        fix: {
          description: "Close the block at the end of the page",
          edits: [{ from: doc.text.length, to: doc.text.length, text: "\n:::\n" }],
        },
      });
    }

    return findings;
  },
};

export const mermaidDialectRule: LintRule = {
  id: "mermaid-unsupported",
  description: "Mermaid syntax Azure DevOps cannot render (flowchart, long arrows, HTML)",

  run(doc: LintDocument): LintFinding[] {
    const lines = doc.text.split("\n");
    const starts = lineStarts(lines);
    const findings: LintFinding[] = [];

    for (const [start, end] of mermaidRanges(lines)) {
      for (let index = start; index <= end; index++) {
        const line = lines[index];

        const flowchart = /^(\s*)flowchart(\s|$)/.exec(line);
        if (flowchart) {
          const at = starts[index] + flowchart[1].length;
          findings.push({
            rule: mermaidDialectRule.id,
            severity: "warn",
            message: 'Azure DevOps does not support "flowchart"; it renders "graph".',
            path: doc.path,
            from: at,
            to: at + "flowchart".length,
            line: index,
            fix: {
              description: 'Use "graph"',
              edits: [{ from: at, to: at + "flowchart".length, text: "graph" }],
            },
          });
        }

        const longArrow = /-{4,}>/.exec(line);
        if (longArrow) {
          const at = starts[index] + (longArrow.index ?? 0);
          findings.push({
            rule: mermaidDialectRule.id,
            severity: "warn",
            message: "Azure DevOps does not render arrows longer than '--->'.",
            path: doc.path,
            from: at,
            to: at + longArrow[0].length,
            line: index,
            fix: {
              description: "Shorten the arrow",
              edits: [{ from: at, to: at + longArrow[0].length, text: "-->" }],
            },
          });
        }

        const html = /<(br|b|i|span|div|font)\b[^>]*>/i.exec(line);
        if (html) {
          const at = starts[index] + (html.index ?? 0);
          findings.push({
            rule: mermaidDialectRule.id,
            severity: "info",
            message: "Azure DevOps ignores most HTML inside a Mermaid diagram.",
            path: doc.path,
            from: at,
            to: at + html[0].length,
            line: index,
            advice: "Use plain node labels, or accept that the diagram looks different on ADO.",
          });
        }
      }
    }

    return findings;
  },
};

/** Line ranges (inclusive) holding Mermaid source, from either fence style. */
function mermaidRanges(lines: readonly string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  for (let index = 0; index < lines.length; index++) {
    if (!MERMAID_FENCE.test(lines[index])) continue;
    let end = index + 1;
    while (end < lines.length && !/^ {0,3}```+\s*$/.test(lines[end])) end++;
    if (end - 1 >= index + 1) ranges.push([index + 1, end - 1]);
    index = end;
  }

  for (const block of findColonBlocks(lines.join("\n"))) {
    if (block.kind !== "mermaid" || !block.closed) continue;
    if (block.endLine - 1 >= block.startLine + 1) {
      ranges.push([block.startLine + 1, block.endLine - 1]);
    }
  }

  return ranges;
}

