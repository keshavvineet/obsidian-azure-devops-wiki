import { describe, expect, it, vi } from "vitest";
import type { App, PluginManifest } from "obsidian";
import AdoWikiPlugin from "../src/main";
import { fakeApp, FakeVault } from "./helpers/fakeVault";

/** What the stub Plugin base class records; invisible on the real obsidian typings. */
interface PluginRecorder {
  commands: Array<{ id: string; name: string }>;
  registeredEvents: unknown[];
  registeredViews: Map<string, unknown>;
  ribbonIcons: string[];
  cleanups: Array<() => void>;
  markdownPostProcessors: unknown[];
  editorExtensions: unknown[];
}

const recorder = (plugin: AdoWikiPlugin): PluginRecorder =>
  plugin as unknown as PluginRecorder;

const MANIFEST = {
  id: "azure-devops-wiki",
  name: "Azure DevOps Wiki",
  author: "test",
  version: "0.0.0",
  minAppVersion: "1.5.0",
  description: "test",
} satisfies PluginManifest;

/**
 * Start-up smoke test: the plugin must load, register its commands, and build the index
 * without throwing. This is the failure mode that would otherwise only show up the first
 * time someone opens Obsidian.
 */
function setup() {
  const vault = new FakeVault();
  vault.addPage("Home.md");
  vault.addPage("Product-Documentation.md");
  vault.addPage("Product-Documentation/1.-Setup.md");
  vault.writeOrder("", "Home", "Product-Documentation");

  let layoutReady: (() => void) | null = null;
  const app = {
    ...fakeApp(vault),
    workspace: {
      onLayoutReady: (callback: () => void) => {
        layoutReady = callback;
      },
      getActiveFile: () => null,
      // Used by the title decorator; no explorer or tabs exist outside Obsidian.
      getLeavesOfType: () => [],
      iterateAllLeaves: () => {},
      on: () => ({}),
      offref: () => {},
    },
  };

  const plugin = new AdoWikiPlugin(app as unknown as App, MANIFEST);
  return { plugin, vault, runLayoutReady: () => layoutReady?.() };
}

describe("plugin load", () => {
  it("registers every page command", async () => {
    const { plugin } = setup();
    await plugin.onload();

    expect(recorder(plugin).commands.map((c) => c.id)).toEqual([
      "new-page",
      "new-subpage",
      "rename-page",
      "delete-page",
      "move-page-up",
      "move-page-down",
      "repair-order-files",
      "open-wiki-page",
      "open-wiki-tree",
      "open-wiki-changes",
      "open-page-activity",
      "refresh",
      "sync",
      "convert-page-links",
      "convert-vault-links",
      "lint-file",
      "lint-vault",
      "open-lint-results",
      "setup-check",
      "setup-wiki",
      "format-bold",
      "format-italic",
      "format-strikethrough",
      "format-inline-code",
      "format-code-block",
      "format-quote",
      "format-bullet-list",
      "format-numbered-list",
      "format-task-list",
      "format-horizontal-rule",
      "format-link",
      "format-table",
      "format-toc",
      "format-mermaid",
      "format-math",
      "format-heading-1",
      "format-heading-2",
      "format-heading-3",
      "format-heading-4",
      "format-heading-5",
      "format-heading-6",
      "format-heading-clear",
      "open-in-ado",
      "copy-ado-link",
      "copy-wiki-relative-path",
    ]);
    expect(recorder(plugin).commands.every((c) => c.name.length > 0)).toBe(true);
  });

  it("leaves the git surface off when the vault is not a folder on disk", async () => {
    const { plugin } = setup();
    await plugin.onload();

    // No FileSystemAdapter (as on mobile, or in tests) means no repository to talk to:
    // the commands still exist and explain themselves, but nothing else is created.
    expect(plugin.git).toBeNull();
    expect(plugin.syncOrchestrator).toBeNull();
    // The view ribbons are always there. Refresh and Publish have no ribbon icon at all — they
    // live on the toolbar above every page, in the changes pane and in the status bar's menu.
    expect(recorder(plugin).ribbonIcons).toEqual(["list-tree", "history", "message-square"]);
  });

  it("registers the four sidebar views and their ribbon icons", async () => {
    const { plugin } = setup();
    await plugin.onload();

    expect([...recorder(plugin).registeredViews.keys()]).toEqual([
      "adowiki-wiki-tree",
      "adowiki-lint",
      "adowiki-wiki-changes",
      "adowiki-page-activity",
    ]);
    expect(recorder(plugin).ribbonIcons).toEqual(["list-tree", "history", "message-square"]);
  });

  it("applies default settings when the plugin has no saved data", async () => {
    const { plugin } = setup();
    await plugin.onload();

    expect(plugin.settings.wikiBranch).toBe("wikiMain");
    expect(plugin.settings.repairOrderOnStartup).toBe(false);
    // Unattended publishing must be something the user opted into (FR-7.5).
    expect(plugin.settings.autoSyncOnClose).toBe(false);
    expect(plugin.settings.gitEnabled).toBe(true);
  });

  it("defers indexing until the workspace is ready, then indexes the vault", async () => {
    const { plugin, runLayoutReady } = setup();
    await plugin.onload();

    // Indexing before layout-ready would see a partial file list.
    expect(plugin.index.size).toBe(0);

    runLayoutReady();
    await vi.waitFor(() => expect(plugin.index.size).toBe(3));

    expect(plugin.index.rootPages().map((e) => e.title)).toEqual([
      "Home",
      "Product Documentation",
    ]);
  });

  it("subscribes to vault events only after the first index build", async () => {
    const { plugin, vault, runLayoutReady } = setup();
    await plugin.onload();
    expect(vault.listeners.size).toBe(0);

    runLayoutReady();
    await vi.waitFor(() => expect(vault.listeners.size).toBe(4));

    // 'modify' is the status bar's cue that there is unsynced work; the rest maintain the index.
    expect([...vault.listeners.keys()].sort()).toEqual([
      "create",
      "delete",
      "modify",
      "rename",
    ]);
    // Plus the workspace subscriptions registered during onload: 'quit', the paste and drop
    // handlers, insert-time wikilink conversion, 'active-leaf-change', 'file-menu', the toolbar's
    // own 'active-leaf-change' + 'layout-change', and the two that draw our sidebar panes when
    // they become visible ('active-leaf-change' + 'resize' — see registerSidebarMounting).
    expect(recorder(plugin).registeredEvents).toHaveLength(14);
  });

  it("registers the reading-mode processor and the live-preview extension", async () => {
    const { plugin } = setup();
    await plugin.onload();

    // Rendering is display-only, so it is always on; the individual features have settings.
    expect(recorder(plugin).markdownPostProcessors).toHaveLength(1);
    expect(recorder(plugin).editorExtensions).toHaveLength(1);
  });

  it("unloads without throwing, and undoes what it patched", async () => {
    const { plugin, runLayoutReady } = setup();
    await plugin.onload();
    runLayoutReady();
    await vi.waitFor(() => expect(plugin.index.size).toBe(3));

    expect(() => plugin.onunload()).not.toThrow();
    // Obsidian runs registered cleanups on unload; the title decoration is one of them.
    expect(() => recorder(plugin).cleanups.forEach((cleanup) => cleanup())).not.toThrow();
  });
});
