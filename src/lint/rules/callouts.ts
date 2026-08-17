/**
 * `> [!note] Title` — SYNTAX-MAPPING §1 row 7.
 *
 * Azure DevOps renders the blockquote but leaves `[!note] Title` visible inside it. The fix
 * keeps the blockquote (both platforms have it) and promotes the title to bold text, which is
 * what the callout was communicating in the first place.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */
import { inCode, lineOf, type LintDocument, type LintFinding, type LintRule } from "../types";

/** '> [!note]-' / '> [!warning] Careful', with the fold marker Obsidian allows. */
const CALLOUT = /^(\s*>\s*)\[!([A-Za-z-]+)\]([+-]?)[ \t]*(.*)$/;

export const calloutRule: LintRule = {
  id: "obsidian-callout",
  description: "Callouts, whose [!type] marker stays visible on Azure DevOps",

  run(doc: LintDocument): LintFinding[] {
    const findings: LintFinding[] = [];
    let offset = 0;

    for (const line of doc.text.split("\n")) {
      const match = CALLOUT.exec(line);
      if (match && !inCode(doc, offset)) {
        const [, quote, type, , title] = match;
        const heading = title.trim().length > 0 ? title.trim() : capitalize(type);
        findings.push({
          rule: calloutRule.id,
          severity: "warn",
          message: `Azure DevOps shows "[!${type}]" as text inside the quote.`,
          path: doc.path,
          from: offset,
          to: offset + line.length,
          line: lineOf(doc.text, offset),
          fix: {
            description: "Keep the quote, bold the title",
            edits: [{ from: offset, to: offset + line.length, text: `${quote}**${heading}**` }],
          },
        });
      }
      offset += line.length + 1;
    }

    return findings;
  },
};

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}
