import { describe, expect, it } from "vitest";
import {
  headingToAnchor,
  headingToFragment,
  stripHeadingMarkers,
  stripInlineMarkdown,
  withAnchor,
} from "../src/naming/anchors";

describe("headingToAnchor", () => {
  it("reproduces the documented Azure DevOps example, consecutive hyphens included", () => {
    // ADO-WIKI-FORMAT §3 / SYNTAX-MAPPING §4: '#### Team #1 : Release Wiki!' → '#team-1--release-wiki'
    expect(headingToAnchor("#### Team #1 : Release Wiki!")).toBe("team-1--release-wiki");
    expect(headingToAnchor("Team #1 : Release Wiki!")).toBe("team-1--release-wiki");
  });

  it("lowercases and hyphenates spaces", () => {
    expect(headingToAnchor("Pre-Release RCA Categories")).toBe("pre-release-rca-categories");
    expect(headingToAnchor("Seed data")).toBe("seed-data");
  });

  it("drops punctuation instead of replacing it", () => {
    expect(headingToAnchor("Q&A?")).toBe("qa");
    expect(headingToAnchor("Setup & Config (v2)")).toBe("setup--config-v2");
    expect(headingToAnchor('What is a "page"?')).toBe("what-is-a-page");
    expect(headingToAnchor("1. Setup")).toBe("1-setup");
  });

  it("keeps hyphens, underscores and non-latin letters", () => {
    expect(headingToAnchor("snake_case and kebab-case")).toBe("snake_case-and-kebab-case");
    expect(headingToAnchor("Étude über Ærø")).toBe("étude-über-ærø");
  });

  it("trims the heading before slugging, so padding adds no hyphens", () => {
    expect(headingToAnchor("   Padded heading   ")).toBe("padded-heading");
    expect(headingToAnchor("## Closed heading ##")).toBe("closed-heading");
    expect(headingToAnchor("Trailing punctuation!")).toBe("trailing-punctuation");
  });

  it("keeps the hyphen left behind by dropped punctuation at an edge (github-slugger order)", () => {
    // Not verified against a live wiki — see the note in anchors.ts / SYNTAX-MAPPING §4.
    expect(headingToAnchor("!!! Shouting !!!")).toBe("-shouting-");
  });

  it("returns an empty anchor for a heading with nothing anchorable in it", () => {
    expect(headingToAnchor("### ***")).toBe("");
    expect(headingToAnchor("")).toBe("");
  });

  it("builds anchors from what the heading displays, not its markup", () => {
    expect(headingToAnchor("## **Bold** and `code`")).toBe("bold-and-code");
    expect(headingToAnchor("## See [the docs](https://example.com/x)")).toBe("see-the-docs");
    expect(headingToAnchor("## See [[Some Page|the page]]")).toBe("see-the-page");
  });
});

describe("headingToFragment / withAnchor", () => {
  it("prefixes the anchor with a hash", () => {
    expect(headingToFragment("Seed data")).toBe("#seed-data");
  });

  it("appends an anchor to a wiki path", () => {
    expect(withAnchor("/A/B", "Seed data")).toBe("/A/B#seed-data");
  });

  it("leaves the path alone when there is no usable heading", () => {
    expect(withAnchor("/A/B", null)).toBe("/A/B");
    expect(withAnchor("/A/B", "   ")).toBe("/A/B");
    expect(withAnchor("/A/B", "***")).toBe("/A/B");
  });
});

describe("stripHeadingMarkers / stripInlineMarkdown", () => {
  it("removes ATX markers but not a hash inside the text", () => {
    expect(stripHeadingMarkers("### Team #1")).toBe("Team #1");
    expect(stripHeadingMarkers("Not a heading")).toBe("Not a heading");
    // Six is the deepest heading; a seventh hash is content.
    expect(stripHeadingMarkers("####### Seven")).toBe("####### Seven");
  });

  it("keeps link labels and drops emphasis markers", () => {
    expect(stripInlineMarkdown("*emphasis* and ~~strike~~")).toBe("emphasis and strike");
    expect(stripInlineMarkdown('[label](/a/b "title")')).toBe("label");
    expect(stripInlineMarkdown("[[Target]]")).toBe("Target");
  });
});
