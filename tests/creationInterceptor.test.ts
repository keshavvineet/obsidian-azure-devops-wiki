import { describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { TFolder } from "obsidian";
import { CreationInterceptor } from "../src/pages/creationInterceptor";
import type { PageCommands } from "../src/pages/pageCommands";

/**
 * Obsidian's own **New note** / **New folder**, routed through the plugin's title prompt.
 *
 * The contract being protected is the one read out of `obsidian-1.13.6.asar`: these two methods
 * are what every route to a new file or folder funnels through, and the global
 * `file-explorer:new-folder` command dereferences the result's `.path` with **no null check**, so
 * they may never return null when they used to return an object.
 */
function asReal<T>(value: unknown): T {
  return value as T;
}

/** A fake vault + fileManager, plus a PageCommands whose prompt answers however the test says. */
function harness(options: { answer?: string | null; enabled?: boolean } = {}) {
  const answer = options.answer === undefined ? "My New Page" : options.answer;
  const originals: string[] = [];
  const files = new Map<string, { path: string; isFolder: boolean }>();

  const fileManager = {
    createNewMarkdownFile: async (_parent?: unknown, name?: string) => {
      originals.push(`file:${name ?? "Untitled"}`);
      return asReal<TFile>({ path: "Untitled.md" });
    },
    createNewFolder: async (_parent?: unknown) => {
      originals.push("folder:Untitled");
      return asReal<TFolder>({ path: "Untitled", children: [], isRoot: () => false });
    },
  };

  const app = asReal<App>({
    fileManager,
    vault: {
      getAbstractFileByPath: (path: string) => {
        const entry = files.get(path);
        if (!entry) return null;
        // The interceptor gates on `instanceof TFolder`, and the stub's TFolder is a real class.
        return entry.isFolder ? folderStub(path) : asReal<TFile>({ path });
      },
    },
  });

  const createPageByPrompt = vi.fn(async (folderPath: string, withSubpageFolder: boolean) => {
    if (answer === null) return null;
    const path = folderPath.length === 0 ? `${answer}.md` : `${folderPath}/${answer}.md`;
    files.set(path, { path, isFolder: false });
    if (withSubpageFolder) {
      const folder = path.slice(0, -3);
      files.set(folder, { path: folder, isFolder: true });
    }
    return asReal<TFile>({ path });
  });

  const interceptor = new CreationInterceptor(
    app,
    asReal<PageCommands>({ createPageByPrompt }),
    () => options.enabled ?? true,
  );

  return { app, fileManager, interceptor, createPageByPrompt, originals };
}

/**
 * `instanceof TFolder` is what the interceptor gates on, so this has to be a real instance of the
 * aliased stub — whose constructor takes a path, while the real typings' takes none.
 */
function folderStub(path: string): TFolder {
  const Stub = TFolder as unknown as new (path: string) => TFolder;
  return new Stub(path);
}

describe("CreationInterceptor", () => {
  it("asks for a title instead of creating Untitled.md", async () => {
    const h = harness();
    const restore = h.interceptor.install();

    const created = await h.fileManager.createNewMarkdownFile(null);

    expect(h.createPageByPrompt).toHaveBeenCalledWith("", false);
    expect(created?.path).toBe("My New Page.md");
    expect(h.originals).toEqual([]); // Obsidian's own path was never taken
    restore();
  });

  it("makes New folder into a page that owns a subpage folder", async () => {
    const h = harness();
    const restore = h.interceptor.install();

    const created = await h.fileManager.createNewFolder(null);

    expect(h.createPageByPrompt).toHaveBeenCalledWith("", true);
    // A folder is what the caller asked for and what it must be handed back.
    expect(created?.path).toBe("My New Page");
    restore();
  });

  it("never returns null, because file-explorer:new-folder dereferences .path", async () => {
    // Verified in obsidian-1.13.6.asar: the global command does
    // `ensureSideLeaf(…, {state: {newFile: t.path}})` with no null check.
    const h = harness({ answer: null });
    const restore = h.interceptor.install();

    expect(await h.fileManager.createNewFolder(null)).not.toBeNull();
    expect(await h.fileManager.createNewMarkdownFile(null)).not.toBeNull();
    // Cancelling falls back to Obsidian's own behaviour rather than creating nothing.
    expect(h.originals).toEqual(["folder:Untitled", "file:Untitled"]);
    restore();
  });

  it("leaves a caller that already knows the name alone", async () => {
    // createNewMarkdownFileFromLinktext makes the page behind a link; it is not a user gesture.
    const h = harness();
    const restore = h.interceptor.install();

    await h.fileManager.createNewMarkdownFile(null, "Linked Page");

    expect(h.createPageByPrompt).not.toHaveBeenCalled();
    expect(h.originals).toEqual(["file:Linked Page"]);
    restore();
  });

  it("still prompts when the name is the empty string Ctrl+N passes", async () => {
    // The regression this exists to stop: `file-explorer:new-file` calls
    // `createAndOpenMarkdownFile("", "tab")`, which forwards "" as the name. Treating any string
    // as "the caller knows the name" skipped the prompt on the commonest route of all, and the
    // unit test passed because it only ever exercised `undefined`. Caught in a real Obsidian.
    const h = harness();
    const restore = h.interceptor.install();

    await h.fileManager.createNewMarkdownFile(null, "");
    await h.fileManager.createNewMarkdownFile(null, "   ");

    expect(h.createPageByPrompt).toHaveBeenCalledTimes(2);
    expect(h.originals).toEqual([]);
    restore();
  });

  it("gives Obsidian's own dialogs back when the setting is off", async () => {
    const h = harness({ enabled: false });
    const restore = h.interceptor.install();

    await h.fileManager.createNewMarkdownFile(null);
    await h.fileManager.createNewFolder(null);

    expect(h.createPageByPrompt).not.toHaveBeenCalled();
    expect(h.originals).toEqual(["file:Untitled", "folder:Untitled"]);
    restore();
  });

  it("restores both methods on unload", async () => {
    const h = harness();
    const before = h.fileManager.createNewMarkdownFile;
    const beforeFolder = h.fileManager.createNewFolder;

    const restore = h.interceptor.install();
    expect(h.fileManager.createNewMarkdownFile).not.toBe(before);
    restore();

    expect(h.fileManager.createNewMarkdownFile).toBe(before);
    expect(h.fileManager.createNewFolder).toBe(beforeFolder);
  });

  it("loads without patching when the undocumented methods are gone", () => {
    // These are not in the public typings. Throwing here would run inside onload and take the
    // whole plugin down — decoration, rendering and git included — over an optional convenience.
    const missing = new CreationInterceptor(
      asReal<App>({ fileManager: {} }),
      asReal<PageCommands>({}),
      () => true,
    );
    expect(() => missing.install()()).not.toThrow();

    const noFileManager = new CreationInterceptor(
      asReal<App>({}),
      asReal<PageCommands>({}),
      () => true,
    );
    expect(() => noFileManager.install()()).not.toThrow();
  });
});
