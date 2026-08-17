import { describe, expect, it } from "vitest";
import {
  buildRenameReplacements,
  findCodeRanges,
  rewriteLinkTargets,
} from "../src/links/linkTargets";

const RENAME = [{ from: "/Product-Documentation", to: "/Product-Docs" }];

describe("rewriteLinkTargets", () => {
  it("rewrites an exact wiki-path destination", () => {
    const result = rewriteLinkTargets("See [docs](/Product-Documentation).", RENAME);
    expect(result.content).toBe("See [docs](/Product-Docs).");
    expect(result.count).toBe(1);
  });

  it("rewrites subpage paths when a parent page is renamed", () => {
    const result = rewriteLinkTargets(
      "[c](/Product-Documentation/4.-Design-%2D-Connectors)",
      RENAME,
    );
    expect(result.content).toBe("[c](/Product-Docs/4.-Design-%2D-Connectors)");
  });

  it("preserves anchors", () => {
    expect(rewriteLinkTargets("[s](/Product-Documentation#setup)", RENAME).content).toBe(
      "[s](/Product-Docs#setup)",
    );
  });

  it("preserves link titles and angle-bracket destinations", () => {
    expect(
      rewriteLinkTargets('[d](/Product-Documentation "The docs")', RENAME).content,
    ).toBe('[d](/Product-Docs "The docs")');
    expect(rewriteLinkTargets("[d](</Product-Documentation>)", RENAME).content).toBe(
      "[d](</Product-Docs>)",
    );
  });

  it("rewrites image links too", () => {
    expect(rewriteLinkTargets("![alt](/Product-Documentation)", RENAME).content).toBe(
      "![alt](/Product-Docs)",
    );
  });

  it("does not touch paths that merely share a prefix", () => {
    const content = "[x](/Product-Documentation-Archive) [y](/Product-DocumentationX)";
    expect(rewriteLinkTargets(content, RENAME).content).toBe(content);
    expect(rewriteLinkTargets(content, RENAME).count).toBe(0);
  });

  it("leaves unrelated links alone", () => {
    const content = "[a](/Scrum) [b](https://example.com) [c](#anchor)";
    expect(rewriteLinkTargets(content, RENAME).content).toBe(content);
  });

  it("rewrites several links in one pass", () => {
    const result = rewriteLinkTargets(
      "[a](/Product-Documentation) and [b](/Product-Documentation/Sub)",
      RENAME,
    );
    expect(result.count).toBe(2);
  });

  it("returns the input unchanged when there is nothing to replace", () => {
    const content = "[a](/Product-Documentation)";
    expect(rewriteLinkTargets(content, []).content).toBe(content);
  });
});

describe("rewriteLinkTargets — code safety", () => {
  it("ignores links inside fenced code blocks", () => {
    const content = [
      "Real [link](/Product-Documentation)",
      "```md",
      "Sample [link](/Product-Documentation)",
      "```",
    ].join("\n");
    const result = rewriteLinkTargets(content, RENAME);
    expect(result.count).toBe(1);
    expect(result.content).toContain("Sample [link](/Product-Documentation)");
    expect(result.content).toContain("Real [link](/Product-Docs)");
  });

  it("ignores links inside tilde fences and indented fences", () => {
    const content = "~~~\n[x](/Product-Documentation)\n~~~\n  ```\n[y](/Product-Documentation)\n  ```";
    expect(rewriteLinkTargets(content, RENAME).count).toBe(0);
  });

  it("ignores links inside inline code", () => {
    const content = "Use `[link](/Product-Documentation)` like this.";
    expect(rewriteLinkTargets(content, RENAME).count).toBe(0);
  });

  it("still rewrites a link that follows an inline code span", () => {
    const content = "`code` then [real](/Product-Documentation)";
    expect(rewriteLinkTargets(content, RENAME).count).toBe(1);
  });

  it("treats an unterminated fence as code to the end of the file", () => {
    const content = "text\n```\n[x](/Product-Documentation)";
    expect(rewriteLinkTargets(content, RENAME).count).toBe(0);
  });
});

describe("findCodeRanges", () => {
  it("finds fenced blocks and inline spans, sorted by position", () => {
    const ranges = findCodeRanges("a `b` c\n```\nfenced\n```\n`d`");
    expect(ranges.length).toBe(3);
    expect(ranges).toEqual([...ranges].sort((x, y) => x[0] - y[0]));
  });

  it("does not report backticks inside a fenced block as separate spans", () => {
    const ranges = findCodeRanges("```\n`inner`\n```");
    expect(ranges).toHaveLength(1);
  });
});

describe("buildRenameReplacements", () => {
  it("covers the wiki path by default", () => {
    expect(buildRenameReplacements("/Old", "/New")).toEqual([{ from: "/Old", to: "/New" }]);
  });

  it("adds relative forms when file names are supplied", () => {
    const replacements = buildRenameReplacements("/Old", "/New", {
      oldFileName: "Old.md",
      newFileName: "New.md",
    });
    expect(replacements).toEqual([
      { from: "/Old", to: "/New" },
      { from: "Old.md", to: "New.md" },
      { from: "./Old.md", to: "./New.md" },
    ]);
  });
});
