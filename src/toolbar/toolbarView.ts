import { Editor, MarkdownView, Plugin, setIcon } from "obsidian";
import type { AttachmentPasteHandler } from "../links/pasteHandler";
import type { AdoWikiSettings } from "../settings";
import { S } from "../strings";
import * as actions from "./formatActions";

/**
 * A toolbar row above the editor reproducing ADO's own (FR-5.1–5.3).
 *
 * Obsidian has no official "toolbar above the editor" extension point, so this attaches a
 * plain element as the first child of every open `MarkdownView`'s content area — the same
 * kind of DOM patching `titleDecorator.ts` already does, and with the same guarantee: nothing
 * here can leave the host worse off than it found it, because `disable()` removes exactly the
 * elements this class added.
 */
export interface ToolbarDeps {
  plugin: Plugin;
  settings: () => AdoWikiSettings;
  attachments: AttachmentPasteHandler;
  /** Whether the work-item button should offer the suggester (a PAT is configured). */
  workItemsAvailable: () => boolean;
  /** Refresh/Publish, when the vault is a wiki clone with syncing switched on. */
  sync: SyncControls;
}

/**
 * What the two big sync buttons need to know and do. Deliberately a handful of callbacks rather
 * than the git stack itself: the toolbar has no business knowing what a commit is.
 */
export interface SyncControls {
  /** False when this vault has no repository, or syncing is switched off — buttons stay hidden. */
  available: () => boolean;
  busy: () => boolean;
  /**
   * Which button the user pressed, or null when idle. Both buttons are disabled while anything is
   * in flight, but only this one spins: a spinner means "I am doing what you asked", and a publish
   * that fetches on the way is still a publish (round 4, item 4).
   */
  busyAction: () => "refresh" | "publish" | null;
  /** Local edits that are not in Azure DevOps yet. */
  pending: () => number;
  /** Changes waiting in Azure DevOps, as of the last refresh. */
  incoming: () => number;
  refresh: () => void;
  publish: () => void;
}

const TOOLBAR_CLASS = "adowiki-toolbar";

/**
 * Obsidian's own view type for a tab with nothing open ("No file is open"). The toolbar mounts
 * there too so that Get updates / Publish are reachable at all times (round 4, item 2) — the
 * formatting half has no editor to act on and is disabled rather than absent, so the row does not
 * change shape as the user opens and closes pages.
 */
const EMPTY_VIEW = "empty";

interface MountedToolbar {
  el: HTMLElement;
  /** Re-reads the sync state into the two buttons; called whenever git status changes. */
  updateSync: () => void;
  /** Greys out the formatting controls when this toolbar has no editor behind it. */
  setEditing: (editing: boolean) => void;
}

export class ToolbarManager {
  private active = false;
  private readonly toolbars = new Map<HTMLElement, MountedToolbar>();

  constructor(private readonly deps: ToolbarDeps) {}

  get enabled(): boolean {
    return this.active;
  }

  enable(): void {
    if (this.active) return;
    this.active = true;

    const { plugin } = this.deps;
    plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", () => this.sync()));
    plugin.registerEvent(plugin.app.workspace.on("layout-change", () => this.sync()));
    this.sync();
  }

  disable(): void {
    if (!this.active) return;
    this.active = false;

    for (const toolbar of this.toolbars.values()) toolbar.el.remove();
    this.toolbars.clear();
  }

  /** Re-apply after the toolbar setting changed, without a reload. */
  refresh(): void {
    if (this.active) this.sync();
  }

  /** Called by the git status bar whenever it re-reads git, so the buttons stay truthful. */
  refreshSyncState(): void {
    for (const toolbar of this.toolbars.values()) toolbar.updateSync();
  }

  private sync(): void {
    const seen = new Set<HTMLElement>();
    const { workspace } = this.deps.plugin.app;

    for (const leaf of workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      seen.add(view.contentEl);
      this.attach(view.contentEl, () => view.editor);
    }
    // A tab with nothing open still gets the row, with only the sync half live. `View` has no
    // typed `contentEl` (only `ItemView` does) and the empty view is not one, so reach for its
    // content element through the DOM rather than casting the view.
    for (const leaf of workspace.getLeavesOfType(EMPTY_VIEW)) {
      const contentEl = leaf.view.containerEl.querySelector<HTMLElement>(":scope > .view-content");
      if (!contentEl) continue;
      seen.add(contentEl);
      this.attach(contentEl, () => null);
    }

    for (const [contentEl, toolbar] of this.toolbars) {
      if (seen.has(contentEl) && contentEl.isConnected) continue;
      toolbar.el.remove();
      this.toolbars.delete(contentEl);
    }
  }

  private attach(contentEl: HTMLElement, getEditor: () => Editor | null): void {
    const existing = this.toolbars.get(contentEl);
    if (existing?.el.isConnected) {
      existing.setEditing(getEditor() !== null);
      return;
    }

    const toolbar = buildToolbar(getEditor, this.deps);
    toolbar.setEditing(getEditor() !== null);
    contentEl.prepend(toolbar.el);
    this.toolbars.set(contentEl, toolbar);
  }
}

// ------------------------------------------------------------------------------ building

interface ButtonSpec {
  icon: string;
  label: string;
  run: (editor: Editor, deps: ToolbarDeps) => void;
}

const HEADING_LEVELS: ReadonlyArray<{ level: number; label: string }> = [
  { level: 0, label: "Normal text" },
  { level: 1, label: "Heading 1" },
  { level: 2, label: "Heading 2" },
  { level: 3, label: "Heading 3" },
  { level: 4, label: "Heading 4" },
  { level: 5, label: "Heading 5" },
  { level: 6, label: "Heading 6" },
];

const BUTTON_GROUPS: ButtonSpec[][] = [
  [
    { icon: "bold", label: S.toolbar.bold, run: (e) => actions.toggleBold(e) },
    { icon: "italic", label: S.toolbar.italic, run: (e) => actions.toggleItalic(e) },
    { icon: "strikethrough", label: S.toolbar.strikethrough, run: (e) => actions.toggleStrikethrough(e) },
  ],
  [
    { icon: "code", label: S.toolbar.inlineCode, run: (e) => actions.toggleInlineCode(e) },
    { icon: "square-code", label: S.toolbar.codeBlock, run: (e) => actions.insertCodeBlock(e) },
    { icon: "quote", label: S.toolbar.quote, run: (e) => actions.applyQuote(e) },
  ],
  [
    { icon: "list", label: S.toolbar.bulletList, run: (e) => actions.applyBulletList(e) },
    { icon: "list-ordered", label: S.toolbar.numberedList, run: (e) => actions.applyNumberedList(e) },
    { icon: "list-checks", label: S.toolbar.taskList, run: (e) => actions.applyTaskList(e) },
  ],
  [
    { icon: "table", label: S.toolbar.table, run: (e) => actions.insertTable(e) },
    { icon: "minus", label: S.toolbar.horizontalRule, run: (e) => actions.insertHorizontalRule(e) },
    { icon: "link", label: S.toolbar.link, run: (e) => actions.insertLink(e) },
  ],
  [
    { icon: "file-text", label: S.toolbar.toc, run: (e) => actions.insertToc(e) },
    { icon: "workflow", label: S.toolbar.mermaid, run: (e) => actions.insertMermaidBlock(e) },
    { icon: "sigma", label: S.toolbar.math, run: (e) => actions.insertMathBlock(e) },
  ],
];

function buildToolbar(getEditor: () => Editor | null, deps: ToolbarDeps): MountedToolbar {
  const toolbar = document.createElement("div");
  toolbar.className = TOOLBAR_CLASS;
  toolbar.setAttribute("data-adowiki-toolbar", "");
  toolbar.addEventListener("mousedown", (event) => {
    // Clicking a toolbar button must not steal focus from the editor before the command runs.
    if ((event.target as HTMLElement).tagName !== "SELECT") event.preventDefault();
  });

  const applyVisibility = (): void => {
    toolbar.toggleClass("adowiki-toolbar--hidden", !deps.settings().showToolbar);
  };
  applyVisibility();
  // No event to hook for a settings change here; the manager's refresh() rebuilds this whole
  // element, so the freshly-built one always reflects the current setting.

  /** Everything that needs an editor to do anything — disabled together. */
  const editingControls: Array<HTMLButtonElement | HTMLSelectElement> = [];

  const heading = buildHeadingDropdown(getEditor);
  editingControls.push(heading);
  toolbar.appendChild(heading);

  for (const group of BUTTON_GROUPS) {
    const groupEl = toolbar.createDiv({ cls: "adowiki-toolbar__group" });
    for (const spec of group) {
      const button = buildButton(spec, getEditor, deps);
      editingControls.push(button);
      groupEl.appendChild(button);
    }
  }

  const workItem = buildWorkItemButton(getEditor, deps);
  const image = buildImageButton(getEditor, deps);
  editingControls.push(workItem, image);
  toolbar.appendChild(workItem);
  toolbar.appendChild(image);

  // Pushed to the far end of the row: these two are not formatting, they are the wiki itself.
  const { el: syncEl, update: updateSync } = buildSyncGroup(deps);
  toolbar.appendChild(syncEl);
  updateSync();

  const setEditing = (editing: boolean): void => {
    toolbar.toggleClass("adowiki-toolbar--no-editor", !editing);
    for (const control of editingControls) control.disabled = !editing;
  };

  return { el: toolbar, updateSync, setEditing };
}

/**
 * The two buttons that move content between this folder and Azure DevOps (FR-7.1, FR-7.2).
 *
 * They repeat what the ribbon icons and the status bar already offer, on purpose: the people this
 * plugin is for do not know the ribbon exists, and "am I looking at the latest version" and "has
 * anyone else seen my edit" are the two questions they actually have. Each button carries a word,
 * a direction and — when there is something to do — a count.
 */
function buildSyncGroup(deps: ToolbarDeps): { el: HTMLElement; update: () => void } {
  const group = document.createElement("div");
  group.className = "adowiki-toolbar__sync";

  const pull = buildSyncButton("download-cloud", S.toolbar.getUpdates, () => deps.sync.refresh());
  const push = buildSyncButton("upload-cloud", S.toolbar.publish, () => deps.sync.publish());
  pull.el.addClass("adowiki-toolbar__sync-button--pull");
  push.el.addClass("adowiki-toolbar__sync-button--push");
  group.appendChild(pull.el);
  group.appendChild(push.el);

  const update = (): void => {
    const available = deps.sync.available();
    group.toggleClass("adowiki-toolbar__sync--hidden", !available);
    if (!available) return;

    const busy = deps.sync.busy();
    const action = deps.sync.busyAction();
    const incoming = deps.sync.incoming();
    const pending = deps.sync.pending();

    pull.setCount(incoming);
    pull.setTooltip(
      busy
        ? S.toolbar.syncBusy
        : incoming > 0
          ? S.toolbar.getUpdatesWaiting(incoming)
          : S.toolbar.getUpdatesHint,
    );
    // Disabled while either flow runs — spinning only for its own.
    pull.setDisabled(busy);
    pull.setBusy(action === "refresh");
    pull.setHighlighted(incoming > 0);

    push.setCount(pending);
    push.setTooltip(
      busy
        ? S.toolbar.syncBusy
        : pending > 0
          ? S.toolbar.publishPending(pending)
          : S.toolbar.publishNothing,
    );
    push.setDisabled(busy);
    push.setBusy(action === "publish");
    push.setHighlighted(pending > 0);
  };

  return { el: group, update };
}

interface SyncButton {
  el: HTMLElement;
  setCount: (count: number) => void;
  setTooltip: (text: string) => void;
  /** Spin this button's icon — only for the action the user actually started. */
  setBusy: (busy: boolean) => void;
  setDisabled: (disabled: boolean) => void;
  /** There is something to do in this direction. */
  setHighlighted: (highlighted: boolean) => void;
}

function buildSyncButton(icon: string, label: string, run: () => void): SyncButton {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "adowiki-toolbar__sync-button";

  const iconEl = button.createSpan({ cls: "adowiki-toolbar__sync-icon" });
  setIcon(iconEl, icon);
  button.createSpan({ cls: "adowiki-toolbar__sync-label", text: label });
  const countEl = button.createSpan({ cls: "adowiki-toolbar__sync-count" });
  countEl.hide();

  button.addEventListener("click", () => run());

  return {
    el: button,
    setCount: (count) => {
      countEl.setText(count > 0 ? String(count) : "");
      if (count > 0) countEl.show();
      else countEl.hide();
    },
    setTooltip: (text) => button.setAttribute("aria-label", text),
    setBusy: (busy) => button.toggleClass("is-busy", busy),
    setDisabled: (disabled) => {
      button.disabled = disabled;
    },
    setHighlighted: (highlighted) => button.toggleClass("is-highlighted", highlighted),
  };
}

function buildButton(
  spec: ButtonSpec,
  getEditor: () => Editor | null,
  deps: ToolbarDeps,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "adowiki-toolbar__button clickable-icon";
  button.setAttribute("aria-label", spec.label);
  setIcon(button, spec.icon);
  button.addEventListener("click", () => {
    const editor = getEditor();
    if (!editor) return; // no page open — the button is disabled, this is belt and braces
    spec.run(editor, deps);
    editor.focus();
  });
  return button;
}

function buildHeadingDropdown(getEditor: () => Editor | null): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "adowiki-toolbar__heading dropdown";
  select.setAttribute("aria-label", S.toolbar.heading);
  for (const { level, label } of HEADING_LEVELS) {
    const option = document.createElement("option");
    option.value = String(level);
    option.textContent = label;
    select.appendChild(option);
  }
  select.value = "0";
  select.addEventListener("change", () => {
    const level = Number(select.value);
    select.value = "0"; // the dropdown is an action, not a state — it always reads "Normal text"
    const editor = getEditor();
    if (!editor) return;
    actions.applyHeading(editor, level);
    editor.focus();
  });
  return select;
}

function buildWorkItemButton(
  getEditor: () => Editor | null,
  deps: ToolbarDeps,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "adowiki-toolbar__button clickable-icon";
  button.setAttribute(
    "aria-label",
    deps.workItemsAvailable() ? S.toolbar.workItemSearch : S.toolbar.workItem,
  );
  setIcon(button, "hash");
  button.addEventListener("click", () => {
    const editor = getEditor();
    if (!editor) return;
    // With no PAT configured the suggester stays off — this is then plain '#' typing (FR-5.2).
    editor.replaceSelection("#");
    editor.focus();
  });
  return button;
}

function buildImageButton(
  getEditor: () => Editor | null,
  deps: ToolbarDeps,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "adowiki-toolbar__button clickable-icon";
  button.setAttribute("aria-label", S.toolbar.image);
  setIcon(button, "image");

  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = false;
  input.style.display = "none";
  input.addEventListener("change", () => {
    const files = input.files ? Array.from(input.files) : [];
    input.value = "";
    const editor = getEditor();
    if (files.length === 0 || !editor) return;
    void deps.attachments.insertFiles(files, editor);
  });
  button.appendChild(input);
  button.addEventListener("click", () => input.click());
  return button;
}
