/**
 * Tables — SYNTAX-MAPPING §2.1 (the source-side half of the render-time repair) and §1 row 26.
 *
 * Phase 4 made these tables *display* correctly without touching the file. This is the other
 * half: an offer to put the blank line into the page itself, so it renders in any Obsidian, any
 * other markdown tool, and a GitHub preview — not only where this plugin is installed.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */
import { findTableRanges, isTableRow } from "../../links/adoBlocks";
import {
  inCode,
  lineOf,
  lineStarts,
  type LintDocument,
  type LintFinding,
  type LintRule,
} from "../types";

export const tableBlankLineRule: LintRule = {
  id: "table-needs-blank-line",
  description: "Tables that Azure DevOps renders but Obsidian shows as rows of pipes",

  run(doc: LintDocument): LintFinding[] {
    const lines = doc.text.split("\n");
    const starts = lineStarts(lines);
    const findings: LintFinding[] = [];

    for (const table of findTableRanges(lines)) {
      if (inCode(doc, starts[table.start])) continue;

      const above = table.start > 0 ? lines[table.start - 1] : "";
      const below = lines[table.end + 1];
      const needsAbove = table.start > 0 && above.trim().length > 0;
      const needsBelow = below !== undefined && below.trim().length > 0 && !isTableRow(below);
      if (!needsAbove && !needsBelow) continue;

      const edits = [];
      // Last-first, so each offset is still valid when the next edit is applied.
      if (needsBelow) edits.push({ from: starts[table.end + 1], to: starts[table.end + 1], text: "\n" });
      if (needsAbove) edits.push({ from: starts[table.start], to: starts[table.start], text: "\n" });

      findings.push({
        rule: tableBlankLineRule.id,
        severity: "warn",
        message:
          "This table has no blank line around it. Azure DevOps still renders it; Obsidian and " +
          "most other markdown tools show the rows as text.",
        path: doc.path,
        from: starts[table.start],
        to: starts[table.end] + lines[table.end].length,
        line: lineOf(doc.text, starts[table.start]),
        fix: {
          description: "Insert the blank line(s)",
          edits,
        },
      });
    }

    return findings;
  },
};

export const taskInTableRule: LintRule = {
  id: "task-in-table",
  description: "Checklists inside a table, which Azure DevOps does not render",

  run(doc: LintDocument): LintFinding[] {
    const lines = doc.text.split("\n");
    const starts = lineStarts(lines);
    const findings: LintFinding[] = [];

    for (const table of findTableRanges(lines)) {
      if (inCode(doc, starts[table.start])) continue;

      for (let index = table.start; index <= table.end; index++) {
        if (!/(^|\|)\s*[-*+]?\s*\[[ xX]\]/.test(lines[index])) continue;
        findings.push({
          rule: taskInTableRule.id,
          severity: "warn",
          message: "Azure DevOps does not render a checklist inside a table cell.",
          path: doc.path,
          from: starts[index],
          to: starts[index] + lines[index].length,
          line: index,
          advice: "Use ✔/✖ characters in the cell, or move the checklist out of the table.",
        });
        break;
      }
    }

    return findings;
  },
};

