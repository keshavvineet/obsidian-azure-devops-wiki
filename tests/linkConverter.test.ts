import { describe, expect, it } from "vitest";
import {
  convertWikilink,
  convertWikilinks,
  findWikilinks,
  isAdoMacro,
  wikilinkEndingAt,
  type ConverterHost,
} from "../src/links/linkConverter";

/** Two pages and one attachment, keyed the way the index resolves them. */
const host: ConverterHost = {
  resolvePage(target) {
    const pages: Record<string, { wikiPath: string; title: string }> = {
      "Some Page": { wikiPath: "/Some-Page", title: "Some Page" },
      "Some-Page": { wikiPath: "/Some-Page", title: "Some Page" },
      "Product-Documentation/Overview": {
        wikiPath: "/Product-Documentation/Overview",
        title: "Overview",
      },
      "Pre-Release RCA Categories": {
        wikiPath: "/Pre%2DRelease-RCA-Categories",
        title: "Pre-Release RCA Categories",
      },
    };
    return pages[target] ?? null;
  },
  resolveAttachment(target) {
    return target === "sample.png" ? { linkTarget: "/.attachments/sample.png" } : null;
  },
};

describe("findWikilinks", () => {
  it("parses targets, headings, block refs, aliases and embeds", () => {
    const links = findWikilinks(
      "[[Some Page]] [[Some Page#Heading]] [[Some Page#^abc123]] [[Some Page|Alias]] ![[sample.png]]",
    );
    expect(links.map((l) => [l.target, l.heading, l.blockRef, l.alias, l.isEmbed])).toEqual([
      ["Some Page", null, null, null, false],
      ["Some Page", "Heading", null, null, false],
      ["Some Page", null, "abc123", null, false],
      ["Some Page", null, null, "Alias", false],
      ["sample.png", null, null, null, true],
    ]);
  });

  it("ignores wikilinks inside code", () => {
    expect(findWikilinks("`[[Not a link]]`")).toEqual([]);
    expect(findWikilinks("```\n[[Not a link]]\n```")).toEqual([]);
    expect(findWikilinks("text `[[a]]` [[Some Page]]").map((l) => l.target)).toEqual(["Some Page"]);
  });

  it("finds the wikilink that ends at the cursor", () => {
    const line = "See [[Some Page]]";
    expect(wikilinkEndingAt(line, line.length)?.target).toBe("Some Page");
    expect(wikilinkEndingAt(line, line.length - 1)).toBeNull();
  });
});

describe("convertWikilink", () => {
  const convert = (raw: string): string | { skip: string } | null => {
    const [link] = findWikilinks(raw);
    const result = convertWikilink(link, host);
    if (result === null) return null;
    return "skip" in result ? { skip: result.skip } : result.text;
  };

  it("writes the ADO link form (FR-3.4)", () => {
    expect(convert("[[Some Page]]")).toBe("[Some Page](/Some-Page)");
  });

  it("uses the alias as the link text", () => {
    expect(convert("[[Some Page|Read this]]")).toBe("[Read this](/Some-Page)");
  });

  it("converts a heading link through the ADO anchor algorithm", () => {
    expect(convert("[[Some Page#Team #1 : Release Wiki!]]")).toBe(
      "[Some Page › Team #1 : Release Wiki!](/Some-Page#team-1--release-wiki)",
    );
  });

  it("keeps the encoded path of a page whose title has a hyphen", () => {
    expect(convert("[[Pre-Release RCA Categories]]")).toBe(
      "[Pre-Release RCA Categories](/Pre%2DRelease-RCA-Categories)",
    );
  });

  it("resolves a path target as written by Obsidian's autocomplete", () => {
    expect(convert("[[Product-Documentation/Overview]]")).toBe(
      "[Overview](/Product-Documentation/Overview)",
    );
  });

  it("links to a heading in the same page", () => {
    expect(convert("[[#Seed data]]")).toBe("[Seed data](#seed-data)");
  });

  it("converts an attachment embed", () => {
    expect(convert("![[sample.png]]")).toBe("![sample.png](/.attachments/sample.png)");
  });

  it("never touches ADO's own macros", () => {
    expect(convert("[[_TOC_]]")).toBeNull();
    expect(convert("[[_TOSP_]]")).toBeNull();
    expect(isAdoMacro("_TOC_")).toBe(true);
    expect(isAdoMacro("TOC")).toBe(false);
  });

  it("leaves what it cannot resolve, with a reason", () => {
    expect(convert("[[No Such Page]]")).toEqual({ skip: "unresolved-page" });
    expect(convert("![[Some Page]]")).toEqual({ skip: "note-embed" });
    expect(convert("![[elsewhere/photo.png]]")).toEqual({ skip: "unresolved-attachment" });
  });
});

describe("convertWikilinks", () => {
  it("converts a document and reports what it left behind", () => {
    const content = [
      "# Page",
      "",
      "Links: [[Some Page]], [[No Such Page]] and [[Some Page#^abc]].",
      "",
      "```",
      "[[Some Page]]",
      "```",
      "",
      "[[_TOC_]]",
    ].join("\n");

    const result = convertWikilinks(content, host);

    expect(result.count).toBe(2);
    expect(result.droppedBlockRefs).toBe(1);
    expect(result.skipped.map((s) => s.reason)).toEqual(["unresolved-page"]);
    expect(result.content).toContain(
      "Links: [Some Page](/Some-Page), [[No Such Page]] and [Some Page](/Some-Page).",
    );
    // Untouched: code block and ADO macro.
    expect(result.content).toContain("```\n[[Some Page]]\n```");
    expect(result.content).toContain("[[_TOC_]]");
  });

  it("returns the content unchanged when there is nothing to convert", () => {
    const content = "Plain [link](/Some-Page) only.";
    const result = convertWikilinks(content, host);
    expect(result).toMatchObject({ content, count: 0, droppedBlockRefs: 0 });
    expect(result.skipped).toEqual([]);
  });
});
