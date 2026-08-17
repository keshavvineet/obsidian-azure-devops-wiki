/**
 * `[[Page]]`, `[[Page|Alias]]`, `[[Page#Heading]]`, `![[image.png]]` — SYNTAX-MAPPING §1 rows 1–6.
 *
 * Azure DevOps renders every one of these as literal text, so they are errors, not warnings.
 * The fix is the same conversion the editor performs at insert time, which is why this rule
 * calls `convertWikilink` rather than growing a second implementation of it.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */
import { convertWikilink, findWikilinks } from "../../links/linkConverter";
import { inCode, lineOf, type LintDocument, type LintFinding, type LintHost, type LintRule } from "../types";

export const wikilinkRule: LintRule = {
  id: "obsidian-wikilink",
  description: "Obsidian [[wikilinks]], which Azure DevOps shows as literal text",

  run(doc: LintDocument, host: LintHost): LintFinding[] {
    const findings: LintFinding[] = [];
    const converter = host.converterHost(doc.path);

    for (const link of findWikilinks(doc.text)) {
      if (inCode(doc, link.start)) continue;

      const converted = convertWikilink(link, converter);
      // `[[_TOC_]]` and `[[_TOSP_]]` are ADO's own syntax, not wikilinks.
      if (converted === null) continue;

      const base = {
        rule: wikilinkRule.id,
        severity: "error" as const,
        path: doc.path,
        from: link.start,
        to: link.end,
        line: lineOf(doc.text, link.start),
      };

      if ("skip" in converted) {
        findings.push({ ...base, ...unconvertible(link.raw, converted.skip) });
        continue;
      }

      findings.push({
        ...base,
        message: `${link.raw} renders as literal text on Azure DevOps.`,
        fix: {
          description: converted.droppedBlockRef
            ? "Convert to an Azure DevOps link (the block reference is dropped)"
            : "Convert to an Azure DevOps link",
          edits: [{ from: link.start, to: link.end, text: converted.text }],
        },
        advice: converted.droppedBlockRef
          ? "Azure DevOps has no block references, so ^id is lost — the link points at the page."
          : undefined,
      });
    }

    return findings;
  },
};

function unconvertible(
  raw: string,
  reason: "unresolved-page" | "unresolved-attachment" | "note-embed",
): { message: string; advice: string } {
  switch (reason) {
    case "unresolved-page":
      return {
        message: `${raw} renders as literal text on Azure DevOps, and no page of that name exists.`,
        advice: "Create the page, or correct the link target, then run the fix again.",
      };
    case "unresolved-attachment":
      return {
        message: `${raw} renders as literal text on Azure DevOps.`,
        advice:
          "Azure DevOps can only serve files from .attachments. Move the file there " +
          "(or paste it into the page again) and the link becomes fixable.",
      };
    case "note-embed":
      return {
        message: `${raw} embeds another page, which Azure DevOps cannot do.`,
        advice: "Link to the page instead, or copy the part you need into this one.",
      };
  }
}
