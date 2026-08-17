import {
  ItemView,
  Keymap,
  Menu,
  Notice,
  type PaneType,
  setIcon,
  type TFile,
  type WorkspaceLeaf,
  debounce,
} from "obsidian";
import type { ChangeKind } from "../git/gitStatus";
import { stripMdExtension } from "../naming/pageNameCodec";
import type { OrderManager } from "../order/orderManager";
import { S } from "../strings";
import type { PageCommands } from "./pageCommands";
import type { PageEntry, PageIndex } from "./pageIndex";
import { buildWikiTree, DropPlace, namesWithDrop, WikiTreeNode } from "./treeModel";
import { RowKeyboardNav } from "../util/rowKeyboardNav";

export const WIKI_TREE_VIEW = "adowiki-wiki-tree";

export interface WikiTreeDeps {
  index: PageIndex;
  orderManager: OrderManager;
  pageCommands: PageCommands;
  /**
   * The kind of local change a page has, or null when it matches Azure DevOps — the tree marks
   * unpublished pages the way an editor marks modified files (round 3, item 8).
   */
  changeKindOf?: (vaultPath: string) => ChangeKind | null;
}

/**
 * "Wiki pages" sidebar: the page tree as Azure DevOps shows it (FR-2.3, FR-2.4).
 *
 * Obsidian's file explorer cannot express this tree — it shows folders and files side by side
 * in alphabetical order, while a wiki page and its paired subpage folder are one node whose
 * sequence lives in `.order`. This view reads that structure from the page index and writes
 * reordering straight back to `.order` through the OrderManager queue.
 *
 * Dragging reorders siblings; it deliberately cannot move a page to a different parent, which
 * in this format means renaming its file and folder and rewriting inbound links — that is what
 * the Rename command is for.
 */
export class WikiTreeView extends ItemView {
  private readonly index: PageIndex;
  private readonly orderManager: OrderManager;
  private readonly pageCommands: PageCommands;
  private readonly changeKindOf: (vaultPath: string) => ChangeKind | null;

  /** File paths of pages whose subpages are showing. */
  private readonly expanded = new Set<string>();
  private treeEl: HTMLElement | null = null;
  private dragged: PageEntry | null = null;
  private keyboard: RowKeyboardNav | null = null;

  /** Index changes arrive per file; a git pull or a repair sweep sends a burst of them. */
  private readonly scheduleRender = debounce(() => this.render(), 50, true);

  constructor(leaf: WorkspaceLeaf, deps: WikiTreeDeps) {
    super(leaf);
    this.index = deps.index;
    this.orderManager = deps.orderManager;
    this.pageCommands = deps.pageCommands;
    this.changeKindOf = deps.changeKindOf ?? (() => null);
  }

  /** Called after git status was re-read, so the change marks stay truthful. */
  onStatusChange(): void {
    this.scheduleRender();
  }

  override getViewType(): string {
    return WIKI_TREE_VIEW;
  }

  override getDisplayText(): string {
    return S.tree.title;
  }

  override getIcon(): string {
    return "list-tree";
  }

  override async onOpen(): Promise<void> {
    this.ensureMounted();
    this.revealActiveFile();
  }

  /**
   * Builds the pane's DOM and subscriptions, once, from whichever call gets here first.
   *
   * This is deliberately **not** left to `onOpen` alone. Reproduced under CDP against a real
   * Obsidian 1.12.7: a sidebar leaf holding this view can end up with the real `WikiTreeView`
   * constructed and `isDeferred === false` while `onOpen()` was **never called** — so `treeEl`
   * stayed null, `render()` returned at its first line, and the pane was simply empty. The tree
   * itself was never at fault: calling `onOpen()` by hand on the same view drew all seven rows.
   *
   * Obsidian defers sidebar views that are not visible (1.7.2+) and swaps the real view in later;
   * whatever the exact path, a view that cannot draw itself unless the host calls one specific
   * hook is a view that silently shows nothing. So mounting is idempotent and every entry point
   * (`onOpen`, `render`, `revealActiveFile`, `onResize`) asks for it first.
   */
  private ensureMounted(): void {
    // Deliberately a plain non-null check. Testing `isConnected` here looks tempting but is
    // wrong: at `onOpen` time the view's own element is **not yet** in the document, so an
    // `isConnected` guard turns `onOpen` into a no-op and the pane never mounts at all.
    if (this.treeEl) return;

    this.contentEl.empty();
    this.contentEl.addClass("adowiki-tree");
    this.treeEl = this.contentEl.createDiv({ cls: "adowiki-tree__root" });
    this.treeEl.setAttribute("role", "tree");
    this.keyboard = new RowKeyboardNav(this.treeEl);

    this.register(this.index.onChange(() => this.scheduleRender()));
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file) this.expandAncestorsOf(file);
        this.scheduleRender();
      }),
    );
  }

  /**
   * Called when the pane is resized — including when a collapsed sidebar is opened, which is the
   * moment a view the host never called `onOpen` on becomes visible to the user.
   */
  override onResize(): void {
    if (this.treeEl) return;
    this.render();
  }

  /**
   * Draw, whether or not the host has called any lifecycle hook on this view.
   *
   * `main.ts` calls this whenever a wiki-tree leaf becomes the active one. That is the case
   * `ensureMounted` alone cannot cover: on a leaf **restored from the saved workspace**,
   * `revealLeaf` swaps the real view in and calls nothing on it, so there is no `onOpen`, no
   * `onResize` and no `render` to hang the mount off — the pane just stays blank. Verified under
   * CDP; the freshly-created leaf that the *command* builds does get `onOpen`, which is why this
   * was missed the first time.
   */
  ensureVisible(): void {
    this.render();
  }

  override async onClose(): Promise<void> {
    this.contentEl.empty();
    this.treeEl = null;
    this.keyboard = null;
  }

  /** Expand down to the active page and redraw — used when the view is opened or revealed. */
  revealActiveFile(): void {
    this.ensureMounted();
    const file = this.app.workspace.getActiveFile();
    if (file) this.expandAncestorsOf(file);
    this.render();
  }

  // --------------------------------------------------------------- rendering

  private render(): void {
    this.ensureMounted();
    const treeEl = this.treeEl;
    if (!treeEl) return;

    const byFolder = this.index.pagesByFolder();
    const nodes = buildWikiTree<PageEntry>({
      pagesIn: (folderPath) => byFolder.get(folderPath) ?? [],
      // A page's subpages live in the folder that pairs with its file name.
      subfolderOf: (entry) => stripMdExtension(entry.file.path),
      isExpanded: (entry) => this.expanded.has(entry.file.path),
    });

    this.keyboard?.beginRender();
    treeEl.empty();
    if (nodes.length === 0) {
      treeEl.createDiv({ cls: "adowiki-tree__empty", text: S.tree.empty });
      treeEl.createDiv({ cls: "adowiki-tree__empty-hint", text: S.tree.emptyHint });
      this.keyboard?.endRender();
      return;
    }

    const activePath = this.app.workspace.getActiveFile()?.path ?? null;
    for (const node of nodes) this.renderNode(node, treeEl, activePath);
    this.keyboard?.endRender();
  }

  private renderNode(
    node: WikiTreeNode<PageEntry>,
    parentEl: HTMLElement,
    activePath: string | null,
  ): void {
    const entry = node.item;
    const expanded = this.expanded.has(entry.file.path);

    const itemEl = parentEl.createDiv({ cls: "tree-item adowiki-tree__item" });
    const rowEl = itemEl.createDiv({ cls: "tree-item-self is-clickable adowiki-tree__row" });
    rowEl.style.setProperty("--adowiki-tree-depth", String(node.depth));
    rowEl.dataset.path = entry.file.path;
    if (entry.file.path === activePath) rowEl.addClass("is-active");

    const change = this.changeKindOf(entry.file.path);
    if (change !== null) {
      rowEl.addClass("adowiki-changed");
      rowEl.dataset.adowikiChange = change;
    }

    if (node.hasChildren) {
      const iconEl = rowEl.createDiv({ cls: "tree-item-icon adowiki-tree__toggle" });
      // Explicit icons rather than a rotated chevron: no dependence on theme CSS.
      setIcon(iconEl, expanded ? "chevron-down" : "chevron-right");
      iconEl.setAttribute("aria-label", expanded ? S.tree.collapse : S.tree.expand);
      iconEl.addEventListener("click", (event) => {
        event.stopPropagation();
        this.toggle(entry);
      });
    } else {
      rowEl.createDiv({ cls: "adowiki-tree__toggle adowiki-tree__toggle--leaf" });
    }

    rowEl.createDiv({ cls: "tree-item-inner adowiki-tree__title", text: entry.title });

    rowEl.addEventListener("click", (event) => void this.open(entry, Keymap.isModEvent(event)));
    rowEl.addEventListener("auxclick", (event) => {
      if (event.button === 1) void this.open(entry, true); // middle click = new tab
    });
    rowEl.addEventListener("contextmenu", (event) => this.showMenu(event, entry));
    this.attachDragHandlers(rowEl, entry);

    rowEl.setAttribute("role", "treeitem");
    if (node.hasChildren) rowEl.setAttribute("aria-expanded", String(expanded));
    this.keyboard?.register(rowEl, entry.file.path, {
      // Keymap reads the modifiers off a keyboard event exactly as it does off a click, so
      // Ctrl+Enter opens in a new tab here for the same reason Ctrl+click does.
      activate: (event) => void this.open(entry, Keymap.isModEvent(event)),
      expand: node.hasChildren && !expanded ? () => this.toggle(entry) : undefined,
      // Standard tree behaviour: Left closes an open page, and on one that is already closed it
      // steps out to the parent — which is how you get back up a deep wiki without the mouse.
      collapse:
        node.hasChildren && expanded
          ? () => this.toggle(entry)
          : () => {
              const parent = this.index.parentOf(entry);
              if (parent) this.keyboard?.focusKey(parent.file.path);
            },
      menu: (el) => this.showMenuAt(el, entry),
    });

    if (node.children.length === 0) return;
    const childrenEl = itemEl.createDiv({ cls: "tree-item-children adowiki-tree__children" });
    for (const child of node.children) this.renderNode(child, childrenEl, activePath);
  }

  // ---------------------------------------------------------------- behaviour

  private toggle(entry: PageEntry): void {
    if (this.expanded.has(entry.file.path)) this.expanded.delete(entry.file.path);
    else this.expanded.add(entry.file.path);
    this.render();
  }

  /** `newLeaf` comes straight from Obsidian's modifier-key reading (tab, split, window). */
  private async open(entry: PageEntry, newLeaf: PaneType | boolean): Promise<void> {
    await this.app.workspace.getLeaf(newLeaf).openFile(entry.file);
  }

  private expandAncestorsOf(file: TFile): void {
    let entry = this.index.forPath(file.path);
    while (entry) {
      const parent = this.index.parentOf(entry);
      if (!parent) return;
      this.expanded.add(parent.file.path);
      entry = parent;
    }
  }

  private showMenu(event: MouseEvent, entry: PageEntry): void {
    event.preventDefault();
    this.buildMenu(entry).showAtMouseEvent(event);
  }

  /** The same menu from the keyboard, anchored under the row instead of under the pointer. */
  private showMenuAt(rowEl: HTMLElement, entry: PageEntry): void {
    const rect = rowEl.getBoundingClientRect();
    this.buildMenu(entry).showAtPosition({ x: rect.left, y: rect.bottom });
  }

  private buildMenu(entry: PageEntry): Menu {
    const { index: position, total } = this.pageCommands.positionOf(entry);

    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(S.menu.openInNewTab)
        .setIcon("file-plus")
        .onClick(() => void this.open(entry, true)),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(S.menu.newSubpage)
        .setIcon("plus")
        .onClick(() => this.pageCommands.promptNewSubpageFor(entry)),
    );
    menu.addItem((item) =>
      item
        .setTitle(S.menu.rename)
        .setIcon("pencil")
        .onClick(() => this.pageCommands.promptRenameFor(entry)),
    );
    menu.addItem((item) =>
      item
        .setTitle(S.menu.delete)
        .setIcon("trash")
        .onClick(() => this.pageCommands.promptDeleteFor(entry)),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(S.menu.moveUp)
        .setIcon("arrow-up")
        .setDisabled(position <= 0)
        .onClick(() => void this.pageCommands.movePage(entry, -1)),
    );
    menu.addItem((item) =>
      item
        .setTitle(S.menu.moveDown)
        .setIcon("arrow-down")
        .setDisabled(position === -1 || position >= total - 1)
        .onClick(() => void this.pageCommands.movePage(entry, 1)),
    );

    // The wiki home page is the first entry of the root .order — only root pages qualify.
    if (entry.folderPath === "") {
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle(S.menu.setHomePage)
          .setIcon("home")
          .setDisabled(position === 0)
          .onClick(() => void this.pageCommands.setHomePage(entry)),
      );
    }

    return menu;
  }

  // -------------------------------------------------------------- drag & drop

  private attachDragHandlers(rowEl: HTMLElement, entry: PageEntry): void {
    rowEl.draggable = true;

    rowEl.addEventListener("dragstart", (event) => {
      this.dragged = entry;
      rowEl.addClass("adowiki-tree__row--dragging");
      if (!event.dataTransfer) return;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", entry.title);
    });

    rowEl.addEventListener("dragend", () => {
      this.dragged = null;
      rowEl.removeClass("adowiki-tree__row--dragging");
      this.clearDropMarks();
    });

    rowEl.addEventListener("dragover", (event) => {
      if (!this.canDropOn(entry)) return; // no preventDefault → the cursor says "not here"
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      this.markDropTarget(rowEl, placeFor(event, rowEl));
    });

    rowEl.addEventListener("dragleave", () => this.clearDropMarks(rowEl));

    rowEl.addEventListener("drop", (event) => {
      event.preventDefault();
      void this.handleDrop(entry, placeFor(event, rowEl));
    });
  }

  /** Reordering only works between siblings; anything else would be a move (see class docs). */
  private canDropOn(target: PageEntry): boolean {
    const dragged = this.dragged;
    return (
      dragged !== null &&
      dragged.file.path !== target.file.path &&
      dragged.folderPath === target.folderPath
    );
  }

  private async handleDrop(target: PageEntry, place: DropPlace): Promise<void> {
    const dragged = this.dragged;
    this.dragged = null;
    this.clearDropMarks();
    if (!dragged || dragged.folderPath !== target.folderPath) return;

    const moved = namesWithDrop(
      this.index.pageNamesInFolder(target.folderPath),
      dragged.name,
      target.name,
      place,
    );
    if (!moved) return;
    await this.reorder(target.folderPath, moved);
  }

  private async reorder(folderPath: string, orderedNames: string[]): Promise<void> {
    try {
      // Writing .order refreshes the index, which redraws this view.
      await this.orderManager.reorder(folderPath, orderedNames);
    } catch (error) {
      new Notice(S.notices.failed("save the page order", messageOf(error)));
      this.render();
    }
  }

  private markDropTarget(rowEl: HTMLElement, place: DropPlace): void {
    this.clearDropMarks();
    rowEl.addClass(place === "before" ? DROP_BEFORE : DROP_AFTER);
  }

  private clearDropMarks(only?: HTMLElement): void {
    const rows = only
      ? [only]
      : Array.from(
          this.contentEl.querySelectorAll<HTMLElement>(`.${DROP_BEFORE}, .${DROP_AFTER}`),
        );
    for (const rowEl of rows) {
      rowEl.removeClass(DROP_BEFORE);
      rowEl.removeClass(DROP_AFTER);
    }
  }
}

const DROP_BEFORE = "adowiki-tree__row--drop-before";
const DROP_AFTER = "adowiki-tree__row--drop-after";

/** Above the midpoint of the row drops before it, below drops after it. */
function placeFor(event: DragEvent, rowEl: HTMLElement): DropPlace {
  const rect = rowEl.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
