import { describe, expect, it } from "vitest";
import { nonPortableSegments, portableName } from "../src/naming/portableName";

/**
 * The check behind PLAN note 12 — a page Azure DevOps refuses to open because its file name is
 * not the wiki's own encoding. The confirmed real case is `7.4 New Test Page.md`, found in the
 * reference clone with literal spaces in the name.
 */
describe("portableName", () => {
  it("accepts a name Azure DevOps itself would have written", () => {
    expect(portableName("Pre%2DRelease-RCA-Categories.md", "page")).toBeNull();
    expect(portableName("Product-Documentation", "folder")).toBeNull();
    expect(portableName("7.2-Generate-EDI-Party-Setup-from-EDI-group.md", "page")).toBeNull();
  });

  it("names the encoded form of a page created with literal spaces", () => {
    expect(portableName("7.4 New Test Page.md", "page")).toBe("7.4-New-Test-Page.md");
  });

  it("names the encoded form of a title with characters Azure DevOps escapes", () => {
    // The `-` in the name on disk already means a space, so the round trip keeps it as one and
    // only the raw ':' and '?' have to be escaped.
    expect(portableName("Pre-Release: Q&A?.md", "page")).toBe("Pre-Release%3A-Q&A%3F.md");
  });

  it("keeps the .md extension off a folder name", () => {
    expect(portableName("New Folder", "folder")).toBe("New-Folder");
  });

  it("leaves an empty name alone rather than inventing one", () => {
    expect(portableName("", "page")).toBeNull();
    expect(portableName(".md", "page")).toBeNull();
  });

  it("accepts the characters Azure DevOps stores literally", () => {
    // '& ( ) .' and unicode punctuation are not escaped (ADO-WIKI-FORMAT §2).
    expect(portableName("Costs-&-Benefits-(2026).md", "page")).toBeNull();
    expect(portableName("What’s-new.md", "page")).toBeNull();
  });
});

describe("nonPortableSegments", () => {
  it("reports nothing for a path Azure DevOps can load", () => {
    expect(nonPortableSegments("Product-Documentation/A.-Studio/Page.md")).toEqual([]);
  });

  it("reports the page's own name", () => {
    expect(nonPortableSegments("Product-Documentation/7.4 New Test Page.md")).toEqual([
      {
        name: "7.4 New Test Page.md",
        suggestion: "7.4-New-Test-Page.md",
        kind: "page",
        isPage: true,
        path: "Product-Documentation/7.4 New Test Page.md",
      },
    ]);
  });

  it("reports an ancestor folder, which is what ADO's message also blames", () => {
    const problems = nonPortableSegments("My Folder/Sub/Page.md");
    expect(problems).toEqual([
      {
        name: "My Folder",
        suggestion: "My-Folder",
        kind: "folder",
        isPage: false,
        path: "My Folder",
      },
    ]);
  });

  it("carries each segment's own path, so the folder's owning page can be found", () => {
    // The repair for a bad folder is renaming `${path}.md` — the page that owns it — never the
    // page that merely sits underneath it.
    expect(nonPortableSegments("My Folder/Another One/A Page.md").map((p) => p.path)).toEqual([
      "My Folder",
      "My Folder/Another One",
      "My Folder/Another One/A Page.md",
    ]);
  });

  it("reports every offending segment of a path", () => {
    expect(nonPortableSegments("My Folder/Another One/A Page.md").map((p) => p.suggestion)).toEqual([
      "My-Folder",
      "Another-One",
      "A-Page.md",
    ]);
  });
});
