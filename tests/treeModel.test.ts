import { describe, expect, it } from "vitest";
import {
  buildWikiTree,
  flattenTree,
  namesWithDrop,
  namesWithOffset,
  TreeShape,
} from "../src/pages/treeModel";

/** Stand-in for a page: the tree model only needs a name and its paired folder. */
interface Page {
  name: string;
  folder: string;
}

const page = (folder: string, name: string): Page => ({ name, folder });

/** Mirrors the AXBIS structure: root pages, one of them with subpages. */
const PAGES: Page[] = [
  page("", "Home"),
  page("", "Product-Documentation"),
  page("Product-Documentation", "1.-Setup"),
  page("Product-Documentation", "4.-Design-%2D-Connectors"),
  page("Product-Documentation/4.-Design-%2D-Connectors", "Connector-A"),
];

function shape(expanded: string[]): TreeShape<Page> {
  return {
    pagesIn: (folderPath) => PAGES.filter((p) => p.folder === folderPath),
    subfolderOf: (item) => (item.folder === "" ? item.name : `${item.folder}/${item.name}`),
    isExpanded: (item) => expanded.includes(item.name),
  };
}

describe("buildWikiTree", () => {
  it("returns root pages in sequence, collapsed", () => {
    const nodes = buildWikiTree(shape([]));
    expect(nodes.map((n) => n.item.name)).toEqual(["Home", "Product-Documentation"]);
    expect(nodes.map((n) => n.depth)).toEqual([0, 0]);
    expect(nodes.map((n) => n.children)).toEqual([[], []]);
  });

  it("flags pages that have subpages even while collapsed", () => {
    // The row needs its expand arrow before anything is expanded.
    const nodes = buildWikiTree(shape([]));
    expect(nodes.map((n) => n.hasChildren)).toEqual([false, true]);
  });

  it("expands only the pages that are open", () => {
    const nodes = buildWikiTree(shape(["Product-Documentation"]));
    const children = nodes[1].children;
    expect(children.map((n) => n.item.name)).toEqual(["1.-Setup", "4.-Design-%2D-Connectors"]);
    expect(children.map((n) => n.depth)).toEqual([1, 1]);
    expect(children[1].hasChildren).toBe(true);
    expect(children[1].children).toEqual([]); // collapsed, so not walked
  });

  it("nests to any depth", () => {
    const nodes = buildWikiTree(shape(["Product-Documentation", "4.-Design-%2D-Connectors"]));
    const grandchild = nodes[1].children[1].children[0];
    expect(grandchild.item.name).toBe("Connector-A");
    expect(grandchild.depth).toBe(2);
  });
});

describe("flattenTree", () => {
  it("lists rows in the order they appear on screen", () => {
    const nodes = buildWikiTree(shape(["Product-Documentation"]));
    expect(flattenTree(nodes).map((n) => n.item.name)).toEqual([
      "Home",
      "Product-Documentation",
      "1.-Setup",
      "4.-Design-%2D-Connectors",
    ]);
  });
});

describe("namesWithDrop", () => {
  const names = ["A", "B", "C", "D"];

  it("moves a page down the list", () => {
    expect(namesWithDrop(names, "A", "D", "before")).toEqual(["B", "C", "A", "D"]);
    expect(namesWithDrop(names, "A", "D", "after")).toEqual(["B", "C", "D", "A"]);
  });

  it("moves a page up the list", () => {
    expect(namesWithDrop(names, "D", "B", "before")).toEqual(["A", "D", "B", "C"]);
    expect(namesWithDrop(names, "D", "A", "before")).toEqual(["D", "A", "B", "C"]);
  });

  it("reports no change when the drop lands where the page already is", () => {
    // Nothing written means no .order diff and no git noise.
    expect(namesWithDrop(names, "A", "A", "before")).toBeNull();
    expect(namesWithDrop(names, "A", "B", "before")).toBeNull();
    expect(namesWithDrop(names, "B", "A", "after")).toBeNull();
  });

  it("ignores pages that are not in the sequence", () => {
    expect(namesWithDrop(names, "Z", "B", "before")).toBeNull();
    expect(namesWithDrop(names, "A", "Z", "before")).toBeNull();
  });

  it("keeps every page exactly once", () => {
    const moved = namesWithDrop(names, "C", "A", "before");
    expect(moved).toEqual(["C", "A", "B", "D"]);
    expect(new Set(moved).size).toBe(names.length);
  });
});

describe("namesWithOffset", () => {
  const names = ["A", "B", "C"];

  it("nudges a page one position each way", () => {
    expect(namesWithOffset(names, "C", -1)).toEqual(["A", "C", "B"]);
    expect(namesWithOffset(names, "A", 1)).toEqual(["B", "A", "C"]);
  });

  it("stops at the ends of the list", () => {
    expect(namesWithOffset(names, "A", -1)).toBeNull();
    expect(namesWithOffset(names, "C", 1)).toBeNull();
    expect(namesWithOffset(names, "Z", 1)).toBeNull();
  });
});
