import { describe, expect, it } from "vitest";
import {
  applyBulletList,
  applyHeading,
  applyNumberedList,
  applyQuote,
  applyTaskList,
  codeBlockEdit,
  type EditorLike,
  type EditorPosition,
  horizontalRule,
  insertCodeBlock,
  padBlock,
  insertHorizontalRule,
  insertLink,
  insertMathBlock,
  insertMermaidBlock,
  insertTable,
  insertToc,
  linkEdit,
  markdownTable,
  mathBlockEdit,
  mermaidBlockEdit,
  setHeadingLevel,
  toggleBold,
  toggleBulletList,
  toggleInlineCode,
  toggleInlineWrap,
  toggleItalic,
  toggleNumberedList,
  toggleQuote,
  toggleStrikethrough,
  toggleTaskList,
} from "../src/toolbar/formatActions";

describe("toggleInlineWrap", () => {
  it("wraps a selection", () => {
    expect(toggleInlineWrap("hello", "**")).toEqual({
      text: "**hello**",
      selectionStart: 2,
      selectionEnd: 7,
    });
  });

  it("unwraps an already-wrapped selection", () => {
    expect(toggleInlineWrap("**hello**", "**")).toEqual({
      text: "hello",
      selectionStart: 0,
      selectionEnd: 5,
    });
  });

  it("inserts an empty pair with the cursor between them when nothing is selected", () => {
    expect(toggleInlineWrap("", "*")).toEqual({ text: "**", selectionStart: 1, selectionEnd: 1 });
  });

  it("wraps rather than unwraps text too short to be a marker pair", () => {
    // A single '*' is shorter than two markers, so it cannot be "already wrapped".
    expect(toggleInlineWrap("*", "*")).toEqual({ text: "***", selectionStart: 1, selectionEnd: 2 });
  });
});

describe("codeBlockEdit", () => {
  it("wraps a selection in a fence", () => {
    const edit = codeBlockEdit("const x = 1;");
    expect(edit.text).toBe("```\nconst x = 1;\n```");
  });

  it("leaves the cursor on the blank line for an empty selection", () => {
    const edit = codeBlockEdit("");
    expect(edit.text).toBe("```\n\n```");
    expect(edit.selectionStart).toBe(edit.selectionEnd);
    expect(edit.text.slice(0, edit.selectionStart)).toBe("```\n");
  });
});

describe("linkEdit", () => {
  it("keeps the label and selects the url placeholder", () => {
    const edit = linkEdit("my page");
    expect(edit.text).toBe("[my page](url)");
    expect(edit.text.slice(edit.selectionStart, edit.selectionEnd)).toBe("url");
  });

  it("uses a placeholder label when nothing is selected", () => {
    const edit = linkEdit("");
    expect(edit.text).toBe("[link text](url)");
  });
});

describe("line-prefix toggles", () => {
  it("bullets every non-blank line and leaves blanks alone", () => {
    expect(toggleBulletList(["one", "", "two"])).toEqual(["- one", "", "- two"]);
  });

  it("un-bullets when every content line is already bulleted", () => {
    expect(toggleBulletList(["- one", "- two"])).toEqual(["one", "two"]);
  });

  it("numbers from 1 regardless of any existing numbering", () => {
    expect(toggleNumberedList(["5. one", "9. two"])).toEqual(["one", "two"]);
    expect(toggleNumberedList(["one", "two"])).toEqual(["1. one", "2. two"]);
  });

  it("does not treat a numbered line as already-numbered when only some lines are", () => {
    expect(toggleNumberedList(["1. one", "two"])).toEqual(["1. 1. one", "2. two"]);
  });

  it("adds and removes task checkboxes", () => {
    expect(toggleTaskList(["one", "two"])).toEqual(["- [ ] one", "- [ ] two"]);
    expect(toggleTaskList(["- [ ] one", "- [x] two"])).toEqual(["one", "two"]);
  });

  it("quotes and un-quotes", () => {
    expect(toggleQuote(["one", "two"])).toEqual(["> one", "> two"]);
    expect(toggleQuote(["> one", "> two"])).toEqual(["one", "two"]);
  });
});

describe("setHeadingLevel", () => {
  it("sets a heading on a plain line", () => {
    expect(setHeadingLevel("Title", 2)).toBe("## Title");
  });

  it("changes an existing heading's level", () => {
    expect(setHeadingLevel("## Title", 1)).toBe("# Title");
  });

  it("clears the heading when the same level is applied again (toggle)", () => {
    expect(setHeadingLevel("## Title", 2)).toBe("Title");
  });

  it("clears a heading when level 0 is applied", () => {
    expect(setHeadingLevel("### Title", 0)).toBe("Title");
  });
});

describe("static inserts", () => {
  it("builds a 3x3 table by default (header + divider + 2 body rows)", () => {
    const table = markdownTable();
    const rows = table.split("\n");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toBe("| Column 1 | Column 2 | Column 3 |");
    expect(rows[1]).toBe("| --- | --- | --- |");
    expect(rows[2]).toBe("|   |   |   |");
    expect(rows[3]).toBe(rows[2]);
  });

  it("wraps a mermaid block with the cursor after the graph-type line", () => {
    const edit = mermaidBlockEdit();
    expect(edit.text).toBe("```mermaid\ngraph TD\n\n```");
    expect(edit.text.slice(0, edit.selectionStart)).toBe("```mermaid\ngraph TD\n");
  });

  it("wraps a math block with the cursor on the blank line", () => {
    const edit = mathBlockEdit();
    expect(edit.text).toBe("$$\n\n$$");
    expect(edit.text.slice(0, edit.selectionStart)).toBe("$$\n");
  });

  it("is just the rule — the blank lines around it come from the surroundings", () => {
    // Baking "\n\n---\n\n" in meant pressing the button twice left four blank lines behind, and
    // it could not tell a mid-paragraph cursor from one on an already-blank line. `padBlock` can.
    expect(horizontalRule()).toBe("---");
  });
});

// ---------------------------------------------------------------- adapter (fake editor)

/** A minimal in-memory `EditorLike` — enough to exercise the `apply*` adapters end to end. */
class FakeEditor implements EditorLike {
  lines: string[];
  private anchor: EditorPosition;
  private head: EditorPosition;

  constructor(text: string, selection: { anchor: EditorPosition; head: EditorPosition }) {
    this.lines = text.split("\n");
    this.anchor = selection.anchor;
    this.head = selection.head;
  }

  private get from(): EditorPosition {
    return comparePositions(this.anchor, this.head) <= 0 ? this.anchor : this.head;
  }

  private get to(): EditorPosition {
    return comparePositions(this.anchor, this.head) <= 0 ? this.head : this.anchor;
  }

  getSelection(): string {
    const { from, to } = this;
    if (from.line === to.line) return this.lines[from.line].slice(from.ch, to.ch);
    const parts = [this.lines[from.line].slice(from.ch)];
    for (let line = from.line + 1; line < to.line; line++) parts.push(this.lines[line]);
    parts.push(this.lines[to.line].slice(0, to.ch));
    return parts.join("\n");
  }

  replaceSelection(text: string): void {
    this.replaceRange(text, this.from, this.to);
  }

  replaceRange(text: string, from: EditorPosition, to: EditorPosition = from): void {
    const before = this.lines[from.line].slice(0, from.ch);
    const after = this.lines[to.line].slice(to.ch);
    const inserted = text.split("\n");
    inserted[0] = before + inserted[0];
    inserted[inserted.length - 1] += after;
    this.lines.splice(from.line, to.line - from.line + 1, ...inserted);
    this.anchor = this.head = from;
  }

  getCursor(loc: "from" | "to" | "head" | "anchor" = "head"): EditorPosition {
    if (loc === "anchor") return this.anchor;
    if (loc === "head") return this.head;
    return loc === "from" ? this.from : this.to;
  }

  setSelection(anchor: EditorPosition, head: EditorPosition = anchor): void {
    this.anchor = anchor;
    this.head = head;
  }

  getLine(line: number): string {
    return this.lines[line];
  }

  get text(): string {
    return this.lines.join("\n");
  }
}

function comparePositions(a: EditorPosition, b: EditorPosition): number {
  return a.line !== b.line ? a.line - b.line : a.ch - b.ch;
}

function pos(line: number, ch: number): EditorPosition {
  return { line, ch };
}

describe("adapters over an editor", () => {
  it("toggleBold wraps the selection and re-selects the inner text", () => {
    const editor = new FakeEditor("hello world", { anchor: pos(0, 0), head: pos(0, 5) });
    toggleBold(editor);
    expect(editor.text).toBe("**hello** world");
    expect(editor.getCursor("from")).toEqual(pos(0, 2));
    expect(editor.getCursor("to")).toEqual(pos(0, 7));
  });

  it("toggleItalic and toggleStrikethrough and toggleInlineCode use their own markers", () => {
    const italic = new FakeEditor("x", { anchor: pos(0, 0), head: pos(0, 1) });
    toggleItalic(italic);
    expect(italic.text).toBe("*x*");

    const strike = new FakeEditor("x", { anchor: pos(0, 0), head: pos(0, 1) });
    toggleStrikethrough(strike);
    expect(strike.text).toBe("~~x~~");

    const code = new FakeEditor("x", { anchor: pos(0, 0), head: pos(0, 1) });
    toggleInlineCode(code);
    expect(code.text).toBe("`x`");
  });

  it("applyBulletList transforms every line the selection touches", () => {
    const editor = new FakeEditor("one\ntwo\nthree", { anchor: pos(0, 0), head: pos(2, 5) });
    applyBulletList(editor);
    expect(editor.text).toBe("- one\n- two\n- three");
  });

  it("applyNumberedList and applyTaskList and applyQuote work the same way", () => {
    const numbered = new FakeEditor("one\ntwo", { anchor: pos(0, 0), head: pos(1, 3) });
    applyNumberedList(numbered);
    expect(numbered.text).toBe("1. one\n2. two");

    const tasks = new FakeEditor("one\ntwo", { anchor: pos(0, 0), head: pos(1, 3) });
    applyTaskList(tasks);
    expect(tasks.text).toBe("- [ ] one\n- [ ] two");

    const quoted = new FakeEditor("one\ntwo", { anchor: pos(0, 0), head: pos(1, 3) });
    applyQuote(quoted);
    expect(quoted.text).toBe("> one\n> two");
  });

  it("applyHeading sets the level on every selected line", () => {
    const editor = new FakeEditor("one\ntwo", { anchor: pos(0, 0), head: pos(1, 3) });
    applyHeading(editor, 2);
    expect(editor.text).toBe("## one\n## two");
  });

  it("insertLink replaces the selection and selects the url placeholder", () => {
    const editor = new FakeEditor("Home", { anchor: pos(0, 0), head: pos(0, 4) });
    insertLink(editor);
    expect(editor.text).toBe("[Home](url)");
    expect(editor.text.slice(editor.getCursor("from").ch, editor.getCursor("to").ch)).toBe("url");
  });

  it("insertCodeBlock, insertMermaidBlock, insertMathBlock, insertToc, insertHorizontalRule, insertTable all insert at the cursor", () => {
    const code = new FakeEditor("", { anchor: pos(0, 0), head: pos(0, 0) });
    insertCodeBlock(code);
    expect(code.text).toBe("```\n\n```");

    const mermaid = new FakeEditor("", { anchor: pos(0, 0), head: pos(0, 0) });
    insertMermaidBlock(mermaid);
    // A fence, not ADO's `:::` — see mermaidBlockEdit.
    expect(mermaid.text).toBe("```mermaid\ngraph TD\n\n```");

    const math = new FakeEditor("", { anchor: pos(0, 0), head: pos(0, 0) });
    insertMathBlock(math);
    expect(math.text).toBe("$$\n\n$$");

    const toc = new FakeEditor("", { anchor: pos(0, 0), head: pos(0, 0) });
    insertToc(toc);
    expect(toc.text).toBe("[[_TOC_]]");

    const hr = new FakeEditor("", { anchor: pos(0, 0), head: pos(0, 0) });
    insertHorizontalRule(hr);
    // On an empty document nothing needs separating, so no blank lines are added: the padding is
    // now computed from the surroundings rather than baked into the string.
    expect(hr.text).toBe("---");

    const table = new FakeEditor("", { anchor: pos(0, 0), head: pos(0, 0) });
    insertTable(table);
    expect(table.text.split("\n")).toHaveLength(4);
  });
});

describe("padBlock — whole-line constructs (SYNTAX-MAPPING §3 rows 3-4)", () => {
  const around = (over: Partial<Parameters<typeof padBlock>[1]> = {}) => ({
    linePrefix: "",
    lineSuffix: "",
    lineAbove: null,
    lineBelow: null,
    ...over,
  });

  it("breaks out of a paragraph the cursor is inside", () => {
    // The defect this fixes: a table glued under text renders as literal rows in Obsidian, which
    // is exactly what the table-needs-blank-line rule reports. The toolbar was creating findings.
    const edit = padBlock("| a |", around({ linePrefix: "Some text" }));

    expect(edit.text).toBe("\n\n| a |");
    expect(edit.text.slice(edit.selectionStart, edit.selectionEnd)).toBe("| a |");
  });

  it("adds one newline on an empty line directly under text", () => {
    const edit = padBlock("| a |", around({ lineAbove: "Some text" }));
    expect(edit.text).toBe("\n| a |");
  });

  it("adds nothing when the line is already blank and separated", () => {
    // Pressing the button repeatedly must not push the page apart.
    expect(padBlock("| a |", around({ lineAbove: "" })).text).toBe("| a |");
    expect(padBlock("| a |", around()).text).toBe("| a |");
  });

  it("separates from what follows as well", () => {
    expect(padBlock("[[_TOC_]]", around({ lineSuffix: "trailing" })).text).toBe(
      "[[_TOC_]]\n\ntrailing".slice(0, "[[_TOC_]]\n\n".length),
    );
    expect(padBlock("[[_TOC_]]", around({ lineBelow: "Next paragraph" })).text).toBe(
      "[[_TOC_]]\n",
    );
    expect(padBlock("[[_TOC_]]", around({ lineBelow: "" })).text).toBe("[[_TOC_]]");
  });

  it("keeps the caller's selection offsets pointing at the same characters", () => {
    const edit = padBlock("$$\n\n$$", around({ linePrefix: "text", lineSuffix: "more" }));
    expect(edit.text.slice(edit.selectionStart, edit.selectionEnd)).toBe("$$\n\n$$");
  });
});

describe("mermaidBlockEdit", () => {
  it("inserts a fenced block, not ADO's ::: form", () => {
    // ADO renders both, but only the fence renders in stock Obsidian and everywhere else, so a
    // diagram this plugin writes survives the plugin being switched off (SYNTAX-MAPPING §3 row 5).
    const edit = mermaidBlockEdit();

    expect(edit.text.startsWith("```mermaid\n")).toBe(true);
    expect(edit.text.endsWith("\n```")).toBe(true);
    expect(edit.text).not.toContain(":::");
    // `graph`, not `flowchart` — flowchart is outside the subset ADO supports.
    expect(edit.text).toContain("graph TD");
    // The cursor lands on the blank line, ready for the diagram body.
    expect(edit.text.slice(0, edit.selectionStart).endsWith("graph TD\n")).toBe(true);
  });
});
