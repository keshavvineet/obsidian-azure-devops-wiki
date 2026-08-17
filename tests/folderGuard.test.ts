import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TAbstractFile, TFile } from "obsidian";
import { TFolder } from "obsidian";
import { FolderGuard } from "../src/pages/folderGuard";
import { OrderManager } from "../src/order/orderManager";
import { PageIndex } from "../src/pages/pageIndex";
import { FakeVault } from "./helpers/fakeVault";

/**
 * The folder half of "I create a new folder, add a page under it, and it does not work".
 *
 * These drive the guard through its real debounce with fake timers rather than reaching into it,
 * because the settle delay *is* the behaviour: Obsidian creates *New folder* as `Untitled` and
 * opens the row for renaming, so acting on the create event would adopt the wrong name.
 */

/**
 * Vault plus the two mutating APIs the guard uses, wired so events fire as Obsidian's do.
 *
 * The casts are the documented stub/typings split: vitest aliases `obsidian` to the stub so
 * `instanceof TFolder` works at run time, but `tsc` still checks this file against the real
 * typings, where every `TAbstractFile` carries a `vault` the stub has no use for.
 */
function harness(options: { syncing?: () => boolean } = {}) {
  const vault = new FakeVault();
  const created: string[] = [];
  const renamed: Array<[string, string]> = [];

  const app = {
    vault: Object.assign(vault, {
      create: async (path: string): Promise<TFile> => {
        created.push(path);
        return asReal<TFile>(vault.addPage(path));
      },
    }),
    fileManager: {
      renameFile: async (file: TAbstractFile, path: string): Promise<void> => {
        renamed.push([file.path, path]);
        if (file instanceof TFolder) vault.renameFolder(file.path, path);
        else vault.renamePage(file.path, path);
      },
    },
  };

  const index = new PageIndex(asReal<App>(app));
  const orderManager = new OrderManager(asReal<App>(app), index);
  const guard = new FolderGuard(asReal<App>(app), orderManager, options.syncing ?? (() => false));

  return { vault, guard, created, renamed, index };
}

/** The stub satisfies the slice of the API under test; the real typings want the whole class. */
function asReal<T>(value: unknown): T {
  return value as T;
}

/** A folder from the fake vault, typed as the real `TAbstractFile` the guard's signature wants. */
function folder(vault: FakeVault, path: string): TAbstractFile {
  return asReal<TAbstractFile>(vault.ensureFolder(path));
}

/** Let the 2 s settle delay elapse and every promise the flush chains settle. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(2100);
  await vi.runAllTimersAsync();
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("FolderGuard", () => {
  it("turns a bare folder into a page with the encoded name", async () => {
    const h = harness();
    h.guard.check(folder(h.vault, "This is a new page"));
    await settle();

    expect(h.renamed).toEqual([["This is a new page", "This-is-a-new-page"]]);
    expect(h.created).toEqual(["This-is-a-new-page.md"]);
  });

  it("creates the paired page without renaming an already-portable folder", async () => {
    const h = harness();
    h.guard.check(folder(h.vault, "Research"));
    await settle();

    expect(h.renamed).toEqual([]);
    expect(h.created).toEqual(["Research.md"]);
  });

  it("leaves a folder that already owns a page alone", async () => {
    const h = harness();
    h.vault.addPage("Product-Documentation.md");
    h.guard.check(folder(h.vault, "Product-Documentation"));
    await settle();

    expect(h.created).toEqual([]);
    expect(h.renamed).toEqual([]);
  });

  it("ignores .attachments and .obsidian", async () => {
    const h = harness();
    h.guard.check(folder(h.vault, ".attachments"));
    h.guard.check(folder(h.vault, ".obsidian"));
    await settle();

    expect(h.created).toEqual([]);
  });

  it("adopts the name the user typed, not the Untitled it was created as", async () => {
    // Obsidian's New folder makes "Untitled" and immediately opens the row for renaming; the
    // rename event is where the real name arrives, and the settle delay is what waits for it.
    const h = harness();
    const created = folder(h.vault, "Untitled");
    h.guard.check(created);

    await vi.advanceTimersByTimeAsync(500);
    h.vault.renameFolder("Untitled", "Release notes");
    h.guard.forget("Untitled");
    h.guard.check(created);
    await settle();

    expect(h.created).toEqual(["Release-notes.md"]);
    expect(h.renamed).toEqual([["Release notes", "Release-notes"]]);
  });

  it("does nothing for a folder that has been deleted again before it settles", async () => {
    const h = harness();
    h.guard.check(folder(h.vault, "Scratch"));
    h.guard.forget("Scratch");
    await settle();

    expect(h.created).toEqual([]);
  });

  it("holds a folder that arrives during a git flow until the flow ends", async () => {
    // A Refresh lands a folder and its paired page as two events; inventing a page in the gap
    // would commit a file the server is about to deliver.
    let syncing = true;
    const h = harness({ syncing: () => syncing });
    h.guard.check(folder(h.vault, "Incoming"));
    await settle();
    expect(h.created).toEqual([]);

    // The checkout delivers the page it was always going to; now there is nothing to repair.
    h.vault.addPage("Incoming.md");
    syncing = false;
    h.guard.resume();
    await settle();
    expect(h.created).toEqual([]);
  });

  it("adopts a folder held back by a flow when the flow leaves it orphaned", async () => {
    let syncing = true;
    const h = harness({ syncing: () => syncing });
    h.guard.check(folder(h.vault, "Left over"));
    await settle();
    expect(h.created).toEqual([]);

    syncing = false;
    h.guard.resume();
    await settle();
    expect(h.created).toEqual(["Left-over.md"]);
  });

  it("never overwrites a page that already holds the name the folder wants", async () => {
    const h = harness();
    h.vault.addPage("New-folder.md");
    h.guard.check(folder(h.vault, "New folder"));
    await settle();

    expect(h.created).toEqual([]);
    expect(h.renamed).toEqual([]);
  });

  it("produces a page the index reads back under the title the user typed", async () => {
    const h = harness();
    h.vault.addPage("Home.md");
    h.vault.writeOrder("", "Home");
    await h.index.rebuild();

    h.guard.check(folder(h.vault, "Release notes"));
    await settle();

    // The guard only creates the file. Telling the index and the OrderManager is the create
    // event's job in main.ts, so replay that here rather than assert a coupling it does not have.
    const page = asReal<TFile>(h.vault.getAbstractFileByPath("Release-notes.md"));
    await h.index.handleCreate(page);
    expect(h.index.forPath("Release-notes.md")?.title).toBe("Release notes");
    expect(h.index.forPath("Release-notes.md")?.wikiPath).toBe("/Release-notes");
  });
});
