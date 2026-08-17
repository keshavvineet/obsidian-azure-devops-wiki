/**
 * Which lines of a page live preview may replace with a rendered widget, and what the page's
 * headings are (the input for `[[_TOC_]]`).
 *
 * Reading mode gets this information from Obsidian — rendered HTML plus `ctx.getSectionInfo`
 * and `metadataCache`. Live preview has neither: the CM6 document is the only source, and it is
 * also the *freshest* one, so a heading typed a second ago is already in the table of contents.
 *
 * Everything here works on raw lines and skips fenced code and frontmatter, because an ADO block
 * inside a code sample is a code sample (SYNTAX-MAPPING §2).
 *
 * PURE MODULE — must not import from 'obsidian'.
 */
import {
  isTableDelimiterRow,
  isTableRow,
  parseColonBlockAt,
  type ColonBlock,
} from "./adoBlocks";
import { findMarkdownLinks } from "./adoLinkResolver";

export interface DocHeading {
  text: string;
  /** 1–6. */
  level: number;
  line: number;
}

export type RenderableBlock =
  /** `::: mermaid` / `::: video` / `::: query-table`. */
  | { kind: "colon"; startLine: number; endLine: number; block: ColonBlock }
  /** A line containing nothing but `[[_TOC_]]` or `[[_TOSP_]]`. */
  | {
      kind: "macro";
      startLine: number;
      endLine: number;
      name: "TOC" | "TOSP";
      /** A second `[[_TOC_]]`, which Azure DevOps ignores (ADO-WIKI-FORMAT §4.1). */
      ignored: boolean;
    }
  /** A line containing nothing but one image link. */
  | { kind: "image"; startLine: number; endLine: number; href: string; alt: string }
  /**
   * A pipe table that Azure DevOps renders and Obsidian does not, because there is no blank
   * line between it and the text it is glued to (SYNTAX-MAPPING §2.1).
   */
  | { kind: "table"; startLine: number; endLine: number; markdown: string };

/** ``` or ~~~ , with the indentation CommonMark allows. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const MACRO_LINE = /^\s*\[\[_(TOC|TOSP)_\]\]\s*$/;
const HEADING = /^ {0,3}(#{1,6})(\s+.*)?$/;
const FRONTMATTER_END = /^(---|\.\.\.)\s*$/;

/**
 * Tracks the lines a markdown scanner must ignore: YAML frontmatter and fenced code.
 * Both scanners below walk the document once and ask this per line.
 */
class MarkdownContext {
  private fence: string | null = null;
  private inFrontmatter: boolean;

  constructor(lines: readonly string[]) {
    this.inFrontmatter = lines[0]?.trim() === "---";
  }

  /** True when this line is content the caller should look at. Advances the scanner state. */
  accepts(line: string, index: number): boolean {
    if (this.inFrontmatter) {
      if (index > 0 && FRONTMATTER_END.test(line)) this.inFrontmatter = false;
      return false;
    }
    if (this.fence !== null) {
      if (line.trimStart().startsWith(this.fence)) this.fence = null;
      return false;
    }
    const opening = FENCE.exec(line);
    if (opening) {
      this.fence = opening[1];
      return false;
    }
    return true;
  }
}

/**
 * The blocks in a document that can be rendered in place of their source lines, in order.
 *
 * Only *closed* `:::` blocks qualify: an unterminated one is a typo in the page, and showing it
 * raw is the honest thing to do (the reading-mode processor makes the same call).
 */
export function findRenderableBlocks(lines: readonly string[]): RenderableBlock[] {
  const blocks: RenderableBlock[] = [];
  const context = new MarkdownContext(lines);
  let seenToc = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!context.accepts(line, index)) continue;

    const colon = parseColonBlockAt(lines, index);
    if (colon && colon.closed) {
      blocks.push({ kind: "colon", startLine: index, endLine: colon.endLine, block: colon });
      // The body is the block's own content — no scanning inside it.
      index = colon.endLine;
      continue;
    }

    const macro = MACRO_LINE.exec(line);
    if (macro) {
      const name = macro[1] as "TOC" | "TOSP";
      // "The publishing system renders the TOC for the first instance of the tag … it ignores
      // other instances" — Microsoft markdown guidance, verified 2026-08-10.
      const ignored = name === "TOC" && seenToc;
      if (name === "TOC") seenToc = true;
      blocks.push({ kind: "macro", startLine: index, endLine: index, name, ignored });
      continue;
    }

    const table = adoOnlyTableAt(lines, index);
    if (table) {
      blocks.push(table);
      // The rows are the block's own content, and a row can hold anything, including a `:::`.
      index = table.endLine;
      continue;
    }

    const image = soleImageOf(line);
    if (image) blocks.push({ kind: "image", startLine: index, endLine: index, ...image });
  }

  return blocks;
}

/**
 * The pipe table starting at `index`, but **only when Obsidian would render it differently from
 * Azure DevOps**: glued to the text above it (ADO starts a table mid-paragraph, CommonMark does
 * not) or followed immediately by text (ADO ends the table there, GFM swallows the line as one
 * more row). A table with a blank line on both sides already renders identically and is left to
 * Obsidian, cursor behaviour and all.
 *
 * Only a table whose header row starts with `|` qualifies. That is what Azure DevOps' own editor
 * writes, and it keeps the rows of a quoted or list-nested table — where the markdown cannot be
 * lifted out of its container and re-rendered on its own — out of this entirely.
 */
function adoOnlyTableAt(
  lines: readonly string[],
  index: number,
): Extract<RenderableBlock, { kind: "table" }> | null {
  const header = lines[index] ?? "";
  if (!/^ {0,3}\|/.test(header)) return null;
  if (!isTableRow(header) || !isTableDelimiterRow(lines[index + 1] ?? "")) return null;

  let end = index + 1;
  while (end + 1 < lines.length && isTableRow(lines[end + 1]) && lines[end + 1].trim().length > 0) {
    end++;
  }

  const gluedAbove = index > 0 && (lines[index - 1] ?? "").trim().length > 0;
  const gluedBelow = (lines[end + 1] ?? "").trim().length > 0;
  if (!gluedAbove && !gluedBelow) return null;

  return {
    kind: "table",
    startLine: index,
    endLine: end,
    markdown: lines.slice(index, end + 1).join("\n"),
  };
}

/** Headings of a document, in order — the freshest possible input for `[[_TOC_]]`. */
export function headingsInMarkdown(lines: readonly string[]): DocHeading[] {
  const headings: DocHeading[] = [];
  const context = new MarkdownContext(lines);

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!context.accepts(line, index)) continue;

    const match = HEADING.exec(line);
    if (!match) continue;
    const text = (match[2] ?? "")
      .trim()
      // ATX headings may be closed: '## Title ##'.
      .replace(/\s+#+\s*$/, "")
      .trim();
    if (text.length === 0) continue;
    headings.push({ text, level: match[1].length, line: index });
  }

  return headings;
}

/** An image link that is the entire content of a line, or null. */
function soleImageOf(line: string): { href: string; alt: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("![")) return null;

  const links = findMarkdownLinks(trimmed);
  const only = links.length === 1 ? links[0] : null;
  if (!only || !only.isImage || only.start !== 0 || only.end !== trimmed.length) return null;
  return { href: only.href, alt: only.text };
}
