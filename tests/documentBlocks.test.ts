import { describe, expect, it } from "vitest";
import { findRenderableBlocks, headingsInMarkdown } from "../src/links/documentBlocks";

const lines = (text: string): string[] => text.split("\n");

describe("findRenderableBlocks", () => {
  it("finds a fenced ::: mermaid block and its body", () => {
    const blocks = findRenderableBlocks(
      lines(["Intro", "", "::: mermaid", "graph TD;", "A-->B;", ":::", "", "After"].join("\n")),
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "colon", startLine: 2, endLine: 5 });
    expect(blocks[0].kind === "colon" && blocks[0].block.content).toBe("graph TD;\nA-->B;");
  });

  it("finds the one-line ::: video form", () => {
    const blocks = findRenderableBlocks(lines("::: video https://example.com/v :::"));
    expect(blocks[0]).toMatchObject({ kind: "colon", startLine: 0, endLine: 0 });
    expect(blocks[0].kind === "colon" && blocks[0].block.kind).toBe("video");
  });

  it("ignores an unterminated ::: block", () => {
    expect(findRenderableBlocks(lines("::: mermaid\ngraph TD;"))).toEqual([]);
  });

  it("never looks inside a fenced code block", () => {
    const blocks = findRenderableBlocks(
      lines(["```", "::: mermaid", ":::", "[[_TOC_]]", "```", "[[_TOC_]]"].join("\n")),
    );
    expect(blocks).toEqual([
      { kind: "macro", startLine: 5, endLine: 5, name: "TOC", ignored: false },
    ]);
  });

  it("never looks inside frontmatter", () => {
    const blocks = findRenderableBlocks(
      lines(["---", "title: [[_TOC_]]", "---", "[[_TOSP_]]"].join("\n")),
    );
    expect(blocks).toEqual([
      { kind: "macro", startLine: 3, endLine: 3, name: "TOSP", ignored: false },
    ]);
  });

  it("marks every table of contents after the first as ignored", () => {
    const blocks = findRenderableBlocks(lines("[[_TOC_]]\n\ntext\n\n[[_TOC_]]"));
    expect(blocks.map((b) => b.kind === "macro" && b.ignored)).toEqual([false, true]);
  });

  it("is case-sensitive, as Azure DevOps is", () => {
    expect(findRenderableBlocks(lines("[[_toc_]]"))).toEqual([]);
  });

  it("takes a macro only when it is the whole line", () => {
    expect(findRenderableBlocks(lines("See [[_TOC_]] below"))).toEqual([]);
    expect(findRenderableBlocks(lines("   [[_TOC_]]   "))).toHaveLength(1);
  });

  it("finds an image that is alone on its line", () => {
    const blocks = findRenderableBlocks(lines("![shot.png](/.attachments/shot-1.png)"));
    expect(blocks[0]).toEqual({
      kind: "image",
      startLine: 0,
      endLine: 0,
      href: "/.attachments/shot-1.png",
      alt: "shot.png",
    });
  });

  it("leaves an image with text around it to the inline pass", () => {
    expect(findRenderableBlocks(lines("see ![a](/.attachments/a.png) here"))).toEqual([]);
    expect(findRenderableBlocks(lines("![a](/x.png)![b](/y.png)"))).toEqual([]);
  });

  it("keeps an ==name==-style attachment stem intact", () => {
    const blocks = findRenderableBlocks(
      lines("![==image_0==-abc.png](/.attachments/==image_0==-abc.png)"),
    );
    expect(blocks[0].kind === "image" && blocks[0].href).toBe("/.attachments/==image_0==-abc.png");
  });

  // The reported case (screenshot, round 3 note 7): ADO starts a table on the line straight
  // after a paragraph, and Obsidian's live preview shows the rows as text.
  describe("tables Obsidian renders differently from Azure DevOps", () => {
    it("takes a table glued to the paragraph above it", () => {
      const blocks = findRenderableBlocks(
        lines(
          [
            "Every one of these needs the same change.",
            "| Location | What changes |",
            "| --- | --- |",
            "| EDI party setup | GLN becomes Unique identifier. |",
            "",
            "After.",
          ].join("\n"),
        ),
      );

      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({ kind: "table", startLine: 1, endLine: 3 });
      expect(blocks[0].kind === "table" && blocks[0].markdown).toBe(
        ["| Location | What changes |", "| --- | --- |", "| EDI party setup | GLN becomes Unique identifier. |"].join("\n"),
      );
    });

    it("takes a table whose last row is followed straight by text", () => {
      const blocks = findRenderableBlocks(
        lines(["", "| a | b |", "| --- | --- |", "| 1 | 2 |", "Text right after."].join("\n")),
      );
      expect(blocks[0]).toMatchObject({ kind: "table", startLine: 1, endLine: 3 });
    });

    it("leaves a properly separated table to Obsidian", () => {
      expect(
        findRenderableBlocks(lines(["Intro", "", "| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n"))),
      ).toEqual([]);
    });

    it("leaves the first table of a page alone when nothing is above it", () => {
      expect(findRenderableBlocks(lines(["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n")))).toEqual(
        [],
      );
    });

    it("needs a delimiter row — a paragraph with pipes is not a table", () => {
      expect(findRenderableBlocks(lines("Text\n| just | pipes |\n| more | pipes |"))).toEqual([]);
    });

    it("never looks inside a code fence", () => {
      expect(
        findRenderableBlocks(lines(["```", "Text", "| a | b |", "| --- | --- |", "```"].join("\n"))),
      ).toEqual([]);
    });

    it("ignores a quoted or list-nested table, whose rows cannot be lifted out", () => {
      expect(
        findRenderableBlocks(lines(["Text", "> | a | b |", "> | --- | --- |"].join("\n"))),
      ).toEqual([]);
      expect(
        findRenderableBlocks(lines(["Text", "- | a | b |", "  | --- | --- |"].join("\n"))),
      ).toEqual([]);
    });

    it("does not mistake a setext underline for a one-column table", () => {
      expect(findRenderableBlocks(lines("Text\n| Heading |\n| ------- |\nmore text"))).toHaveLength(1);
      expect(findRenderableBlocks(lines("Text\nHeading\n-------\nmore text"))).toEqual([]);
    });

    it("finds every glued table on a page, and the macros between them", () => {
      const blocks = findRenderableBlocks(
        lines(
          [
            "One",
            "| a | b |",
            "| - | - |",
            "| 1 | 2 |",
            "",
            "[[_TOC_]]",
            "",
            "Two",
            "| c | d |",
            "| - | - |",
            "| 3 | 4 |",
          ].join("\n"),
        ),
      );
      expect(blocks.map((block) => block.kind)).toEqual(["table", "macro", "table"]);
    });
  });
});

describe("headingsInMarkdown", () => {
  it("reads level and text in document order", () => {
    expect(headingsInMarkdown(lines("# One\ntext\n### Three\n## Two"))).toEqual([
      { text: "One", level: 1, line: 0 },
      { text: "Three", level: 3, line: 2 },
      { text: "Two", level: 2, line: 3 },
    ]);
  });

  it("skips headings inside code fences and frontmatter", () => {
    const text = ["---", "# not a heading", "---", "```", "# nor this", "```", "# real"].join("\n");
    expect(headingsInMarkdown(lines(text))).toEqual([{ text: "real", level: 1, line: 6 }]);
  });

  it("trims a closed ATX heading", () => {
    expect(headingsInMarkdown(lines("## Title ##"))[0].text).toBe("Title");
  });

  it("ignores a bare hash and a hash with no space", () => {
    expect(headingsInMarkdown(lines("#\n#tag\n#123"))).toEqual([]);
  });

  it("keeps the inline markdown a heading contains", () => {
    expect(headingsInMarkdown(lines("## **Bold** and `code`"))[0].text).toBe("**Bold** and `code`");
  });
});
