import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lintDocumentOf, lintPage } from "../src/lint/lintEngine";
import { RULE_IDS } from "../src/lint/rules";
import type { LintHost } from "../src/lint/types";

/**
 * Phase 6 acceptance: "the linter finds 100% of the seeded incompatibilities in a dedicated
 * fixture page".
 *
 * The fixture is a real markdown page, kept outside `test-vault/` so that the vault can be an
 * exact clone of a wiki repository: a fixture page living in there would show up as an
 * untracked page and get published on the first Sync. Copy it into a vault when the linter
 * needs checking by eye.
 *
 * The three rules the fixture cannot carry are asserted to be *absent* by name rather than
 * quietly ignored, so adding a rule to the set without seeding it fails here.
 */
const FIXTURE = "tests/fixtures/Compatibility-Fixture.md";

/** The fixture vault as the linter sees it: Home exists, the deleted page does not. */
const host: LintHost = {
  resolves: (href) => href === "/Home" || href === "Home.md" || href.startsWith("/.attachments/"),
  converterHost: () => ({
    resolvePage: (target) =>
      target === "Home" || target.startsWith("ADO Syntax Showcase")
        ? { wikiPath: `/${target.replace(/ /g, "-")}`, title: target }
        : null,
    resolveAttachment: (target) =>
      target.endsWith(".png") ? { linkTarget: `/.attachments/${target}` } : null,
  }),
};

/** Rules a single markdown page cannot demonstrate. */
const NOT_SEEDED = new Set([
  // Needs a file name that is wrong; the fixture has to be openable to be a fixture.
  "page-name-not-portable",
  // Needs a 235-character path and an 18 MB file.
  "page-path-too-long",
  "page-too-large",
]);

describe("the compatibility fixture page", () => {
  const text = readFileSync(FIXTURE, "utf8");
  const findings = lintPage(lintDocumentOf(FIXTURE, text), host);
  const found = new Set(findings.map((finding) => finding.rule));

  it("trips every rule that a single page can trip", () => {
    const expected = RULE_IDS.filter((id) => !NOT_SEEDED.has(id));
    expect([...found].sort()).toEqual([...expected].sort());
  });

  it("seeds nothing the linter cannot explain", () => {
    for (const finding of findings) {
      expect(finding.message.length).toBeGreaterThan(0);
      // Every finding is either repairable or says what the human should do instead.
      expect(finding.fix !== undefined || finding.advice !== undefined).toBe(true);
    }
  });

  it("every fix lands inside the page and changes something", () => {
    for (const finding of findings) {
      for (const edit of finding.fix?.edits ?? []) {
        expect(edit.from).toBeGreaterThanOrEqual(0);
        expect(edit.to).toBeLessThanOrEqual(text.length);
        expect(edit.from).toBeLessThanOrEqual(edit.to);
        expect(text.slice(edit.from, edit.to)).not.toBe(edit.text);
      }
    }
  });
});
