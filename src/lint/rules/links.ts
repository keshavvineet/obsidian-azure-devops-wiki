/**
 * Links that point at nothing (FR-3.7) and destinations Azure DevOps cannot serve.
 *
 * A broken link is broken on ADO too — the production audit found three of them in 96 pages —
 * so this rule reports what the wiki already suffers from rather than an Obsidian-only quirk.
 * There is no auto-fix: only a person knows which page was meant.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */
import { findMarkdownLinks, isExternalHref } from "../../links/adoLinkResolver";
import { inCode, lineOf, type LintDocument, type LintFinding, type LintHost, type LintRule } from "../types";

export const brokenLinkRule: LintRule = {
  id: "broken-link",
  description: "Links and images whose destination does not exist in the wiki",

  run(doc: LintDocument, host: LintHost): LintFinding[] {
    const findings: LintFinding[] = [];

    for (const link of findMarkdownLinks(doc.text)) {
      if (inCode(doc, link.start)) continue;
      const href = link.href.trim();
      // An empty destination is a placeholder someone is still writing.
      if (href.length === 0 || isExternalHref(href) || href.startsWith("#")) continue;
      if (host.resolves(href, doc.path)) continue;

      findings.push({
        rule: brokenLinkRule.id,
        severity: "error",
        message: link.isImage
          ? `No attachment at ${href} — the image is broken on Azure DevOps too.`
          : `No wiki page at ${href} — the link is broken on Azure DevOps too.`,
        path: doc.path,
        from: link.start,
        to: link.end,
        line: lineOf(doc.text, link.start),
        advice: link.isImage
          ? "Paste the image again, or point the link at a file that is in .attachments."
          : "Correct the destination, or create the page it refers to.",
      });
    }

    return findings;
  },
};

export const relativeLinkRule: LintRule = {
  id: "relative-link",
  description: "Relative links, which break as soon as a page is moved",

  run(doc: LintDocument, host: LintHost): LintFinding[] {
    const findings: LintFinding[] = [];

    for (const link of findMarkdownLinks(doc.text)) {
      if (inCode(doc, link.start)) continue;
      const href = link.href.trim();
      if (href.length === 0 || isExternalHref(href) || href.startsWith("#")) continue;
      if (href.startsWith("/")) continue;
      // Only a link that currently works is worth converting; a broken one is the other rule's.
      if (!host.resolves(href, doc.path)) continue;

      findings.push({
        rule: relativeLinkRule.id,
        severity: "info",
        message: `"${href}" is a relative link. Azure DevOps wiki links are usually root-absolute.`,
        path: doc.path,
        from: link.hrefStart,
        to: link.hrefEnd,
        line: lineOf(doc.text, link.start),
        advice: "It works today, but it breaks the moment either page is moved or renamed.",
      });
    }

    return findings;
  },
};
