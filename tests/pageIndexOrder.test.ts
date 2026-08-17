import { beforeEach, describe, expect, it } from "vitest";
import type { App, TAbstractFile } from "obsidian";
import { PageIndex, UNORDERED } from "../src/pages/pageIndex";
import { OrderManager } from "../src/order/orderManager";
import { fakeApp, FakeVault } from "./helpers/fakeVault";

/**
 * End-to-end cover for the two stateful modules, driven through the same vault events
 * Obsidian raises. The fixtures mirror the AXBIS wiki's real structure.
 */
let vault: FakeVault;
let index: PageIndex;
let orderManager: OrderManager;

/** Replays what main.ts does on a vault event: index first, then .order reconciliation. */
async function emitCreate(path: string) {
  const file = vault.addPage(path);
  await index.handleCreate(file as unknown as TAbstractFile);
  await orderManager.handleCreate(file as unknown as TAbstractFile);
  return file;
}

async function emitRename(oldPath: string, newPath: string) {
  const file = vault.renamePage(oldPath, newPath);
  await index.handleRename(file as unknown as TAbstractFile, oldPath);
  await orderManager.handleRename(file as unknown as TAbstractFile, oldPath);
  return file;
}

async function emitDelete(path: string) {
  const file = vault.removePage(path);
  index.handleDelete(file as unknown as TAbstractFile);
  await orderManager.handleDelete(file as unknown as TAbstractFile);
}

beforeEach(async () => {
  vault = new FakeVault();
  vault.addPage("Home.md");
  vault.addPage("Pre%2DRelease-RCA-Categories.md");
  vault.addPage("Product-Documentation.md");
  vault.addPage("Product-Documentation/4.-Design-%2D-Connectors.md");
  vault.addPage("Product-Documentation/1.-Setup.md");
  vault.writeOrder("", "Home", "Pre%2DRelease-RCA-Categories", "Product-Documentation");
  vault.writeOrder("Product-Documentation", "1.-Setup", "4.-Design-%2D-Connectors");

  const app = fakeApp(vault) as unknown as App;
  index = new PageIndex(app);
  orderManager = new OrderManager(app, index);
  await index.rebuild();
  vault.writeCount = 0;
});

describe("PageIndex", () => {
  it("decodes titles and builds wiki paths", () => {
    const entry = index.forPath("Pre%2DRelease-RCA-Categories.md");
    expect(entry?.title).toBe("Pre-Release RCA Categories");
    expect(entry?.wikiPath).toBe("/Pre%2DRelease-RCA-Categories");
    expect(entry?.folderPath).toBe("");
    expect(entry?.parentPath).toBeNull();
  });

  it("builds decoded title paths for nested pages", () => {
    const entry = index.forPath("Product-Documentation/4.-Design-%2D-Connectors.md");
    expect(entry?.title).toBe("4. Design - Connectors");
    expect(entry?.titlePath).toBe("Product Documentation/4. Design - Connectors");
    expect(entry?.parentPath).toBe("Product-Documentation.md");
  });

  it("resolves a wiki link target, case-insensitively as a fallback", () => {
    expect(index.forWikiPath("/Product-Documentation")?.title).toBe("Product Documentation");
    expect(index.forWikiPath("/product-documentation")?.title).toBe("Product Documentation");
    expect(index.forWikiPath("/Product-Documentation#setup")?.title).toBe("Product Documentation");
    expect(index.forWikiPath("/Nope")).toBeNull();
  });

  it("links a page to its subpages through the paired folder", () => {
    const parent = index.forPath("Product-Documentation.md")!;
    expect(index.childrenOf(parent).map((e) => e.title)).toEqual([
      "1. Setup",
      "4. Design - Connectors",
    ]);
    expect(index.parentOf(index.childrenOf(parent)[0])?.title).toBe("Product Documentation");
  });

  it("orders pages by .order, not alphabetically", () => {
    expect(index.rootPages().map((e) => e.name)).toEqual([
      "Home",
      "Pre%2DRelease-RCA-Categories",
      "Product-Documentation",
    ]);
  });

  it("sorts pages missing from .order last, alphabetically", async () => {
    await emitCreate("Zulu.md");
    vault.disk.set(".order", "Home\n"); // simulate .order drifting out of date
    await index.refreshFolderOrder("");

    const entries = index.rootPages();
    expect(entries[0].name).toBe("Home");
    expect(entries[0].order).toBe(0);
    expect(entries[1].order).toBe(UNORDERED);
    expect(entries.slice(1).map((e) => e.name)).toEqual([
      "Pre%2DRelease-RCA-Categories",
      "Product-Documentation",
      "Zulu",
    ]);
  });

  it("ignores files inside dot-folders", async () => {
    vault.addPage(".obsidian/notes.md");
    await index.rebuild();
    expect(index.forPath(".obsidian/notes.md")).toBeNull();
  });
});

/**
 * The explorer decorator asks this for every row on every repaint, so it is answered from a
 * maintained count rather than a scan. A cached count is exactly the kind of thing that drifts,
 * hence the checks after each vault event: a wrong answer here shows up as a page whose subpages
 * cannot be reached, or a duplicated explorer row.
 */
describe("PageIndex.hasPagesInFolder", () => {
  it("answers for the root, a folder with pages, and one without", () => {
    expect(index.hasPagesInFolder("")).toBe(true);
    expect(index.hasPagesInFolder("Product-Documentation")).toBe(true);
    expect(index.hasPagesInFolder("Product-Documentation/1.-Setup")).toBe(false);
    expect(index.hasPagesInFolder("Nope")).toBe(false);
  });

  it("agrees with pagesInFolder after create, rename and delete", async () => {
    const agrees = (folder: string) =>
      expect(index.hasPagesInFolder(folder)).toBe(index.pagesInFolder(folder).length > 0);

    await emitCreate("Product-Documentation/1.-Setup/Details.md");
    agrees("Product-Documentation/1.-Setup");
    expect(index.hasPagesInFolder("Product-Documentation/1.-Setup")).toBe(true);

    await emitRename("Product-Documentation/1.-Setup/Details.md", "Details.md");
    agrees("Product-Documentation/1.-Setup");
    agrees("");
    expect(index.hasPagesInFolder("Product-Documentation/1.-Setup")).toBe(false);

    await emitDelete("Details.md");
    agrees("");
    expect(index.hasPagesInFolder("")).toBe(true); // the other root pages are still there
  });

  it("survives a rebuild without double-counting", async () => {
    await index.rebuild();
    await index.rebuild();
    expect(index.hasPagesInFolder("Product-Documentation")).toBe(true);

    await emitDelete("Product-Documentation/1.-Setup.md");
    await emitDelete("Product-Documentation/4.-Design-%2D-Connectors.md");
    expect(index.hasPagesInFolder("Product-Documentation")).toBe(false);
  });

  it("normalizes the folder path the way its callers spell it", () => {
    // The decorator passes a page path with '.md' stripped; other callers pass '' or '/'.
    expect(index.hasPagesInFolder("/Product-Documentation")).toBe(true);
    expect(index.hasPagesInFolder("Product-Documentation/")).toBe(true);
    expect(index.hasPagesInFolder("/")).toBe(true);
  });
});

describe("OrderManager — page creation", () => {
  it("appends a new page to the end of an existing .order", async () => {
    await emitCreate("Environments-List.md");
    expect(vault.orderEntries("")).toEqual([
      "Home",
      "Pre%2DRelease-RCA-Categories",
      "Product-Documentation",
      "Environments-List",
    ]);
  });

  it("seeds a missing .order alphabetically so the displayed order does not jump", async () => {
    // Azure DevOps renders a folder without .order alphabetically; creating the file must
    // capture that same sequence rather than reshuffling what readers already see.
    vault.addPage("Scrum.md");
    vault.addPage("Scrum/DoD.md");
    vault.addPage("Scrum/Ceremonies.md");
    await index.rebuild();

    await emitCreate("Scrum/Working-Agreements.md");

    expect(vault.orderEntries("Scrum")).toEqual(["Ceremonies", "DoD", "Working-Agreements"]);
  });

  it("puts a newly created page last even when it sorts first alphabetically", async () => {
    vault.addPage("Scrum.md");
    vault.addPage("Scrum/DoD.md");
    vault.addPage("Scrum/Ceremonies.md");
    await index.rebuild();

    await emitCreate("Scrum/Backlog.md");

    // Seeded pages keep their alphabetical sequence; the new page goes to the end,
    // which is where the Azure DevOps portal puts it too.
    expect(vault.orderEntries("Scrum")).toEqual(["Ceremonies", "DoD", "Backlog"]);
  });

  it("registers the new page's position in the index", async () => {
    await emitCreate("Environments-List.md");
    expect(index.forPath("Environments-List.md")?.order).toBe(3);
  });
});

describe("OrderManager — renaming", () => {
  it("renames in place, preserving the page's position", async () => {
    await emitRename(
      "Product-Documentation/1.-Setup.md",
      "Product-Documentation/1.-Getting-Started.md",
    );
    expect(vault.orderEntries("Product-Documentation")).toEqual([
      "1.-Getting-Started",
      "4.-Design-%2D-Connectors",
    ]);
  });

  it("moves the entry between folders when a page changes parent", async () => {
    await emitRename("Product-Documentation/1.-Setup.md", "1.-Setup.md");
    expect(vault.orderEntries("Product-Documentation")).toEqual(["4.-Design-%2D-Connectors"]);
    expect(vault.orderEntries("")).toContain("1.-Setup");
  });

  it("re-paths subpages when a parent page's folder is renamed", async () => {
    vault.renamePage("Product-Documentation.md", "Product-Docs.md");
    const folder = vault.renameFolder("Product-Documentation", "Product-Docs");
    await index.handleRename(folder as unknown as TAbstractFile, "Product-Documentation");

    const child = index.forPath("Product-Docs/4.-Design-%2D-Connectors.md");
    expect(child?.wikiPath).toBe("/Product-Docs/4.-Design-%2D-Connectors");
    expect(child?.titlePath).toBe("Product Docs/4. Design - Connectors");
  });
});

describe("OrderManager — deletion", () => {
  it("drops the deleted page from .order and keeps the rest in sequence", async () => {
    await emitDelete("Pre%2DRelease-RCA-Categories.md");
    expect(vault.orderEntries("")).toEqual(["Home", "Product-Documentation"]);
  });
});

describe("OrderManager — write discipline", () => {
  it("does not write when .order already matches disk", async () => {
    await orderManager.repairFolder("");
    await orderManager.repairFolder("Product-Documentation");
    expect(vault.writeCount).toBe(0);
  });

  it("writes exactly once per changed folder", async () => {
    await emitCreate("Environments-List.md");
    expect(vault.writeCount).toBe(1);
  });
});

describe("OrderManager — repairAll", () => {
  it("adds pages missing from .order and removes stale entries", async () => {
    vault.addPage("Orphaned-Check.md");
    vault.writeOrder("", "Home", "Deleted-Long-Ago", "Product-Documentation");
    await index.rebuild();

    const summary = await orderManager.repairAll();

    expect(summary.added).toBe(2); // Orphaned-Check + Pre%2DRelease-RCA-Categories
    expect(summary.removed).toBe(1); // Deleted-Long-Ago
    expect(summary.foldersChanged).toEqual(["/"]);
    expect(vault.orderEntries("")).toEqual([
      "Home",
      "Product-Documentation",
      "Orphaned-Check",
      "Pre%2DRelease-RCA-Categories",
    ]);
  });

  it("reports nothing to do for a healthy wiki", async () => {
    const summary = await orderManager.repairAll();
    expect(summary.foldersChanged).toEqual([]);
    expect(vault.writeCount).toBe(0);
  });

  it("leaves folders without a .order file alone", async () => {
    // No .order means Azure DevOps sorts alphabetically, which is already correct.
    // Inventing one here would pin that order and bloat the next commit.
    vault.addPage("Scrum.md");
    vault.addPage("Scrum/DoD.md");
    vault.writeOrder("", "Home", "Pre%2DRelease-RCA-Categories", "Product-Documentation", "Scrum");
    await index.rebuild();

    const summary = await orderManager.repairAll();

    expect(vault.readOrder("Scrum")).toBeUndefined();
    expect(summary.foldersChecked).toBe(2); // root and Product-Documentation only
    expect(vault.writeCount).toBe(0);
  });
});
