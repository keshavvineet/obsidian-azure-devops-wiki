/**
 * Obsidian-only *inline* syntax — SYNTAX-MAPPING §1 rows 7–10 and 12.
 *
 * `==highlight==` and `%%comment%%` have exact HTML equivalents that Azure DevOps renders, so
 * both carry a fix. A letter `#tag` and a `[^footnote]` do not: what should replace them is a
 * decision about the page's content, and the linter's job there is to make the loss visible
 * before it is published, not to guess.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */
import { findMarkdownLinks } from "../../links/adoLinkResolver";
import { findInlineTokens } from "../../links/inlineAdo";
import { inCode, lineOf, type LintDocument, type LintFinding, type LintRule } from "../types";

/** `==text==`, not spanning a line break. */
const HIGHLIGHT = /==([^=\n](?:[^\n]*?[^=\n])?)==/g;
/** `%%comment%%`, inline or across lines — both forms leak onto ADO verbatim. */
const COMMENT = /%%([\s\S]*?)%%/g;
/** `#tag`, `#nested/tag` — a tag must contain a letter, which is what keeps `#123` out. */
const TAG = /(^|[\s(])#([A-Za-zÀ-￿][\wÀ-￿/-]*)/g;
/** `[^1]` and its definition line. */
const FOOTNOTE = /\[\^([^\]\s]+)\]/g;

export const highlightRule: LintRule = {
  id: "obsidian-highlight",
  description: "==highlight==, which Azure DevOps shows with the equals signs",

  run(doc: LintDocument): LintFinding[] {
    const findings: LintFinding[] = [];
    // Attachment names really do contain '==' ('==image_0==-<guid>.png' exists in production),
    // so a match anywhere inside a link — text or destination — is a file name, not a highlight.
    const links = findMarkdownLinks(doc.text);

    for (const match of doc.text.matchAll(HIGHLIGHT)) {
      const from = match.index ?? 0;
      if (inCode(doc, from)) continue;
      if (links.some((link) => from >= link.start && from < link.end)) continue;

      findings.push({
        rule: highlightRule.id,
        severity: "warn",
        message: "==highlight== is Obsidian-only; Azure DevOps shows the equals signs.",
        path: doc.path,
        from,
        to: from + match[0].length,
        line: lineOf(doc.text, from),
        fix: {
          description: "Use <mark> instead",
          edits: [{ from, to: from + match[0].length, text: `<mark>${match[1]}</mark>` }],
        },
      });
    }
    return findings;
  },
};

export const commentRule: LintRule = {
  id: "obsidian-comment",
  description: "%%comments%%, which leak onto the published page",

  run(doc: LintDocument): LintFinding[] {
    const findings: LintFinding[] = [];
    for (const match of doc.text.matchAll(COMMENT)) {
      const from = match.index ?? 0;
      if (inCode(doc, from)) continue;

      findings.push({
        rule: commentRule.id,
        severity: "error",
        message: "%%…%% is an Obsidian comment. Azure DevOps publishes it as visible text.",
        path: doc.path,
        from,
        to: from + match[0].length,
        line: lineOf(doc.text, from),
        fix: {
          description: "Turn it into an HTML comment",
          edits: [{ from, to: from + match[0].length, text: `<!--${match[1]}-->` }],
        },
      });
    }
    return findings;
  },
};

export const tagRule: LintRule = {
  id: "obsidian-tag",
  description: "#tags, which have no meaning on Azure DevOps",

  run(doc: LintDocument): LintFinding[] {
    const findings: LintFinding[] = [];
    // Work-item references are the *supported* use of '#', and they are digits — the tag
    // pattern already excludes them, but an explicit check keeps the two rules from drifting.
    const workItems = new Set(
      findInlineTokens(doc.text, { workItems: true, pullRequests: false, mentions: false }).map(
        (token) => token.start,
      ),
    );

    for (const match of doc.text.matchAll(TAG)) {
      const from = (match.index ?? 0) + match[1].length;
      if (inCode(doc, from) || workItems.has(from)) continue;

      findings.push({
        rule: tagRule.id,
        severity: "warn",
        message: `#${match[2]} is an Obsidian tag. Azure DevOps renders it as plain text.`,
        path: doc.path,
        from,
        to: from + match[2].length + 1,
        line: lineOf(doc.text, from),
        advice: "Move it to the page's frontmatter, or drop it — ADO has no tag index.",
      });
    }
    return findings;
  },
};

export const footnoteRule: LintRule = {
  id: "obsidian-footnote",
  description: "Footnotes, which Azure DevOps shows as literal text",

  run(doc: LintDocument): LintFinding[] {
    const findings: LintFinding[] = [];
    for (const match of doc.text.matchAll(FOOTNOTE)) {
      const from = match.index ?? 0;
      if (inCode(doc, from)) continue;

      findings.push({
        rule: footnoteRule.id,
        severity: "warn",
        message: `${match[0]} is a footnote. Azure DevOps renders it as literal text.`,
        path: doc.path,
        from,
        to: from + match[0].length,
        line: lineOf(doc.text, from),
        advice: "Inline the note, or use a <sup> tag, which Azure DevOps does render.",
      });
    }
    return findings;
  },
};
