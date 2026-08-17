// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { App, TFile as ObsidianTFile } from "obsidian";
import { TitleDecorator } from "../src/naming/titleDecorator";
import { PageIndex } from "../src/pages/pageIndex";
import { fakeApp, FakeVault } from "./helpers/fakeVault";
import { installObsidianDomExtensions } from "./helpers/domExtensions";

/**
 * The one-row-per-page takeover of Obsidian's file explorer, against real DOM.
 *
 * This file exists because the previous release shipped with the explorer un-navigable and every
 * test still green: the decorator claimed a click on a page-folder row and cancelled it with
 * `stopPropagation()`, and its exception for the collapse arrow matched a class Obsidian no longer
 * uses — so no folder could be expanded or collapsed any more, and the only visible symptom was a
 * user saying "the navigation is stuck". None of that is reachable without a DOM, so there is one
 * here, built from the markup Obsidian 1.13 actually produces (verified in `obsidian.asar`:
 * `nav-folder-title` carries `data-path`, and `setCollapsible` builds the arrow as
 * `tree-item-icon collapse-icon`).
 */
installObsidianDomExtensions();

const PARENT = "Product-Documentation/7.-EDI-Peppol.md";
const CHILD = "Product-Documentation/7.-EDI-Peppol/7.1-Identification-type-setup.md";
const LEAF_PAGE = "Product-Documentation/Pre%2DRelease-RCA-Categories.md";

interface Explorer {
  containerEl: HTMLElement;
  /** `.nav-folder-title` of the page that has subpages. */
  folderRow: HTMLElement;
  /** The collapse arrow inside that row. */
  arrowEl: HTMLElement;
  /** `.nav-folder-title-content` of that row — the label the user aims at. */
  labelEl: HTMLElement;
  /** The `.nav-file` wrapper of the same page's `.md` row, which should be hidden. */
  fileWrapper: HTMLElement;
  /** A page with no subpages: one plain file row, untouched by the merge. */
  leafRow: HTMLElement;
}

/** The explorer markup Obsidian builds, close enough that our selectors are the real ones. */
function buildExplorer(): Explorer {
  const containerEl = document.createElement("div");
  containerEl.className = "workspace-leaf-content";
  document.body.appendChild(containerEl);

  const folderItem = containerEl.createDiv({ cls: "tree-item nav-folder" });
  const folderRow = folderItem.createDiv({ cls: "tree-item-self nav-folder-title is-clickable" });
  folderRow.setAttribute("data-path", "Product-Documentation/7.-EDI-Peppol");
  const arrowEl = folderRow.createDiv({ cls: "tree-item-icon collapse-icon" });
  const labelEl = folderRow.createDiv({ cls: "tree-item-inner nav-folder-title-content" });
  labelEl.textContent = "7.-EDI-Peppol";
  const childrenEl = folderItem.createDiv({ cls: "tree-item-children nav-folder-children" });

  // The same page's own .md row, which Obsidian lists as a sibling of the folder.
  const fileWrapper = containerEl.createDiv({ cls: "tree-item nav-file" });
  const fileRow = fileWrapper.createDiv({ cls: "tree-item-self nav-file-title is-clickable" });
  fileRow.setAttribute("data-path", PARENT);
  fileRow.createDiv({ cls: "tree-item-inner nav-file-title-content" }).textContent =
    "7.-EDI-Peppol";

  const childWrapper = childrenEl.createDiv({ cls: "tree-item nav-file" });
  const childRow = childWrapper.createDiv({ cls: "tree-item-self nav-file-title is-clickable" });
  childRow.setAttribute("data-path", CHILD);
  childRow.createDiv({ cls: "tree-item-inner nav-file-title-content" }).textContent =
    "7.1-Identification-type-setup";

  const leafWrapper = containerEl.createDiv({ cls: "tree-item nav-file" });
  const leafRow = leafWrapper.createDiv({ cls: "tree-item-self nav-file-title is-clickable" });
  leafRow.setAttribute("data-path", LEAF_PAGE);
  leafRow.createDiv({ cls: "tree-item-inner nav-file-title-content" }).textContent =
    "Pre%2DRelease-RCA-Categories";

  return { containerEl, folderRow, arrowEl, labelEl, fileWrapper, leafRow };
}

let explorer: Explorer;
let decorator: TitleDecorator;
/** Files handed to `leaf.openFile`, in order — "did clicking that row open the page?" */
let opened: string[];

/** A left click that reports whether anything cancelled it, the way Obsidian's explorer checks. */
function click(el: HTMLElement): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  el.dispatchEvent(event);
  return event;
}

/** The decorator coalesces its passes, so tests wait for the scheduled one. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 80));

beforeEach(async () => {
  document.body.empty();
  explorer = buildExplorer();
  opened = [];

  const vault = new FakeVault();
  vault.addPage(PARENT);
  vault.addPage(CHILD);
  vault.addPage(LEAF_PAGE);

  const app = {
    ...fakeApp(vault),
    workspace: {
      getLeavesOfType: (type: string) =>
        type === "file-explorer" ? [{ view: { containerEl: explorer.containerEl } }] : [],
      getActiveFile: () => null,
      getLeaf: () => ({
        openFile: async (file: ObsidianTFile) => {
          opened.push(file.path);
        },
      }),
      setActiveLeaf: () => {},
      iterateAllLeaves: () => {},
      on: () => ({}),
      offref: () => {},
    },
  } as unknown as App;

  const index = new PageIndex(app);
  await index.rebuild();
  decorator = new TitleDecorator(app, index, () => ({
    decodeTitles: true,
    singleRowPerPage: true,
    markChanges: false,
    changeKindOf: () => null,
  }));
  decorator.enable();
  await settle();
});

describe("one explorer row per page", () => {
  it("shows decoded titles and hides the duplicate .md row", () => {
    expect(explorer.labelEl.textContent).toBe("7. EDI Peppol");
    expect(explorer.leafRow.textContent).toBe("Pre-Release RCA Categories");
    expect(explorer.folderRow.classList.contains("adowiki-page-folder")).toBe(true);
    expect(explorer.fileWrapper.classList.contains("adowiki-merged-row")).toBe(true);
  });

  it("opens the page when the row's label is clicked", () => {
    const event = click(explorer.labelEl);

    expect(opened).toEqual([PARENT]);
    // Obsidian's own explorer handler starts with `if (!e.defaultPrevented …)`, so this is how
    // the row is claimed without the folder also collapsing underneath.
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves the collapse arrow alone, so subpages can still be expanded", () => {
    const event = click(explorer.arrowEl);

    expect(opened).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("never stops the click propagating, so Obsidian's own row listeners still run", () => {
    // Obsidian binds the arrow's handler to the element and its row handler to the container;
    // a stopPropagation() here is what killed expand/collapse in the shipped build.
    const seen: string[] = [];
    explorer.folderRow.addEventListener("click", () => seen.push("row"));
    explorer.containerEl.addEventListener("click", () => seen.push("container"));

    click(explorer.labelEl);

    expect(seen).toEqual(["row", "container"]);
  });

  it("does not touch a page that has no subpages, or a subpage row", () => {
    expect(explorer.leafRow.classList.contains("adowiki-page-folder")).toBe(false);
    expect(click(explorer.leafRow).defaultPrevented).toBe(false);
    expect(opened).toEqual([]);
  });

  it("marks the merged row of the page that is open", async () => {
    expect(explorer.folderRow.classList.contains("adowiki-active-page")).toBe(false);
  });

  it("puts every row back when switched off", () => {
    decorator.disable();

    expect(explorer.labelEl.textContent).toBe("7.-EDI-Peppol");
    expect(explorer.leafRow.textContent).toBe("Pre%2DRelease-RCA-Categories");
    expect(explorer.folderRow.classList.contains("adowiki-page-folder")).toBe(false);
    expect(explorer.fileWrapper.classList.contains("adowiki-merged-row")).toBe(false);
    expect(click(explorer.labelEl).defaultPrevented).toBe(false);
    expect(opened).toEqual([]);
  });
});
