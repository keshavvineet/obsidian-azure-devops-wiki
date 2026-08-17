/**
 * Toolbar/command formatting primitives (FR-5.1, FR-5.4).
 *
 * Split in two halves on purpose:
 *  - pure string transforms (testable without an editor at all) that decide *what* the new
 *    text should be and where the selection should land inside it;
 *  - thin `apply*` adapters that read the minimum an editor can tell us (`EditorLike`, the
 *    structural shape of Obsidian's real `Editor` — no import needed) and replay the pure
 *    result onto it.
 *
 * PURE-ish: the top half never touches an editor; the bottom half only calls the handful of
 * methods every CodeMirror-backed editor already exposes.
 */

export interface EditorPosition {
  line: number;
  ch: number;
}

/** The slice of Obsidian's `Editor` these actions need — satisfied structurally, no import. */
export interface EditorLike {
  getSelection(): string;
  replaceSelection(text: string): void;
  replaceRange(text: string, from: EditorPosition, to?: EditorPosition): void;
  getCursor(loc?: "from" | "to" | "head" | "anchor"): EditorPosition;
  setSelection(anchor: EditorPosition, head?: EditorPosition): void;
  getLine(line: number): string;
}

// -------------------------------------------------------------------- pure: inline wrapping

export interface TextEdit {
  /** Replacement text for the current selection. */
  text: string;
  /** Offsets into `text` the new selection should span. */
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Toggle a symmetric marker around the selection (bold `**`, italic `*`, strikethrough `~~`,
 * inline code `` ` ``). Applying it twice is the undo: selecting already-wrapped text unwraps.
 */
export function toggleInlineWrap(text: string, marker: string): TextEdit {
  if (text.length === 0) {
    return { text: marker + marker, selectionStart: marker.length, selectionEnd: marker.length };
  }
  if (
    text.length >= marker.length * 2 &&
    text.startsWith(marker) &&
    text.endsWith(marker)
  ) {
    const inner = text.slice(marker.length, text.length - marker.length);
    return { text: inner, selectionStart: 0, selectionEnd: inner.length };
  }
  return {
    text: marker + text + marker,
    selectionStart: marker.length,
    selectionEnd: marker.length + text.length,
  };
}

/** A fenced code block — one line for an empty selection, wrapped otherwise. */
export function codeBlockEdit(text: string, lang = ""): TextEdit {
  if (text.length === 0) {
    const out = `\`\`\`${lang}\n\n\`\`\``;
    const cursor = `\`\`\`${lang}\n`.length;
    return { text: out, selectionStart: cursor, selectionEnd: cursor };
  }
  const out = `\`\`\`${lang}\n${text}\n\`\`\``;
  return { text: out, selectionStart: 0, selectionEnd: out.length };
}

/** `[label](url)` with `url` selected, ready to type over — the common case for a fresh link. */
export function linkEdit(text: string): TextEdit {
  const label = text.length > 0 ? text : "link text";
  const out = `[${label}](url)`;
  const start = out.length - "url)".length;
  return { text: out, selectionStart: start, selectionEnd: start + "url".length };
}

/** `![alt](target)` for an attachment already saved under `.attachments`. */
export function imageMarkdown(alt: string, target: string): string {
  return `![${alt}](${target})`;
}

// ---------------------------------------------------------------------- pure: line transforms

const BULLET = /^(\s*)-\s(?!\[[ xX]\]\s)/;
const NUMBERED = /^(\s*)\d+\.\s/;
const TASK = /^(\s*)-\s\[[ xX]\]\s/;
const QUOTE = /^(\s*)>\s?/;
const HEADING = /^(#{1,6})\s+/;

/** Lines a multi-line selection spans, skipping the transform on lines that are blank. */
function eachContentLine(lines: readonly string[], transform: (line: string) => string): string[] {
  return lines.map((line) => (line.trim().length === 0 ? line : transform(line)));
}

/** Toggle `- ` on every non-blank line; strips it instead when every such line already has it. */
export function toggleBulletList(lines: readonly string[]): string[] {
  const content = lines.filter((line) => line.trim().length > 0);
  const allBulleted = content.length > 0 && content.every((line) => BULLET.test(line));
  return eachContentLine(lines, (line) =>
    allBulleted ? line.replace(BULLET, "$1") : `- ${line}`,
  );
}

/** Toggle `1. `, `2. `, … — renumbered from 1 regardless of what was there before. */
export function toggleNumberedList(lines: readonly string[]): string[] {
  const content = lines.filter((line) => line.trim().length > 0);
  const allNumbered = content.length > 0 && content.every((line) => NUMBERED.test(line));
  let n = 0;
  return lines.map((line) => {
    if (line.trim().length === 0) return line;
    if (allNumbered) return line.replace(NUMBERED, "$1");
    n++;
    return `${n}. ${line}`;
  });
}

/** Toggle `- [ ] ` — an existing checked box is preserved rather than reset to unchecked. */
export function toggleTaskList(lines: readonly string[]): string[] {
  const content = lines.filter((line) => line.trim().length > 0);
  const allTasks = content.length > 0 && content.every((line) => TASK.test(line));
  return eachContentLine(lines, (line) =>
    allTasks ? line.replace(TASK, "$1") : `- [ ] ${line.replace(BULLET, "")}`,
  );
}

/** Toggle a `> ` blockquote prefix. */
export function toggleQuote(lines: readonly string[]): string[] {
  const content = lines.filter((line) => line.trim().length > 0);
  const allQuoted = content.length > 0 && content.every((line) => QUOTE.test(line));
  return eachContentLine(lines, (line) =>
    allQuoted ? line.replace(QUOTE, "$1") : `> ${line}`,
  );
}

/**
 * Set (or clear, at `level` 0) the heading level of a single line. Applying the level already
 * in effect clears it — the toolbar's header dropdown is a toggle, not a one-way stamp.
 */
export function setHeadingLevel(line: string, level: number): string {
  const match = HEADING.exec(line);
  const text = match ? line.slice(match[0].length) : line;
  if (level <= 0 || match?.[1].length === level) return text;
  return `${"#".repeat(level)} ${text}`;
}

// --------------------------------------------------------------------- pure: static inserts

/** The rule itself; the blank lines around it are added by `insertBlock` from the surroundings. */
export function horizontalRule(): string {
  return "---";
}

export function tocMarkdown(): string {
  return "[[_TOC_]]";
}

export function tospMarkdown(): string {
  return "[[_TOSP_]]";
}

/** A 3×3 grid by default (FR-5.1): one header row plus two body rows, three columns. */
export function markdownTable(rows = 3, cols = 3): string {
  const header = `| ${Array.from({ length: cols }, (_, i) => `Column ${i + 1}`).join(" | ")} |`;
  const divider = `| ${Array(cols).fill("---").join(" | ")} |`;
  const bodyRow = `| ${Array(cols).fill(" ").join(" | ")} |`;
  const body = Array.from({ length: Math.max(0, rows - 1) }, () => bodyRow);
  return [header, divider, ...body].join("\n");
}

/**
 * Mermaid block, cursor left on the blank line ready for the diagram body.
 *
 * A **fenced** block, not ADO's `::: mermaid`: Azure DevOps renders both (ADO-WIKI-FORMAT §4.1),
 * but only the fence renders in stock Obsidian, in every other markdown tool, and on GitHub. So a
 * diagram this plugin inserts stays readable if the plugin is ever switched off — while `:::`
 * blocks that already exist in the wiki keep being rendered for compatibility. SYNTAX-MAPPING §3.
 *
 * `graph`, not `flowchart`: `flowchart` is not in the subset Azure DevOps supports.
 */
export function mermaidBlockEdit(): TextEdit {
  const prefix = `${CODE_FENCE}mermaid\ngraph TD\n`;
  const out = `${prefix}\n${CODE_FENCE}`;
  return { text: out, selectionStart: prefix.length, selectionEnd: prefix.length };
}

/** Named so the fence can appear inside template literals without escaping gymnastics. */
const CODE_FENCE = "```";

// ------------------------------------------------------- pure: whole-line block placement

/** What the editor can see around the insertion point, for {@link padBlock}. */
export interface BlockSurroundings {
  /** Text on the cursor's line before the insertion point. */
  linePrefix: string;
  /** Text on the cursor's line after it. */
  lineSuffix: string;
  /** The line above, or null at the top of the document. */
  lineAbove: string | null;
  /** The line below, or null at the end of the document. */
  lineBelow: string | null;
}

/**
 * Surround a whole-line construct with the blank lines it needs (SYNTAX-MAPPING §3 rows 3–4).
 *
 * A table, a `[[_TOC_]]`, a mermaid block or a `$$` block only renders when it starts its own
 * line, and a table additionally needs a blank line above it or Obsidian shows the rows as text —
 * which is the very defect the `table-needs-blank-line` linter rule exists to report. Inserting
 * one of these at the end of a paragraph was producing exactly that, so the toolbar was creating
 * work for the linter.
 *
 * Only what is missing is added: pressing the button on an already-blank line between blank lines
 * inserts no newlines at all, so repeated use does not push the page apart.
 */
export function padBlock(text: string, around: BlockSurroundings): TextEdit {
  const lead =
    around.linePrefix.trim().length > 0
      ? "\n\n"
      : around.lineAbove !== null && around.lineAbove.trim().length > 0
        ? "\n"
        : "";
  const trail =
    around.lineSuffix.trim().length > 0
      ? "\n\n"
      : around.lineBelow !== null && around.lineBelow.trim().length > 0
        ? "\n"
        : "";

  return {
    text: `${lead}${text}${trail}`,
    selectionStart: lead.length,
    selectionEnd: lead.length + text.length,
  };
}

/** KaTeX display-math block, cursor on the blank line between the `$$` fences. */
export function mathBlockEdit(): TextEdit {
  const out = "$$\n\n$$";
  return { text: out, selectionStart: 3, selectionEnd: 3 };
}

// ------------------------------------------------------------------------------- adapters

/** Where `text` (as just inserted at `from`) leaves the cursor, accounting for newlines. */
function advance(from: EditorPosition, text: string): EditorPosition {
  const parts = text.split("\n");
  if (parts.length === 1) return { line: from.line, ch: from.ch + text.length };
  return { line: from.line + parts.length - 1, ch: parts[parts.length - 1].length };
}

function applyEdit(editor: EditorLike, edit: TextEdit): void {
  const from = editor.getCursor("from");
  editor.replaceSelection(edit.text);
  editor.setSelection(
    advance(from, edit.text.slice(0, edit.selectionStart)),
    advance(from, edit.text.slice(0, edit.selectionEnd)),
  );
}

function applyLineTransform(editor: EditorLike, transform: (lines: readonly string[]) => string[]): void {
  const from = editor.getCursor("from");
  const to = editor.getCursor("to");
  const startLine = Math.min(from.line, to.line);
  const endLine = Math.max(from.line, to.line);

  const lines: string[] = [];
  for (let line = startLine; line <= endLine; line++) lines.push(editor.getLine(line));

  const replaced = transform(lines);
  editor.replaceRange(
    replaced.join("\n"),
    { line: startLine, ch: 0 },
    { line: endLine, ch: editor.getLine(endLine).length },
  );
}

export function toggleBold(editor: EditorLike): void {
  applyEdit(editor, toggleInlineWrap(editor.getSelection(), "**"));
}

export function toggleItalic(editor: EditorLike): void {
  applyEdit(editor, toggleInlineWrap(editor.getSelection(), "*"));
}

export function toggleStrikethrough(editor: EditorLike): void {
  applyEdit(editor, toggleInlineWrap(editor.getSelection(), "~~"));
}

export function toggleInlineCode(editor: EditorLike): void {
  applyEdit(editor, toggleInlineWrap(editor.getSelection(), "`"));
}

export function insertCodeBlock(editor: EditorLike): void {
  applyEdit(editor, codeBlockEdit(editor.getSelection()));
}

export function insertLink(editor: EditorLike): void {
  applyEdit(editor, linkEdit(editor.getSelection()));
}

export function insertMermaidBlock(editor: EditorLike): void {
  insertBlock(editor, mermaidBlockEdit());
}

export function insertMathBlock(editor: EditorLike): void {
  insertBlock(editor, mathBlockEdit());
}

export function insertHorizontalRule(editor: EditorLike): void {
  const rule = horizontalRule();
  insertBlock(editor, { text: rule, selectionStart: rule.length, selectionEnd: rule.length });
}

export function insertToc(editor: EditorLike): void {
  insertBlock(editor, blockOf(tocMarkdown()));
}

export function insertTosp(editor: EditorLike): void {
  insertBlock(editor, blockOf(tospMarkdown()));
}

export function insertTable(editor: EditorLike, rows = 3, cols = 3): void {
  insertBlock(editor, blockOf(markdownTable(rows, cols)));
}

function blockOf(text: string): TextEdit {
  return { text, selectionStart: 0, selectionEnd: text.length };
}

/**
 * Insert a whole-line construct, adding only the blank lines it is missing.
 *
 * Without this, pressing Table at the end of a paragraph produced a table glued to the text above
 * it — which Obsidian renders as literal rows and which the `table-needs-blank-line` rule then
 * reports. The toolbar was manufacturing lint findings (SYNTAX-MAPPING §3 rows 3–4).
 */
function insertBlock(editor: EditorLike, edit: TextEdit): void {
  const cursor = editor.getCursor("from");
  const line = editor.getLine(cursor.line) ?? "";
  const padded = padBlock(edit.text, {
    linePrefix: line.slice(0, cursor.ch),
    lineSuffix: line.slice(cursor.ch),
    lineAbove: cursor.line > 0 ? (editor.getLine(cursor.line - 1) ?? null) : null,
    lineBelow: editor.getLine(cursor.line + 1) ?? null,
  });
  // The caller's own selection offsets are relative to its text, so shift them by the padding.
  const lead = padded.text.indexOf(edit.text);
  applyEdit(editor, {
    text: padded.text,
    selectionStart: lead + edit.selectionStart,
    selectionEnd: lead + edit.selectionEnd,
  });
}

export function applyBulletList(editor: EditorLike): void {
  applyLineTransform(editor, toggleBulletList);
}

export function applyNumberedList(editor: EditorLike): void {
  applyLineTransform(editor, toggleNumberedList);
}

export function applyTaskList(editor: EditorLike): void {
  applyLineTransform(editor, toggleTaskList);
}

export function applyQuote(editor: EditorLike): void {
  applyLineTransform(editor, toggleQuote);
}

export function applyHeading(editor: EditorLike, level: number): void {
  applyLineTransform(editor, (lines) => lines.map((line) => setHeadingLevel(line, level)));
}
