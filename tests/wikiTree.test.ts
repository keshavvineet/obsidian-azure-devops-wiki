import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { stripMdExtension } from "../src/naming/pageNameCodec";
import { PageIndex, type PageEntry } from "../src/pages/pageIndex";
import { buildWikiTree, flattenTree } from "../src/pages/treeModel";
import { fakeApp, FakeVault } from "./helpers/fakeVault";

/**
 * The data path behind the sidebar view: index → tree shape. Only the DOM is left untested,
 * so a mistake in how `wikiTreeView` asks the index for a level shows up here rather than in
 * Obsidian. The three lambdas below are exactly the ones the view passes.
 *
 * Fixture mirrors test-vault/, including the third level under "4. Design - Connectors".
 */
let index: PageIndex;
let expanded: string[];

function tree() {
  const byFolder = index.pagesByFolder();
  return buildWikiTree<PageEntry>({
    pagesIn: (folderPath) => byFolder.get(folderPath) ?? [],
    subfolderOf: (entry) => stripMdExtension(entry.file.path),
    isExpanded: (entry) => expanded.includes(entry.file.path),
  });
}

const titles = () => flattenTree(tree()).map((node) => node.item.title);

beforeEach(async () => {
  const vault = new FakeVault();
  vault.addPage("Home.md");
  vault.addPage("Pre%2DRelease-RCA-Categories.md");
  vault.addPage("Product-Documentation.md");
  vault.addPage("Product-Documentation/4.-Design-%2D-Connectors.md");
  vault.addPage("Product-Documentation/Feature-Break-Down-&-User-Stories-(MVP).md");
  vault.addPage("Product-Documentation/4.-Design-%2D-Connectors/Overview.md");
  vault.addPage("Product-Documentation/4.-Design-%2D-Connectors/Connector-%2D-EDI.md");
  vault.writeOrder("", "Home", "Pre%2DRelease-RCA-Categories", "Product-Documentation");
  vault.writeOrder(
    "Product-Documentation",
    "4.-Design-%2D-Connectors",
    "Feature-Break-Down-&-User-Stories-(MVP)",
  );
  vault.writeOrder(
    "Product-Documentation/4.-Design-%2D-Connectors",
    "Overview",
    "Connector-%2D-EDI",
  );

  index = new PageIndex(fakeApp(vault) as unknown as App);
  await index.rebuild();
  expanded = [];
});

describe("wiki tree from the page index", () => {
  it("shows decoded titles at the root, in .order sequence", () => {
    expect(titles()).toEqual(["Home", "Pre-Release RCA Categories", "Product Documentation"]);
  });

  it("marks pages whose paired folder holds subpages", () => {
    expect(tree().map((node) => [node.item.title, node.hasChildren])).toEqual([
      ["Home", false],
      ["Pre-Release RCA Categories", false],
      ["Product Documentation", true],
    ]);
  });

  it("nests subpages under their page, still in .order sequence", () => {
    expanded = ["Product-Documentation.md"];
    expect(titles()).toEqual([
      "Home",
      "Pre-Release RCA Categories",
      "Product Documentation",
      "4. Design - Connectors",
      "Feature Break Down & User Stories (MVP)",
    ]);
  });

  it("nests a third level, in .order sequence rather than alphabetically", () => {
    expanded = ["Product-Documentation.md", "Product-Documentation/4.-Design-%2D-Connectors.md"];

    const design = tree()[2].children[0];
    expect(design.item.title).toBe("4. Design - Connectors");
    // "Overview" is listed first in .order even though it sorts second alphabetically.
    expect(design.children.map((node) => node.item.title)).toEqual(["Overview", "Connector - EDI"]);
    expect(design.children.map((node) => node.depth)).toEqual([2, 2]);

    // Depth-first, so a nested branch appears before its parent's next sibling.
    expect(flattenTree(tree()).map((node) => node.item.title)).toEqual([
      "Home",
      "Pre-Release RCA Categories",
      "Product Documentation",
      "4. Design - Connectors",
      "Overview",
      "Connector - EDI",
      "Feature Break Down & User Stories (MVP)",
    ]);
  });

  it("puts a page that .order does not list at the end of its level", async () => {
    // How the tree looks between a page arriving (git pull, explorer drag) and .order
    // catching up — the same thing Azure DevOps shows.
    const vault = new FakeVault();
    vault.addPage("Home.md");
    vault.addPage("Arrived-Out-Of-Band.md");
    vault.writeOrder("", "Home");
    index = new PageIndex(fakeApp(vault) as unknown as App);
    await index.rebuild();

    expect(titles()).toEqual(["Home", "Arrived Out Of Band"]);
  });
});

describe("PageIndex.pagesByFolder", () => {
  it("groups every page by its folder, each level in sequence", () => {
    const byFolder = index.pagesByFolder();

    expect([...byFolder.keys()].sort()).toEqual([
      "",
      "Product-Documentation",
      "Product-Documentation/4.-Design-%2D-Connectors",
    ]);
    expect(byFolder.get("")?.map((entry) => entry.name)).toEqual([
      "Home",
      "Pre%2DRelease-RCA-Categories",
      "Product-Documentation",
    ]);
    expect(
      byFolder.get("Product-Documentation/4.-Design-%2D-Connectors")?.map((entry) => entry.name),
    ).toEqual(["Overview", "Connector-%2D-EDI"]);
  });
});
