import { describe, expect, it } from "vitest";
import {
  findColonBlocks,
  findTableRanges,
  isColonBlockStart,
  isTableDelimiterRow,
  normalizeAdoParagraph,
  parseColonBlockAt,
} from "../src/links/adoBlocks";

describe("::: blocks", () => {
  const doc = [
    "# Page",
    "",
    "::: mermaid",
    "graph LR",
    "    A[Obsidian] --> B[ADO]",
    ":::",
    "",
    "::: video https://example.com/v.mp4 :::",
    "",
    "::: query-table",
    "6ff7777e-8ca5-4f04-a7f6-9e63737dddf7",
    ":::",
  ].join("\n");

  it("recognises an opening fence but not a bare or closing one", () => {
    expect(isColonBlockStart("::: mermaid")).toBe(true);
    expect(isColonBlockStart("  ::: video https://x")).toBe(true);
    expect(isColonBlockStart(":::")).toBe(false);
    expect(isColonBlockStart("text ::: mermaid")).toBe(false);
  });

  it("parses the fenced form and keeps its content verbatim", () => {
    const lines = doc.split("\n");
    const block = parseColonBlockAt(lines, 2);
    expect(block).toMatchObject({
      kind: "mermaid",
      keyword: "mermaid",
      content: "graph LR\n    A[Obsidian] --> B[ADO]",
      startLine: 2,
      endLine: 5,
      closed: true,
    });
  });

  it("parses the one-line form", () => {
    expect(parseColonBlockAt(["::: video https://example.com/v.mp4 :::"], 0)).toMatchObject({
      kind: "video",
      content: "https://example.com/v.mp4",
      startLine: 0,
      endLine: 0,
      closed: true,
    });
  });

  it("finds every block in a document without nesting them", () => {
    expect(findColonBlocks(doc).map((b) => [b.kind, b.startLine, b.endLine])).toEqual([
      ["mermaid", 2, 5],
      ["video", 7, 7],
      ["query-table", 9, 11],
    ]);
  });

  it("labels an unknown keyword as 'other' and reports an unterminated block", () => {
    const block = parseColonBlockAt(["::: fancy", "content"], 0);
    expect(block).toMatchObject({ kind: "other", keyword: "fancy", closed: false, endLine: 1 });
  });

  it("returns null where no block starts", () => {
    expect(parseColonBlockAt(["plain text"], 0)).toBeNull();
    expect(parseColonBlockAt([":::"], 0)).toBeNull();
  });
});

describe("table repair (ADO renders these, Obsidian needs blank lines)", () => {
  it("recognises delimiter rows, and not a horizontal rule or setext underline", () => {
    expect(isTableDelimiterRow("| --- | --- |")).toBe(true);
    expect(isTableDelimiterRow("--- | :---: | ---:")).toBe(true);
    expect(isTableDelimiterRow("---")).toBe(false);
    expect(isTableDelimiterRow("| not a delimiter |")).toBe(false);
  });

  it("finds the table inside a paragraph", () => {
    const lines = [
      "The page is delivered with one record.",
      "| Identification type | Description | Scheme |",
      "| --- | --- | --- |",
      "| GLN | Global Location Number | 0088 |",
      "Everything else is created by the user.",
    ];
    expect(findTableRanges(lines)).toEqual([{ start: 1, end: 3 }]);
  });

  it("inserts the blank lines a table needs, above and below", () => {
    const raw = [
      "The page is delivered with one record.",
      "| Type | Scheme |",
      "| --- | --- |",
      "| GLN | 0088 |",
      "The last row matters.",
    ].join("\n");

    expect(normalizeAdoParagraph(raw)).toBe(
      [
        "The page is delivered with one record.",
        "",
        "| Type | Scheme |",
        "| --- | --- |",
        "| GLN | 0088 |",
        "",
        "The last row matters.",
      ].join("\n"),
    );
  });

  it("handles two tables in one paragraph (the production case)", () => {
    const raw = [
      "First table:",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "Second table:",
      "| C | D |",
      "| --- | --- |",
      "| 3 | 4 |",
    ].join("\n");

    expect(normalizeAdoParagraph(raw)).toBe(
      [
        "First table:",
        "",
        "| A | B |",
        "| --- | --- |",
        "| 1 | 2 |",
        "",
        "Second table:",
        "",
        "| C | D |",
        "| --- | --- |",
        "| 3 | 4 |",
      ].join("\n"),
    );
  });

  it("leaves alone anything that already renders correctly", () => {
    expect(normalizeAdoParagraph("Just a paragraph with a | pipe in it.")).toBeNull();
    expect(normalizeAdoParagraph("| A | B |\n| --- | --- |\n| 1 | 2 |")).toBeNull();
    expect(normalizeAdoParagraph("Text\n\n| A | B |\n| --- | --- |")).toBeNull();
  });
});
