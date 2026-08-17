import { describe, expect, it } from "vitest";
import {
  addCommentUrl,
  commentsFrom,
  commentsUrl,
  isCommentsConfigured,
  pageIdFrom,
  pageLookupUrl,
  wikiPathForLookup,
  WIKI_API_VERSION,
  WIKI_COMMENTS_API_VERSION,
} from "../src/comments/wikiComments";

const connection = {
  organizationUrl: "https://dev.azure.com/contoso/",
  project: "MyProject",
  wikiName: "MyProject.wiki",
  pat: "token",
};

describe("wiki comment URLs", () => {
  it("builds the page lookup, tolerating a trailing slash on the organization", () => {
    expect(pageLookupUrl(connection, "/Sample Pages/Getting Started")).toBe(
      "https://dev.azure.com/contoso/MyProject/_apis/wiki/wikis/" +
        "MyProject.wiki/pages" +
        "?path=%2FSample%20Pages%2FGetting%20Started&api-version=7.1",
    );
  });

  it("percent-encodes the separators too, because the path is a query value", () => {
    // An ADO page title legitimately contains ? & # %, and a bare slash would ask for the
    // wrong page entirely. This is the difference between finding /A/B and asking for A.
    const url = pageLookupUrl(connection, "/Sample Pages/2. FAQ?");

    expect(url).toContain("path=%2FSample%20Pages%2F2.%20FAQ%3F");
    expect(url).not.toContain("FAQ?&");
  });

  it("uses the preview api-version for comments and the GA one for the page lookup", () => {
    // Mixing these up is a 400 whose message is about the version, not the request.
    expect(pageLookupUrl(connection, "/A")).toContain(`api-version=${WIKI_API_VERSION}`);
    expect(commentsUrl(connection, 12)).toContain(`api-version=${WIKI_COMMENTS_API_VERSION}`);
    expect(addCommentUrl(connection, 12)).toContain(`api-version=${WIKI_COMMENTS_API_VERSION}`);
    expect(WIKI_API_VERSION).not.toBe(WIKI_COMMENTS_API_VERSION);
  });

  it("points both comment routes at the page id", () => {
    expect(commentsUrl(connection, 42)).toContain("/pages/42/comments?");
    expect(addCommentUrl(connection, 42)).toContain("/pages/42/comments?");
  });

  it("knows when it cannot ask at all", () => {
    expect(isCommentsConfigured(connection)).toBe(true);
    expect(isCommentsConfigured({ ...connection, pat: "" })).toBe(false);
    expect(isCommentsConfigured({ ...connection, wikiName: "  " })).toBe(false);
    expect(isCommentsConfigured({ ...connection, project: "" })).toBe(false);
  });
});

describe("wikiPathForLookup", () => {
  it("makes a root-absolute path out of a decoded title path", () => {
    expect(wikiPathForLookup("Sample Pages/Getting Started")).toBe("/Sample Pages/Getting Started");
    expect(wikiPathForLookup("/Already/Absolute")).toBe("/Already/Absolute");
    expect(wikiPathForLookup("Home")).toBe("/Home");
  });
});

describe("parsing responses", () => {
  it("reads the page id, and says null for anything else", () => {
    expect(pageIdFrom({ id: 7, path: "/Home" })).toBe(7);
    expect(pageIdFrom({ path: "/Home" })).toBeNull();
    expect(pageIdFrom(null)).toBeNull();
    expect(pageIdFrom("not json")).toBeNull();
  });

  it("reads comments oldest first, with the author's display name", () => {
    const comments = commentsFrom({
      comments: [
        {
          id: 2,
          text: "second",
          createdDate: "2026-08-12T10:00:00Z",
          createdBy: { displayName: "Alex Green" },
        },
        {
          id: 1,
          text: "first",
          createdDate: "2026-08-11T10:00:00Z",
          createdBy: { displayName: "Sam Blue" },
        },
      ],
    });

    expect(comments.map((c) => c.text)).toEqual(["first", "second"]);
    expect(comments[0].author).toBe("Sam Blue");
    expect(comments[1].parentId).toBeNull();
  });

  it("falls back to uniqueName, and survives a missing author entirely", () => {
    const comments = commentsFrom({
      comments: [
        { id: 1, text: "a", createdBy: { uniqueName: "someone@example.com" } },
        { id: 2, text: "b" },
      ],
    });

    expect(comments.map((c) => c.author)).toEqual(["someone@example.com", ""]);
  });

  it("drops deleted comments even though excludeDeleted was asked for", () => {
    // Some server versions still return the tombstone.
    const comments = commentsFrom({
      comments: [
        { id: 1, text: "kept" },
        { id: 2, text: "gone", isDeleted: true },
      ],
    });

    expect(comments.map((c) => c.id)).toEqual([1]);
  });

  it("keeps a reply's parent so the pane can indent it", () => {
    const comments = commentsFrom({ comments: [{ id: 3, text: "re:", parentId: 1 }] });
    expect(comments[0].parentId).toBe(1);
  });

  it("never throws on a shape this preview API did not promise", () => {
    expect(commentsFrom(null)).toEqual([]);
    expect(commentsFrom({})).toEqual([]);
    expect(commentsFrom({ comments: "nope" })).toEqual([]);
    expect(commentsFrom({ comments: [null, 7, { text: "no id" }] })).toEqual([]);
    expect(commentsFrom({ comments: [{ id: 1, text: 42 }] })[0].text).toBe("");
  });
});
