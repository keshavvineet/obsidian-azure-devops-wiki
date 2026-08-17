import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { encodeTitle } from "../src/naming/pageNameCodec";
import { PageIndex } from "../src/pages/pageIndex";
import { buildWikiTree } from "../src/pages/treeModel";
import { lintDocumentOf, lintPage } from "../src/lint/lintEngine";
import { findRenderableBlocks, headingsInMarkdown } from "../src/links/documentBlocks";
import type { LintHost } from "../src/lint/types";
import { fakeApp, FakeVault } from "./helpers/fakeVault";

/**
 * NFR-2, measured rather than asserted by eye.
 *
 * The budgets below are deliberately several times the numbers this suite actually produces on
 * a developer laptop: the point is to fail when something turns linear work quadratic, not to
 * fail on a busy CI runner. Real measurements are printed, so a regression is visible in the
 * log before it ever crosses a threshold.
 *
 * What cannot be measured here is Obsidian's own rendering; that is what the fixture vault and
 * the manual pass are for.
 */
const PAGES = 5000;
/** 20 top-level sections × 25 pages × 10 subpages — the shape a real wiki grows into. */
const SECTIONS = 20;
const PAGES_PER_SECTION = 25;

function syntheticVault(): FakeVault {
  const vault = new FakeVault();
  const rootNames: string[] = [];

  for (let section = 0; section < SECTIONS; section++) {
    const sectionName = encodeTitle(`${section + 1}. Section with a reasonably long title`);
    rootNames.push(sectionName);
    vault.addPage(`${sectionName}.md`);

    const pageNames: string[] = [];
    for (let page = 0; page < PAGES_PER_SECTION; page++) {
      const pageName = encodeTitle(`${section + 1}.${page + 1} Page: notes & details`);
      pageNames.push(pageName);
      vault.addPage(`${sectionName}/${pageName}.md`);

      const childNames: string[] = [];
      for (let child = 0; child < PAGES / (SECTIONS * PAGES_PER_SECTION) - 1; child++) {
        const childName = encodeTitle(`Sub-page ${child + 1} - detail`);
        childNames.push(childName);
        vault.addPage(`${sectionName}/${pageName}/${childName}.md`);
      }
      vault.writeOrder(`${sectionName}/${pageName}`, ...childNames);
    }
    vault.writeOrder(sectionName, ...pageNames);
  }
  vault.writeOrder("", ...rootNames);
  return vault;
}

function measure(label: string, run: () => void): number {
  const started = performance.now();
  run();
  const elapsed = performance.now() - started;
  console.log(`[perf] ${label}: ${elapsed.toFixed(1)} ms`);
  return elapsed;
}

const host: LintHost = {
  resolves: () => true,
  converterHost: () => ({ resolvePage: () => null, resolveAttachment: () => null }),
};

describe(`a ${PAGES}-page wiki`, () => {
  it("indexes, groups and renders a tree inside the NFR-2 budget", async () => {
    const vault = syntheticVault();
    const index = new PageIndex(fakeApp(vault) as unknown as App);
    // PAGES pages across three levels, plus the section pages that hold them.
    expect(vault.getMarkdownFiles().length).toBeGreaterThanOrEqual(PAGES);

    const started = performance.now();
    await index.rebuild();
    const build = performance.now() - started;
    console.log(`[perf] PageIndex.rebuild (${PAGES} pages): ${build.toFixed(1)} ms`);
    expect(build).toBeLessThan(4000);

    // pagesByFolder exists so the tree does not rescan the index once per node; if that ever
    // regresses to a per-node scan, this is where it shows up.
    const grouped = measure("PageIndex.pagesByFolder", () => void index.pagesByFolder());
    expect(grouped).toBeLessThan(1500);

    // The worst case the view can produce: every page expanded, so the whole wiki is a row.
    const byFolder = index.pagesByFolder();
    const tree = measure("buildWikiTree (everything expanded)", () =>
      void buildWikiTree({
        pagesIn: (folder) => byFolder.get(folder) ?? [],
        subfolderOf: (entry) => entry.file.path.replace(/\.md$/, ""),
        isExpanded: () => true,
      }),
    );
    expect(tree).toBeLessThan(1500);

    // The lookups every renderer does per link, 10,000 times over.
    const lookups = measure("20k index lookups", () => {
      for (const entry of index.all()) {
        index.forWikiPath(entry.wikiPath);
        index.forPath(entry.file.path);
        index.forTitle(entry.title);
        index.childrenOf(entry);
      }
    });
    expect(lookups).toBeLessThan(4000);
  });

  it("parses a long page for live preview fast enough to run on every keystroke", () => {
    // 2,000 lines: longer than any page in the reference production wiki.
    const lines: string[] = [];
    for (let i = 0; i < 400; i++) {
      lines.push(
        `## Heading ${i}`,
        "",
        `Some prose with a #${1000 + i} work item and a [link](/Section/Page-${i}).`,
        "",
        `![shot.png](/.attachments/shot-${i}.png)`,
        "",
      );
    }
    const text = lines.join("\n");

    const parse = measure("findRenderableBlocks + headingsInMarkdown (2400 lines)", () => {
      for (let pass = 0; pass < 20; pass++) {
        findRenderableBlocks(lines);
        headingsInMarkdown(lines);
      }
    });
    // 20 passes stand in for 20 keystrokes; a full parse per keystroke has to stay invisible.
    expect(parse / 20).toBeLessThan(50);
    expect(text.length).toBeGreaterThan(0);
  });

  it("lints a long page in well under a second", () => {
    const page = Array.from({ length: 500 }, (_, i) =>
      [
        `## Section ${i}`,
        "",
        `Text with [[A Wikilink ${i}]], ==highlight== and %%comment%%.`,
        "",
        "| a | b |",
        "| - | - |",
        "| 1 | 2 |",
      ].join("\n"),
    ).join("\n\n");

    let findings = 0;
    const elapsed = measure("lintPage (3500 lines, every rule)", () => {
      findings = lintPage(lintDocumentOf("Big.md", page), host).length;
    });

    expect(findings).toBeGreaterThan(500);
    expect(elapsed).toBeLessThan(3000);
  });
});
