import { beforeEach, describe, expect, it } from "vitest";
import type { App, TFile as ObsidianTFile } from "obsidian";
import { OrderManager } from "../src/order/orderManager";
import { PageCommands } from "../src/pages/pageCommands";
import { PageIndex } from "../src/pages/pageIndex";
import { fakeApp, FakeVault } from "./helpers/fakeVault";

/**
 * Move up / move down / set as home page, and the silent rename of a name Azure DevOps cannot
 * open — the three things `PageCommands` now does without a modal.
 *
 * They live outside the wiki tree on purpose: Obsidian's own file explorer cannot *show* the
 * wiki's sequence (it sorts alphabetically and puts folders first, so a page with subpages jumps
 * above its siblings), and that explorer is where users work. Ordering therefore has to be
 * reachable as a command and a context-menu item, both of which land here.
 */
let vault: FakeVault;
let index: PageIndex;
let commands: PageCommands;
/** Renames the fake `fileManager` performed, as `old → new`. */
let renames: string[];

beforeEach(async () => {
  vault = new FakeVault();
  vault.addPage("Product-Documentation.md");
  vault.addPage("Product-Documentation/1.-Setup.md");
  vault.addPage("Product-Documentation/2.-Design.md");
  vault.addPage("Product-Documentation/3.-Release.md");
  vault.addPage("Home.md");
  vault.writeOrder("", "Home", "Product-Documentation");
  vault.writeOrder("Product-Documentation", "1.-Setup", "2.-Design", "3.-Release");

  renames = [];
  const app = {
    ...fakeApp(vault),
    fileManager: {
      renameFile: async (file: ObsidianTFile, path: string) => {
        renames.push(`${file.path} → ${path}`);
        vault.renamePage(file.path, path);
      },
    },
    workspace: { getActiveFile: () => null },
    metadataCache: { getFileCache: () => null },
  } as unknown as App;

  index = new PageIndex(app);
  const orderManager = new OrderManager(app, index);
  commands = new PageCommands(app, index, orderManager);
  await index.rebuild();
});

const entryFor = (path: string) => {
  const entry = index.forPath(path);
  if (!entry) throw new Error(`not indexed: ${path}`);
  return entry;
};

describe("PageCommands.movePage", () => {
  it("moves a page down one place and writes .order", async () => {
    await commands.movePage(entryFor("Product-Documentation/1.-Setup.md"), 1);

    expect(vault.orderEntries("Product-Documentation")).toEqual([
      "2.-Design",
      "1.-Setup",
      "3.-Release",
    ]);
  });

  it("moves a page up one place", async () => {
    await commands.movePage(entryFor("Product-Documentation/3.-Release.md"), -1);

    expect(vault.orderEntries("Product-Documentation")).toEqual([
      "1.-Setup",
      "3.-Release",
      "2.-Design",
    ]);
  });

  it("writes nothing when the page is already at that end", async () => {
    vault.writeCount = 0;
    await commands.movePage(entryFor("Product-Documentation/1.-Setup.md"), -1);

    expect(vault.writeCount).toBe(0);
    expect(vault.orderEntries("Product-Documentation")).toEqual([
      "1.-Setup",
      "2.-Design",
      "3.-Release",
    ]);
  });

  it("reports each page's place, which is what greys out the menu items", () => {
    expect(commands.positionOf(entryFor("Product-Documentation/2.-Design.md"))).toEqual({
      index: 1,
      total: 3,
    });
  });
});

describe("PageCommands.setHomePage", () => {
  it("makes the page the first entry of the root .order", async () => {
    await commands.setHomePage(entryFor("Product-Documentation.md"));

    expect(vault.orderEntries("")).toEqual(["Product-Documentation", "Home"]);
  });
});

/**
 * The confirmed cause of "adding a new page in Obsidian gives an error in ADO": Obsidian's own
 * *New note* writes literal spaces, and the portal then refuses the page. Renaming it costs the
 * user nothing — the title is identical either way — so it happens without asking.
 */
describe("PageCommands.renameToPortableName", () => {
  it("re-encodes a file name Azure DevOps cannot decode, keeping the title", async () => {
    vault.addPage("Product-Documentation/7.4 New Test Page.md");
    await index.rebuild();

    const title = await commands.renameToPortableName(
      entryFor("Product-Documentation/7.4 New Test Page.md"),
    );

    expect(title).toBe("7.4 New Test Page");
    expect(renames).toEqual([
      "Product-Documentation/7.4 New Test Page.md → Product-Documentation/7.4-New-Test-Page.md",
    ]);
  });

  it("leaves a name that is already in the wiki's own form alone", async () => {
    expect(await commands.renameToPortableName(entryFor("Product-Documentation/1.-Setup.md"))).toBe(
      null,
    );
    expect(renames).toEqual([]);
  });

  it("does not rename when the encoded name would collide with a sibling", async () => {
    vault.addPage("Product-Documentation/2. Design.md"); // encodes to the existing 2.-Design.md
    await index.rebuild();

    expect(await commands.renameToPortableName(entryFor("Product-Documentation/2. Design.md"))).toBe(
      null,
    );
    expect(renames).toEqual([]);
  });
});
