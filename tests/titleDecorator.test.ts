import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { TitleDecorator } from "../src/naming/titleDecorator";
import { PageIndex } from "../src/pages/pageIndex";
import { fakeApp, FakeVault } from "./helpers/fakeVault";
import { WorkspaceLeaf } from "./stubs/obsidian";

/**
 * Tab-header decoration (FR-1.1). The explorer half is DOM patching and is verified manually
 * in the fixture vault; what is testable here — and what actually risks breaking Obsidian — is
 * the wrapped `WorkspaceLeaf.getDisplayText`: it must decorate wiki pages, leave every other
 * view alone, and come back off cleanly when the setting is turned off.
 */
let vault: FakeVault;
let decorator: TitleDecorator;

/** A leaf showing a file, as far as the decorator can tell. */
function leafShowing(path: string | null): WorkspaceLeaf {
  const leaf = new WorkspaceLeaf();
  leaf.view = path === null ? null : { file: { path } };
  return leaf;
}

beforeEach(async () => {
  vault = new FakeVault();
  vault.addPage("Home.md");
  vault.addPage("Pre%2DRelease-RCA-Categories.md");
  vault.writeOrder("", "Home", "Pre%2DRelease-RCA-Categories");

  const app = {
    ...fakeApp(vault),
    workspace: {
      getLeavesOfType: () => [],
      getActiveFile: () => null,
      iterateAllLeaves: () => {},
      on: () => ({}),
      offref: () => {},
    },
  } as unknown as App;

  const index = new PageIndex(app);
  await index.rebuild();
  decorator = new TitleDecorator(app, index);
});

// WorkspaceLeaf.prototype is shared by the whole process, so a decorator left enabled would
// still be decorating during the next test.
afterEach(() => decorator.disable());

describe("TitleDecorator", () => {
  it("shows the decoded title in a page's tab", () => {
    decorator.enable();
    expect(leafShowing("Pre%2DRelease-RCA-Categories.md").getDisplayText()).toBe(
      "Pre-Release RCA Categories",
    );
  });

  it("leaves views that are not wiki pages to Obsidian", () => {
    decorator.enable();
    expect(leafShowing("Untracked-Notes.txt").getDisplayText()).toBe("raw");
    expect(leafShowing(null).getDisplayText()).toBe("raw"); // graph view, settings, …
  });

  it("restores the original title when the setting is turned off", () => {
    decorator.enable();
    decorator.disable();

    expect(leafShowing("Pre%2DRelease-RCA-Categories.md").getDisplayText()).toBe("raw");
    expect(decorator.enabled).toBe(false);
  });

  it("survives repeated enable and disable calls", () => {
    decorator.enable();
    decorator.enable();
    decorator.disable();
    decorator.disable();
    decorator.enable();

    expect(leafShowing("Home.md").getDisplayText()).toBe("Home");
    decorator.disable();
    expect(leafShowing("Home.md").getDisplayText()).toBe("raw");
  });

  it("does nothing when refreshed while disabled", () => {
    expect(() => decorator.refresh()).not.toThrow();
    expect(leafShowing("Home.md").getDisplayText()).toBe("raw");
  });
});
