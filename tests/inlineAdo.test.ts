import { describe, expect, it } from "vitest";
import {
  escapedIds,
  findInlineTokens,
  mentionLabel,
  pullRequestUrl,
  workItemUrl,
} from "../src/links/inlineAdo";
import {
  attachmentFileName,
  attachmentMarkdown,
  splitFileName,
  uniqueAttachmentName,
} from "../src/links/attachmentNames";

describe("findInlineTokens", () => {
  it("finds work items, pull requests and mentions", () => {
    const text = "Fixed #234825 in !4711 — thanks @<3b0a2131-0000-4000-8000-000000000000>.";
    expect(findInlineTokens(text).map((t) => [t.kind, t.id])).toEqual([
      ["workItem", "234825"],
      ["pullRequest", "4711"],
      ["mention", "3b0a2131-0000-4000-8000-000000000000"],
    ]);
  });

  it("reports the exact offsets of the token", () => {
    const text = "see #123 now";
    const [token] = findInlineTokens(text);
    expect(text.slice(token.start, token.end)).toBe("#123");
  });

  it("marks an escaped reference instead of dropping it", () => {
    const [token] = findInlineTokens("literal \\#123 stays put");
    expect(token).toMatchObject({ kind: "workItem", id: "123", escaped: true });
    expect(escapedIds("literal \\#123 stays put")).toEqual(new Set(["workItem:123"]));
  });

  it("ignores a hash that is part of a word, a fragment or an escape", () => {
    expect(findInlineTokens("page#123")).toEqual([]);
    expect(findInlineTokens("https://example.com/x#42")).toEqual([]);
    expect(findInlineTokens("Wow!123")).toEqual([]);
    expect(findInlineTokens("%23123")).toEqual([]);
  });

  it("accepts a reference after punctuation or at the start of the text", () => {
    expect(findInlineTokens("#1").map((t) => t.id)).toEqual(["1"]);
    expect(findInlineTokens("(#1) [#2] -#3").map((t) => t.id)).toEqual(["1", "2", "3"]);
  });

  it("does not treat a markdown heading as a work item", () => {
    expect(findInlineTokens("# 123 is a heading")).toEqual([]);
  });

  it("can be limited to one kind", () => {
    const text = "#1 !2 @<x>";
    expect(
      findInlineTokens(text, { pullRequests: false, mentions: false }).map((t) => t.kind),
    ).toEqual(["workItem"]);
  });

  it("accepts an alias mention as well as a guid", () => {
    expect(findInlineTokens("@<alex.green>").map((t) => t.id)).toEqual(["alex.green"]);
  });
});

describe("work item / pull request URLs", () => {
  it("builds the ADO edit URL", () => {
    expect(workItemUrl("https://dev.azure.com/contoso", "Product Engineering", "123")).toBe(
      "https://dev.azure.com/contoso/Product%20Engineering/_workitems/edit/123",
    );
    expect(pullRequestUrl("https://dev.azure.com/contoso/", "Wiki", "9")).toBe(
      "https://dev.azure.com/contoso/Wiki/_git/pullrequest/9",
    );
  });

  it("returns null when the connection is not configured", () => {
    expect(workItemUrl("", "Project", "1")).toBeNull();
    expect(workItemUrl("https://dev.azure.com/contoso", "  ", "1")).toBeNull();
  });
});

describe("mentionLabel", () => {
  it("shortens a guid but keeps an alias", () => {
    expect(mentionLabel("3b0a2131-0000-4000-8000-000000000000")).toBe("@3b0a2131…");
    expect(mentionLabel("alex.green")).toBe("@alex.green");
  });
});

describe("attachment naming", () => {
  const uuid = "0a1b2c3d-0000-4000-8000-1234567890ab";

  it("copies the ADO pattern <stem>-<guid>.<ext>", () => {
    expect(attachmentFileName("screenshot.PNG", uuid)).toBe(`screenshot-${uuid}.png`);
    expect(attachmentFileName("Design notes.pdf", uuid)).toBe(`Design-notes-${uuid}.pdf`);
  });

  it("keeps the characters ADO keeps", () => {
    expect(attachmentFileName("==image_0==.png", uuid)).toBe(`==image_0==-${uuid}.png`);
    expect(attachmentFileName("a&b+c.png", uuid)).toBe(`a&b+c-${uuid}.png`);
  });

  it("replaces what a path or a markdown link cannot carry", () => {
    expect(attachmentFileName('sub/dir/sh"ot?.png', uuid)).toBe(`sh-ot-${uuid}.png`);
    expect(attachmentFileName("shot (1).png", uuid)).toBe(`shot-1-${uuid}.png`);
    expect(attachmentFileName("???.png", uuid)).toBe(`image-${uuid}.png`);
    expect(attachmentFileName("", uuid)).toBe(`image-${uuid}`);
    // '.png' is a dot-file with no extension, not an extension with no stem.
    expect(attachmentFileName(".png", uuid)).toBe(`png-${uuid}`);
  });

  it("splits names without an extension", () => {
    expect(splitFileName("Makefile")).toEqual({ stem: "Makefile", extension: "" });
    expect(splitFileName("a.b.c")).toEqual({ stem: "a.b", extension: "c" });
  });

  it("writes an image embed for images and a plain link for other files", () => {
    expect(attachmentMarkdown("shot.png", `shot-${uuid}.png`)).toBe(
      `![shot.png](/.attachments/shot-${uuid}.png)`,
    );
    expect(attachmentMarkdown("notes.pdf", `notes-${uuid}.pdf`)).toBe(
      `[notes.pdf](/.attachments/notes-${uuid}.pdf)`,
    );
  });

  it("side-steps a name that is somehow already taken", () => {
    const existing = new Set([`shot-${uuid}.png`]);
    expect(uniqueAttachmentName(`shot-${uuid}.png`, (n) => existing.has(n))).toBe(
      `shot-${uuid}-2.png`,
    );
  });
});
