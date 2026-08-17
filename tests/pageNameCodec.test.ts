import { describe, expect, it } from "vitest";
import {
  decodeFileName,
  decodePathToTitlePath,
  encodeTitle,
  encodeTitleToFileName,
  hasAmbiguousEscape,
  stripMdExtension,
  vaultPathFromWikiPath,
  wikiPathFromVaultPath,
} from "../src/naming/pageNameCodec";

// Production examples lifted verbatim from the AXBIS wiki (docs/ADO-WIKI-FORMAT.md §2).
const PRODUCTION_CASES: Array<[fileName: string, title: string]> = [
  ["Pre%2DRelease-RCA-Categories.md", "Pre-Release RCA Categories"],
  ["4.-Design-%2D-Connectors", "4. Design - Connectors"],
  [
    "12.2.3-Feature-Break-Down-&-User-Stories-(MVP)",
    "12.2.3 Feature Break Down & User Stories (MVP)",
  ],
  [
    "233458-%2D-RCA-EDI-orders-processed-in-D365-but-files-remained-in-Azure-“Work”-folder.md",
    "233458 - RCA EDI orders processed in D365 but files remained in Azure “Work” folder",
  ],
];

describe("decodeFileName", () => {
  it.each(PRODUCTION_CASES)("decodes %s", (fileName, title) => {
    expect(decodeFileName(fileName)).toBe(title);
  });

  it("decodes every documented escape", () => {
    expect(decodeFileName("A%3AB%2AC%3FD%7CE%22F%3CG%3EH")).toBe('A:B*C?D|E"F<G>H');
  });

  it("accepts lowercase escapes but is not confused by literal percent signs", () => {
    expect(decodeFileName("Grade-A%2db")).toBe("Grade A-b");
    expect(decodeFileName("100%-done")).toBe("100% done");
    expect(decodeFileName("50%2")).toBe("50%2");
  });

  it("turns consecutive hyphens into consecutive spaces", () => {
    expect(decodeFileName("A--B")).toBe("A  B");
  });

  it("only strips a trailing .md extension", () => {
    expect(decodeFileName("Notes.md.md")).toBe("Notes.md");
    expect(stripMdExtension("Read.MD")).toBe("Read");
    expect(stripMdExtension("mdfile")).toBe("mdfile");
  });
});

describe("encodeTitle", () => {
  it.each(PRODUCTION_CASES)("re-encodes to %s", (fileName, title) => {
    expect(encodeTitle(title)).toBe(stripMdExtension(fileName));
  });

  it("encodes every character that needs escaping", () => {
    expect(encodeTitle('A:B*C?D|E"F<G>H')).toBe("A%3AB%2AC%3FD%7CE%22F%3CG%3EH");
  });

  it("leaves literally-stored characters alone", () => {
    expect(encodeTitle("R&D (2026), v1.2 — 'final'!")).toBe("R&D-(2026),-v1.2-—-'final'!");
  });

  it("appends the extension", () => {
    expect(encodeTitleToFileName("My Page")).toBe("My-Page.md");
  });
});

describe("round trip", () => {
  it("survives 1000 randomly generated valid titles", () => {
    // Deterministic PRNG so failures are reproducible.
    let seed = 42;
    const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const alphabet = [
      ..."abcXYZ019",
      ..." -:*?|\"<>",
      ..."&().,'!+=@$",
      ..."éü“”",
      "😀", // surrogate pair — must not be split by the codec
    ];

    for (let i = 0; i < 1000; i++) {
      const length = 1 + Math.floor(random() * 30);
      let title = "";
      for (let c = 0; c < length; c++) {
        title += alphabet[Math.floor(random() * alphabet.length)];
      }
      expect(decodeFileName(encodeTitleToFileName(title))).toBe(title);
    }
  });

  it("re-encodes production file names byte-for-byte", () => {
    for (const [fileName] of PRODUCTION_CASES) {
      const bare = stripMdExtension(fileName);
      expect(encodeTitle(decodeFileName(bare))).toBe(bare);
    }
  });
});

describe("hasAmbiguousEscape", () => {
  it("flags titles that collide with the escape syntax", () => {
    expect(hasAmbiguousEscape("Coverage %2D report")).toBe(true);
    expect(hasAmbiguousEscape("100% done")).toBe(false);
    expect(hasAmbiguousEscape("%2")).toBe(false);
  });
});

describe("path helpers", () => {
  it("converts vault paths to wiki link targets and back", () => {
    const vaultPath = "Product-Documentation/4.-Design-%2D-Connectors.md";
    expect(wikiPathFromVaultPath(vaultPath)).toBe(
      "/Product-Documentation/4.-Design-%2D-Connectors",
    );
    expect(vaultPathFromWikiPath("/Product-Documentation/4.-Design-%2D-Connectors")).toBe(
      vaultPath,
    );
  });

  it("decodes a whole path to a title path", () => {
    expect(decodePathToTitlePath("Product-Documentation/4.-Design-%2D-Connectors.md")).toBe(
      "Product Documentation/4. Design - Connectors",
    );
  });

  it("handles the vault root", () => {
    expect(wikiPathFromVaultPath("Home.md")).toBe("/Home");
    expect(vaultPathFromWikiPath("/")).toBe("");
  });
});
