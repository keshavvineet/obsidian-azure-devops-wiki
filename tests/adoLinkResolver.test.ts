import { describe, expect, it } from "vitest";
import {
  attachmentVaultPath,
  findMarkdownLinkAt,
  findMarkdownLinks,
  isAttachmentHref,
  isExternalHref,
  pageCandidates,
  parseHref,
  resolveHref,
  type PageLookup,
} from "../src/links/adoLinkResolver";

/** The pages of the fixture vault, as the index would report them. */
const PAGES = [
  "Home.md",
  "Pre%2DRelease-RCA-Categories.md",
  "Product-Documentation.md",
  "Product-Documentation/4.-Design-%2D-Connectors.md",
  "Product-Documentation/4.-Design-%2D-Connectors/Overview.md",
  "Product-Documentation/Feature-Break-Down-&-User-Stories-(MVP).md",
  "Release Notes 2026.md",
];

const lookup: PageLookup = {
  forWikiPath(wikiPath) {
    const exact = PAGES.find((path) => `/${path}` === `${wikiPath}.md`);
    const insensitive = PAGES.find(
      (path) => `/${path}`.toLowerCase() === `${wikiPath}.md`.toLowerCase(),
    );
    const found = exact ?? insensitive;
    return found ? { file: { path: found } } : null;
  },
};

const from = (fromFolder: string) => ({ fromFolder, lookup });

describe("parseHref", () => {
  it("splits the fragment off", () => {
    expect(parseHref("/A/B#seed-data")).toEqual({ path: "/A/B", anchor: "seed-data" });
    expect(parseHref("/A/B")).toEqual({ path: "/A/B", anchor: null });
    expect(parseHref("#seed-data")).toEqual({ path: "", anchor: "seed-data" });
    expect(parseHref("/A/B#")).toEqual({ path: "/A/B", anchor: null });
  });

  it("unwraps the angle-bracket form used for destinations containing spaces", () => {
    expect(parseHref("</A B/C>")).toEqual({ path: "/A B/C", anchor: null });
  });
});

describe("isExternalHref / isAttachmentHref", () => {
  it("recognises schemes and protocol-relative URLs", () => {
    expect(isExternalHref("https://dev.azure.com")).toBe(true);
    expect(isExternalHref("mailto:someone@example.com")).toBe(true);
    expect(isExternalHref("//cdn.example.com/x.png")).toBe(true);
    expect(isExternalHref("/Parent/Child")).toBe(false);
    expect(isExternalHref("Child.md")).toBe(false);
    // A Windows drive letter is not a scheme we should hand to the browser.
    expect(isExternalHref("C:/wiki/page.md")).toBe(true);
  });

  it("recognises attachments in both stored forms", () => {
    expect(isAttachmentHref("/.attachments/image-1.png")).toBe(true);
    expect(isAttachmentHref(".attachments/image-1.png")).toBe(true);
    expect(isAttachmentHref("/.attachments/==image_0==-2026884b.png")).toBe(true);
    expect(isAttachmentHref("/Parent/Child")).toBe(false);
  });

  it("strips the leading slash to a vault-relative path", () => {
    expect(attachmentVaultPath("/.attachments/image-1.png")).toBe(".attachments/image-1.png");
    expect(attachmentVaultPath("/.attachments/my%20shot.png")).toBe(".attachments/my shot.png");
  });
});

describe("pageCandidates", () => {
  it("keeps the raw percent-escapes of a file name, then tries the decoded form", () => {
    expect(pageCandidates("/Pre%2DRelease-RCA-Categories", "")).toEqual([
      "/Pre%2DRelease-RCA-Categories",
      "/Pre-Release-RCA-Categories",
    ]);
  });

  it("resolves relative links against the linking page's folder", () => {
    expect(pageCandidates("Overview.md", "Product-Documentation/4.-Design-%2D-Connectors")).toEqual(
      ["/Product-Documentation/4.-Design-%2D-Connectors/Overview"],
    );
    expect(pageCandidates("./Sibling.md", "Product-Documentation")).toEqual([
      "/Product-Documentation/Sibling",
    ]);
    expect(pageCandidates("../Aunt.md", "Product-Documentation/Child")).toEqual([
      "/Product-Documentation/Aunt",
    ]);
  });

  it("drops a trailing .md and refuses to climb above the wiki root", () => {
    expect(pageCandidates("/Product-Documentation.md", "")).toEqual(["/Product-Documentation"]);
    expect(pageCandidates("../../Escape.md", "Product-Documentation")).toEqual([]);
  });
});

describe("resolveHref", () => {
  it("resolves a root-absolute page link", () => {
    expect(resolveHref("/Pre%2DRelease-RCA-Categories", from(""))).toEqual({
      kind: "page",
      vaultPath: "Pre%2DRelease-RCA-Categories.md",
      anchor: null,
    });
  });

  it("keeps the anchor with the page", () => {
    expect(resolveHref("/Product-Documentation#seed-data", from("Home"))).toEqual({
      kind: "page",
      vaultPath: "Product-Documentation.md",
      anchor: "seed-data",
    });
  });

  it("resolves a nested page and a relative sibling", () => {
    expect(
      resolveHref("/Product-Documentation/4.-Design-%2D-Connectors", from("")),
    ).toMatchObject({ kind: "page", vaultPath: "Product-Documentation/4.-Design-%2D-Connectors.md" });
    expect(
      resolveHref("Overview.md", from("Product-Documentation/4.-Design-%2D-Connectors")),
    ).toMatchObject({
      kind: "page",
      vaultPath: "Product-Documentation/4.-Design-%2D-Connectors/Overview.md",
    });
  });

  it("falls back to a case-insensitive match", () => {
    expect(resolveHref("/product-documentation", from(""))).toMatchObject({
      kind: "page",
      vaultPath: "Product-Documentation.md",
    });
  });

  it("resolves a link whose spaces were percent-encoded by another tool", () => {
    expect(resolveHref("/Release%20Notes%202026", from(""))).toMatchObject({
      kind: "page",
      vaultPath: "Release Notes 2026.md",
    });
  });

  it("classifies attachments, anchors and external links", () => {
    expect(resolveHref("/.attachments/sample.png", from("Product-Documentation"))).toEqual({
      kind: "attachment",
      vaultPath: ".attachments/sample.png",
    });
    expect(resolveHref("#seed-data", from(""))).toEqual({ kind: "anchor", anchor: "seed-data" });
    expect(resolveHref("https://dev.azure.com", from(""))).toEqual({
      kind: "external",
      href: "https://dev.azure.com",
    });
  });

  it("reports a wiki-shaped target that does not exist as missing", () => {
    expect(resolveHref("/Nope/Not-Here#x", from(""))).toEqual({
      kind: "missing",
      target: "/Nope/Not-Here",
      anchor: "x",
    });
    expect(resolveHref("", from(""))).toMatchObject({ kind: "missing" });
  });
});

describe("findMarkdownLinks", () => {
  const text =
    'See [Design](/Product-Documentation/4.-Design-%2D-Connectors "Connectors") and ' +
    "![sample.png](/.attachments/sample.png) plus [ext](<https://a b/c>).";

  it("finds links and images with their destinations", () => {
    const links = findMarkdownLinks(text);
    expect(links.map((l) => l.href)).toEqual([
      "/Product-Documentation/4.-Design-%2D-Connectors",
      "/.attachments/sample.png",
      "https://a b/c",
    ]);
    expect(links.map((l) => l.isImage)).toEqual([false, true, false]);
    expect(links[0].text).toBe("Design");
  });

  it("points at the destination's own offsets", () => {
    const link = findMarkdownLinks(text)[0];
    expect(text.slice(link.hrefStart, link.hrefEnd)).toBe(
      "/Product-Documentation/4.-Design-%2D-Connectors",
    );
  });

  it("finds the link a click landed in, and nothing outside one", () => {
    const link = findMarkdownLinkAt(text, text.indexOf("Design") + 2);
    expect(link?.href).toBe("/Product-Documentation/4.-Design-%2D-Connectors");
    expect(findMarkdownLinkAt(text, 1)).toBeNull();
  });
});
