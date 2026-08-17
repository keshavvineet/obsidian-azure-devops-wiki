import {
  App,
  debounce,
  type EventRef,
  Keymap,
  type PaneType,
  type TFile,
  WorkspaceLeaf,
} from "obsidian";
import type { ChangeKind } from "../git/gitStatus";
import { S } from "../strings";
import { stripMdExtension } from "./pageNameCodec";
import { PageIndex } from "../pages/pageIndex";
import { around } from "../util/around";
import { explorerLabel, ExplorerRowKind, rawExplorerLabel } from "./displayTitle";

/**
 * Shows decoded page titles where Obsidian would show encoded file names (FR-1.1):
 * file-explorer rows, tab headers and the window title.
 *
 * Obsidian has no API for either, so this module is the plugin's only patching of the host —
 * DOM text for the explorer, one wrapped method for tab titles (ARCHITECTURE §4.1). Both are
 * fully reversible: `disable()` puts every label and the original method back, which is what
 * makes the `decorateFileExplorer` setting a live toggle rather than a restart.
 *
 * It also collapses the **two rows Obsidian shows for one wiki page** (the reported behaviour
 * in note 1): a page with subpages is a `.md` file *and* a folder, so "1. Setup" appears twice.
 * Azure DevOps shows one expandable node whose label opens the page, and so does this — by
 * hiding the file row and making the folder row open the page, with its collapse arrow intact.
 *
 * Everything here degrades to "raw names are still readable" if Obsidian's internals move:
 * missing DOM classes just mean no relabelling, and the wrapped method falls through to the
 * original for anything that is not an indexed wiki page.
 */
const FILE_EXPLORER_VIEW = "file-explorer";
const ROW_SELECTOR = ".nav-file-title, .nav-folder-title";
const CONTENT_SELECTOR = ".nav-file-title-content, .nav-folder-title-content";
/** Marks rows this plugin relabelled, so `disable()` restores exactly those. */
const DECORATED_ATTR = "data-adowiki-decorated";
/** Marks the `.nav-file` wrapper of a page whose folder row stands in for it. */
const MERGED_ATTR = "data-adowiki-merged";
const MERGED_CLASS = "adowiki-merged-row";
const PAGE_FOLDER_CLASS = "adowiki-page-folder";
/** Marks the merged folder row of the page currently open, since Obsidian only marks file rows. */
const ACTIVE_PAGE_CLASS = "adowiki-active-page";
/**
 * The collapse arrow inside a row, in every spelling Obsidian has used for it.
 *
 * This selector is why a whole wiki became un-navigable once: Obsidian 1.13 builds the arrow as
 * `tree-item-icon collapse-icon` (verified in `obsidian.asar`, `setCollapsible`), and the older
 * `nav-folder-collapse-indicator` this once matched no longer exists — so every arrow click on a
 * page-with-subpages was treated as a click on the label and swallowed, and nothing in the
 * explorer could be expanded or collapsed any more. Match all of them, and never assume one.
 */
const COLLAPSE_SELECTOR =
  ".collapse-icon, .tree-item-icon, .nav-folder-collapse-indicator, .tree-item-flair-outer";
/** Set on a row whose page differs from what Azure DevOps has (note: round 3, item 8). */
const CHANGE_ATTR = "data-adowiki-change";
const CHANGED_CLASS = "adowiki-changed";
/** Obsidian's own heading-from-file-name element, in both edit and reading views. */
const INLINE_TITLE_SELECTOR = ".inline-title";
const INLINE_ATTR = "data-adowiki-inline-title";

export interface TitleDecoratorOptions {
  /** FR-1.1: show decoded titles in the explorer, tabs and window title. */
  decodeTitles: boolean;
  /** Note 1: one row per page, instead of a file row and a folder row for the same page. */
  singleRowPerPage: boolean;
  /**
   * Mark pages with local changes, the way an editor marks unsaved files. Returns the kind of
   * change for a vault path, or null for a page that matches Azure DevOps.
   */
  markChanges: boolean;
  changeKindOf: (vaultPath: string) => ChangeKind | null;
}

const ALL_OFF: TitleDecoratorOptions = {
  decodeTitles: false,
  singleRowPerPage: false,
  markChanges: false,
  changeKindOf: () => null,
};

export class TitleDecorator {
  private active = false;
  private restoreLeafTitles: (() => void) | null = null;
  /** One observer per explorer container, so closing a sidebar can release it again. */
  private readonly observers = new Map<HTMLElement, MutationObserver>();
  private readonly eventRefs: EventRef[] = [];
  /** Delegated so a row Obsidian rebuilds does not need its listener re-attached. */
  private readonly onExplorerClick = (event: MouseEvent): void => this.handleRowClick(event);

  /**
   * The explorer redraws in bursts (expanding a folder, a git pull landing 50 files), so
   * relabelling is coalesced instead of running once per mutation.
   */
  private readonly scheduleDecorate = debounce(() => {
    this.decorateExplorers();
    this.decorateInlineTitles();
  }, 50, true);

  constructor(
    private readonly app: App,
    private readonly index: PageIndex,
    private readonly options: () => TitleDecoratorOptions = () => ({
      decodeTitles: true,
      singleRowPerPage: false,
      markChanges: false,
      changeKindOf: () => null,
    }),
  ) {}

  get enabled(): boolean {
    return this.active;
  }

  /** Turn the whole surface on or off to match the settings — the live toggle from main.ts. */
  apply(): void {
    const { decodeTitles, singleRowPerPage, markChanges } = this.options();
    if (decodeTitles || singleRowPerPage || markChanges) {
      // Already on: the individual features read the settings on every pass, so a refresh
      // is all a changed toggle needs.
      if (this.active) this.refresh();
      else this.enable();
    } else {
      this.disable();
    }
  }

  enable(): void {
    if (this.active) return;
    this.active = true;

    this.patchLeafTitles();
    this.decorateExplorers();
    this.decorateInlineTitles();
    this.refreshHeaders();

    // New explorer leaves, reopened sidebars and workspace switches all surface here.
    this.eventRefs.push(this.app.workspace.on("layout-change", () => this.refresh()));
    // The inline title is re-rendered by Obsidian whenever a page is opened in a leaf.
    this.eventRefs.push(this.app.workspace.on("file-open", () => this.refresh()));
    this.eventRefs.push(this.app.workspace.on("active-leaf-change", () => this.refresh()));
  }

  disable(): void {
    if (!this.active) return;
    this.active = false;

    for (const ref of this.eventRefs) this.app.workspace.offref(ref);
    this.eventRefs.length = 0;

    for (const [container, observer] of this.observers) {
      observer.disconnect();
      container.removeEventListener("click", this.onExplorerClick, true);
    }
    this.observers.clear();

    this.restoreExplorers();
    this.restoreInlineTitles();
    this.restoreLeafTitles?.();
    this.restoreLeafTitles = null;
    this.refreshHeaders();
  }

  /** Re-apply after the index or the workspace changed. No-op while disabled. */
  refresh(): void {
    if (this.active) this.scheduleDecorate();
  }

  // ---------------------------------------------------------------- explorer

  private decorateExplorers(): void {
    this.pruneObservers();
    const options = this.active ? this.options() : ALL_OFF;
    const activePath = this.app.workspace.getActiveFile()?.path ?? null;

    for (const container of this.explorerContainers()) {
      this.observe(container);
      for (const row of rowsIn(container)) {
        const target = targetOf(row);
        if (!target) continue;

        this.relabel(row, target, options.decodeTitles);
        this.mergePairedRow(row, target, options.singleRowPerPage, activePath);
        this.markChange(row, target, options);
      }
    }
  }

  /**
   * A page that differs from Azure DevOps is marked in place, the way a code editor marks a
   * modified file — the reported ask was "show me what has not been synced yet, like VS Code".
   * A merged folder row carries the mark of the page it stands in for, because that row *is* the
   * page as far as the user is concerned.
   */
  private markChange(row: HTMLElement, target: RowTarget, options: TitleDecoratorOptions): void {
    const path =
      target.kind === "file" ? target.path : (this.pageForFolder(target.path)?.file.path ?? null);
    const kind = options.markChanges && path !== null ? options.changeKindOf(path) : null;

    if (kind === null) {
      if (row.hasAttribute(CHANGE_ATTR)) clearChangeMark(row);
      return;
    }
    if (row.getAttribute(CHANGE_ATTR) === kind) return;

    row.setAttribute(CHANGE_ATTR, kind);
    row.addClass(CHANGED_CLASS);
  }

  private relabel(row: HTMLElement, target: RowTarget, enabled: boolean): void {
    const label = enabled ? explorerLabel(target.path, target.kind) : null;
    if (label === null) {
      // A row we previously relabelled can stop qualifying (renamed to a plain title).
      if (row.hasAttribute(DECORATED_ATTR)) restoreRow(row, target);
      return;
    }

    if (target.contentEl.textContent !== label) target.contentEl.textContent = label;
    row.setAttribute(DECORATED_ATTR, "");
  }

  /**
   * One row per page: hide the `.md` row of a page that also has a folder, and mark the folder
   * row as standing in for it. Both are reversible class/attribute changes, and a page whose
   * paired folder is not on screen — or not in the index — is left exactly as Obsidian drew it.
   */
  private mergePairedRow(
    row: HTMLElement,
    target: RowTarget,
    enabled: boolean,
    activePath: string | null,
  ): void {
    if (target.kind === "file") {
      const wrapper = row.closest<HTMLElement>(".nav-file") ?? row;
      const merge = enabled && this.hasPairedFolder(target.path);
      wrapper.toggleClass(MERGED_CLASS, merge);
      if (merge) wrapper.setAttribute(MERGED_ATTR, "");
      else wrapper.removeAttribute(MERGED_ATTR);
      return;
    }

    const page = enabled ? this.pageForFolder(target.path) : null;
    row.toggleClass(PAGE_FOLDER_CLASS, page !== null);
    // Obsidian only ever highlights *file* rows, so a merged row would give no clue which page
    // is open — the reported "I cannot tell what is open now".
    row.toggleClass(ACTIVE_PAGE_CLASS, page !== null && page.file.path === activePath);
  }

  /**
   * Whether this page's subpage folder is present, which is what makes it a two-row page.
   * Asked once per explorer row on every repaint, so it must stay O(1) — see
   * `PageIndex.hasPagesInFolder`.
   */
  private hasPairedFolder(vaultPath: string): boolean {
    if (!vaultPath.toLowerCase().endsWith(".md")) return false;
    return this.index.hasPagesInFolder(stripMdExtension(vaultPath));
  }

  private pageForFolder(folderPath: string) {
    return this.index.forPath(`${folderPath}.md`);
  }

  /**
   * A click on a merged folder row opens the page. The collapse arrow keeps its own job —
   * without that exception there would be no way to expand the subpages at all.
   *
   * Two rules keep this from ever taking the explorer hostage again:
   *  - only a plain primary click is ours (`COLLAPSE_SELECTOR` and `button !== 0` fall through);
   *  - the click is suppressed with `preventDefault()` **only**, never `stopPropagation()`.
   *    Obsidian's own delegated explorer handler starts with `if (!e.defaultPrevented …)`
   *    (verified in `obsidian.asar`, `onFileClick`), so `preventDefault` is enough to claim the
   *    row while every other listener on it — the arrow, drag, selection — still runs.
   */
  private handleRowClick(event: MouseEvent): void {
    if (!this.active || !this.options().singleRowPerPage) return;
    if (event.button !== 0 || event.defaultPrevented) return;

    const target = event.target as HTMLElement | null;
    if (typeof target?.closest !== "function") return;
    const title = target.closest<HTMLElement>(`.nav-folder-title.${PAGE_FOLDER_CLASS}`);
    if (!title || target.closest(COLLAPSE_SELECTOR)) return;

    const folderPath = title.getAttribute("data-path");
    const page = folderPath === null ? null : this.pageForFolder(folderPath);
    if (!page) return;

    event.preventDefault();
    void this.openPage(page.file, Keymap.isModEvent(event));
  }

  /**
   * Open a page by its `TFile`, not by a link path.
   *
   * `openLinkText` would put the file name back through Obsidian's link resolver, and an ADO page
   * name is full of the characters that resolver treats as meaningful (`%3A`, `.`, `&`) — worse,
   * an unresolved link makes `openLinkText` *create* a file, which on a wiki is a commit. We
   * already hold the exact file from the index, so there is nothing to resolve.
   */
  private async openPage(file: TFile, newLeaf: PaneType | boolean): Promise<void> {
    const { workspace } = this.app;
    const leaf = workspace.getLeaf(newLeaf);
    await leaf.openFile(file);
    // What Obsidian's own explorer rows do after opening, so focus lands in the editor.
    workspace.setActiveLeaf(leaf, { focus: true });
  }

  // ----------------------------------------------------------- inline title

  /**
   * The heading Obsidian draws at the top of a page from its file name — the encoded
   * `7.2.1-EDI-group%3A-party-defaults` in the reported screenshot. It is a separate element from
   * the tab header, so patching `getDisplayText` never reached it.
   *
   * It is also *editable*, and typing in it renames the file: with a decoded title in there, one
   * stray keystroke would rename the page to something with a `:` in it, which Windows cannot
   * store and Azure DevOps cannot load. While decorated it is therefore read-only, and the
   * tooltip points at the Rename command — which encodes the name properly and fixes the links.
   */
  private decorateInlineTitles(): void {
    const enabled = this.active && this.options().decodeTitles;

    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const container = leaf.view?.containerEl;
      const path = filePathOf(leaf);
      if (!container) continue;

      for (const titleEl of Array.from(
        container.querySelectorAll<HTMLElement>(INLINE_TITLE_SELECTOR),
      )) {
        const title = enabled && path !== null ? (this.index.forPath(path)?.title ?? null) : null;
        if (title === null || title === rawInlineTitle(path)) {
          if (titleEl.hasAttribute(INLINE_ATTR)) restoreInlineTitle(titleEl, path);
          continue;
        }

        if (titleEl.textContent !== title) titleEl.textContent = title;
        titleEl.setAttribute(INLINE_ATTR, "");
        titleEl.setAttribute("contenteditable", "false");
        titleEl.setAttribute("aria-label", S.tree.renameHint);
      }
    }
  }

  private restoreInlineTitles(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const container = leaf.view?.containerEl;
      if (!container) continue;
      for (const titleEl of Array.from(
        container.querySelectorAll<HTMLElement>(`[${INLINE_ATTR}]`),
      )) {
        restoreInlineTitle(titleEl, filePathOf(leaf));
      }
    }
  }

  private restoreExplorers(): void {
    for (const container of this.explorerContainers()) {
      for (const row of Array.from(
        container.querySelectorAll<HTMLElement>(`[${DECORATED_ATTR}]`),
      )) {
        const target = targetOf(row);
        if (target) restoreRow(row, target);
        else row.removeAttribute(DECORATED_ATTR);
      }
      for (const merged of Array.from(
        container.querySelectorAll<HTMLElement>(`[${MERGED_ATTR}]`),
      )) {
        merged.removeClass(MERGED_CLASS);
        merged.removeAttribute(MERGED_ATTR);
      }
      for (const folder of Array.from(
        container.querySelectorAll<HTMLElement>(`.${PAGE_FOLDER_CLASS}`),
      )) {
        folder.removeClass(PAGE_FOLDER_CLASS);
        folder.removeClass(ACTIVE_PAGE_CLASS);
      }
      for (const changed of Array.from(
        container.querySelectorAll<HTMLElement>(`[${CHANGE_ATTR}]`),
      )) {
        clearChangeMark(changed);
      }
    }
  }

  private explorerContainers(): HTMLElement[] {
    const containers: HTMLElement[] = [];
    for (const leaf of this.app.workspace.getLeavesOfType(FILE_EXPLORER_VIEW)) {
      const container = leaf.view?.containerEl;
      if (container) containers.push(container);
    }
    return containers;
  }

  /**
   * Obsidian renders explorer rows lazily and rebuilds them on vault changes, so the labels
   * have to be re-applied whenever the DOM moves. Our own writes trigger the observer too;
   * the next pass finds the text already correct, writes nothing, and it settles there.
   */
  private observe(container: HTMLElement): void {
    if (this.observers.has(container)) return;

    const observer = new MutationObserver(() => this.scheduleDecorate());
    observer.observe(container, { childList: true, subtree: true });
    this.observers.set(container, observer);
    // Capture phase: Obsidian's own handler collapses the folder, and a merged row must open
    // the page instead.
    container.addEventListener("click", this.onExplorerClick, true);
  }

  /** Release observers whose explorer has been closed, instead of watching detached DOM. */
  private pruneObservers(): void {
    for (const [container, observer] of this.observers) {
      if (container.isConnected) continue;
      observer.disconnect();
      container.removeEventListener("click", this.onExplorerClick, true);
      this.observers.delete(container);
    }
  }

  // ------------------------------------------------------- tabs & window title

  private patchLeafTitles(): void {
    const index = this.index;
    const proto = WorkspaceLeaf.prototype as unknown as { getDisplayText: () => string };

    const decodes = (): boolean => this.options().decodeTitles;

    this.restoreLeafTitles = around(proto, "getDisplayText", (original) =>
      function (this: WorkspaceLeaf): string {
        if (!decodes()) return original.call(this);
        const path = filePathOf(this);
        const title = path === null ? null : (index.forPath(path)?.title ?? null);
        // Anything that is not an indexed wiki page keeps Obsidian's own title.
        return title ?? original.call(this);
      },
    );
  }

  /**
   * Repaint titles that Obsidian has already rendered. Both entry points are internal: tab
   * headers are refreshed per leaf, the window title by the workspace. When either is absent
   * the titles simply update on the next tab or file switch instead.
   */
  private refreshHeaders(): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const header = leaf as unknown as { updateHeader?: () => void };
      if (typeof header.updateHeader === "function") header.updateHeader();
    });

    const workspace = this.app.workspace as unknown as { updateTitle?: () => void };
    if (typeof workspace.updateTitle === "function") workspace.updateTitle();
  }
}

interface RowTarget {
  path: string;
  kind: ExplorerRowKind;
  contentEl: HTMLElement;
}

function rowsIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(ROW_SELECTOR));
}

function targetOf(row: HTMLElement): RowTarget | null {
  const path = row.getAttribute("data-path");
  const contentEl = row.querySelector<HTMLElement>(CONTENT_SELECTOR);
  if (!path || !contentEl) return null;

  return {
    path,
    kind: row.classList.contains("nav-folder-title") ? "folder" : "file",
    contentEl,
  };
}

/** Obsidian's own inline title: the file name without its extension. */
function rawInlineTitle(path: string | null): string {
  if (path === null) return "";
  return stripMdExtension(path.split("/").pop() ?? path);
}

function restoreInlineTitle(titleEl: HTMLElement, path: string | null): void {
  const raw = rawInlineTitle(path);
  if (raw.length > 0 && titleEl.textContent !== raw) titleEl.textContent = raw;
  titleEl.removeAttribute(INLINE_ATTR);
  // Obsidian sets this itself when it renders the element; putting it back is enough.
  titleEl.setAttribute("contenteditable", "true");
  titleEl.removeAttribute("aria-label");
}

function clearChangeMark(row: HTMLElement): void {
  row.removeAttribute(CHANGE_ATTR);
  row.removeClass(CHANGED_CLASS);
}

function restoreRow(row: HTMLElement, target: RowTarget): void {
  target.contentEl.textContent = rawExplorerLabel(target.path, target.kind);
  row.removeAttribute(DECORATED_ATTR);
}

/** The vault path shown in a leaf, for the file-backed views that have one. */
function filePathOf(leaf: WorkspaceLeaf): string | null {
  const view = leaf.view as unknown as { file?: { path?: unknown } | null } | undefined;
  const path = view?.file?.path;
  return typeof path === "string" ? path : null;
}
