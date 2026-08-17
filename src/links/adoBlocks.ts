/**
 * Azure DevOps block syntax, and the two places ADO's markdown parser is more forgiving than
 * Obsidian's (FR-4.3, FR-4.6, and the table case reported from a production page).
 *
 * Two jobs, both on raw markdown lines:
 *
 * 1. `::: mermaid` / `::: video` / `::: query-table` fenced blocks. Obsidian renders them as
 *    a paragraph of literal text, so a renderer needs to know where each block starts and ends
 *    and what is inside it.
 * 2. **Pipe tables with no blank line in front of them.** ADO renders a table that starts on
 *    the line straight after a paragraph; Obsidian (CommonMark + GFM) needs a blank line first,
 *    so the whole thing degrades into text soup. `normalizeAdoParagraph` reinstates the blank
 *    lines *for rendering only* — the file on disk is never touched.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */

export type ColonBlockKind = "mermaid" | "video" | "query-table" | "other";

export interface ColonBlock {
  kind: ColonBlockKind;
  /** The keyword as written, e.g. 'query-table'. */
  keyword: string;
  /** Everything between the fences (video URL, mermaid source, query GUID …). */
  content: string;
  /** Index of the opening ':::' line, relative to the lines passed in. */
  startLine: number;
  /** Index of the closing ':::' line — equal to startLine for the single-line form. */
  endLine: number;
  /** False when the block runs off the end of the document without a closing ':::'. */
  closed: boolean;
}

const KNOWN_KINDS: ReadonlySet<string> = new Set(["mermaid", "video", "query-table"]);
/** ':::' plus an optional keyword and arguments, e.g. '::: video https://…' or '::: mermaid'. */
const COLON_OPEN = /^ {0,3}:::\s*([A-Za-z][\w-]*)?[ \t]*(.*)$/;
const COLON_CLOSE = /^ {0,3}:::\s*$/;

/** Is this line the start of a ':::' block? */
export function isColonBlockStart(line: string): boolean {
  const match = COLON_OPEN.exec(line);
  return match !== null && match[1] !== undefined;
}

/**
 * Parse the ':::' block that starts at `startLine`, or null when no block starts there.
 *
 * Supports both shapes ADO accepts: the fenced form, and the one-liner
 * `::: video https://… :::`.
 */
export function parseColonBlockAt(lines: readonly string[], startLine: number): ColonBlock | null {
  const open = COLON_OPEN.exec(lines[startLine] ?? "");
  if (!open || open[1] === undefined) return null;

  const keyword = open[1];
  const kind: ColonBlockKind = KNOWN_KINDS.has(keyword.toLowerCase())
    ? (keyword.toLowerCase() as ColonBlockKind)
    : "other";
  const inlineRest = open[2].trim();

  if (inlineRest.endsWith(":::")) {
    return {
      kind,
      keyword,
      content: inlineRest.slice(0, -3).trim(),
      startLine,
      endLine: startLine,
      closed: true,
    };
  }

  const body: string[] = inlineRest.length > 0 ? [inlineRest] : [];
  for (let line = startLine + 1; line < lines.length; line++) {
    if (COLON_CLOSE.test(lines[line])) {
      return { kind, keyword, content: body.join("\n"), startLine, endLine: line, closed: true };
    }
    body.push(lines[line]);
  }
  return {
    kind,
    keyword,
    content: body.join("\n"),
    startLine,
    endLine: lines.length - 1,
    closed: false,
  };
}

/** Every ':::' block in a document, in order. Blocks never nest, so this is a single pass. */
export function findColonBlocks(text: string): ColonBlock[] {
  const lines = text.split("\n");
  const blocks: ColonBlock[] = [];
  for (let line = 0; line < lines.length; line++) {
    const block = parseColonBlockAt(lines, line);
    if (!block) continue;
    blocks.push(block);
    line = block.endLine;
  }
  return blocks;
}

// --------------------------------------------------------------------- tables

/**
 * '| --- | :--: |' — the row that turns the line above it into a table header.
 *
 * A pipe is required, which is also what GFM demands: it keeps a setext underline ('---')
 * and a horizontal rule from being mistaken for a one-column table.
 */
export function isTableDelimiterRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|") || !trimmed.includes("-")) return false;
  const cells = splitTableRow(trimmed);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell.trim()));
}

/** A line that could be a table row: it has at least one cell separator. */
export function isTableRow(line: string): boolean {
  return line.includes("|");
}

/**
 * Cells of a pipe-table row. Escaped pipes (`\|`) stay inside their cell, and the empty cells
 * an outer `|` produces are dropped, so `| a | b |` and `a | b` both yield two cells.
 */
function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") {
      cell += "\\|";
      i++;
    } else if (ch === "|") {
      cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell);

  if (cells.length > 1 && cells[0].trim().length === 0) cells.shift();
  if (cells.length > 1 && cells[cells.length - 1].trim().length === 0) cells.pop();
  return cells;
}

export interface TableRange {
  /** Index of the header row. */
  start: number;
  /** Index of the last body row. */
  end: number;
}

/** Pipe tables inside a run of lines, found by header-plus-delimiter pairs. */
export function findTableRanges(lines: readonly string[]): TableRange[] {
  const ranges: TableRange[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!isTableRow(lines[i]) || !isTableDelimiterRow(lines[i + 1])) continue;

    let end = i + 1;
    while (end + 1 < lines.length && isTableRow(lines[end + 1]) && lines[end + 1].trim().length > 0) {
      end++;
    }
    ranges.push({ start: i, end });
    i = end;
  }
  return ranges;
}

/**
 * Reinstate the blank lines a pipe table needs, so a paragraph ADO renders as
 * `text + table` renders the same way in Obsidian.
 *
 * @returns the markdown to render instead, or null when the paragraph is already fine
 *          (no table in it, or the table already starts the paragraph and ends it).
 */
export function normalizeAdoParagraph(raw: string): string | null {
  const lines = raw.split("\n");
  const tables = findTableRanges(lines);
  if (tables.length === 0) return null;

  const out: string[] = [];
  let cursor = 0;
  let changed = false;

  for (const table of tables) {
    const before = lines.slice(cursor, table.start);
    if (before.length > 0) {
      out.push(...before);
      // A table needs a blank line between it and the text above.
      if (before[before.length - 1].trim().length > 0) {
        out.push("");
        changed = true;
      }
    }
    out.push(...lines.slice(table.start, table.end + 1));
    cursor = table.end + 1;

    const nextLine = lines[cursor];
    if (nextLine !== undefined && nextLine.trim().length > 0) {
      out.push("");
      changed = true;
    }
  }
  out.push(...lines.slice(cursor));

  return changed ? out.join("\n") : null;
}
