/**
 * Keyboard navigation for the plugin's three list panes — wiki pages, compatibility results and
 * wiki changes (FR-2.4; PLAN §4). One helper for all three, because they are the same interaction:
 * a vertical list of rows, one of which is "current", operated with the arrow keys.
 *
 * Each pane rebuilds its rows from scratch on every change — a git pull, a `.order` write, a
 * rescan — so the two hard parts are both about survival across a redraw:
 *
 *  - **The tab stop.** Rows carry a roving `tabindex`: exactly one row is 0 and the rest are -1,
 *    so Tab enters the list at the row the user was last on and leaves it in one press, rather
 *    than walking through every page in the wiki.
 *  - **Focus itself.** Re-rendering destroys the focused element, which sends focus back to
 *    `<body>` and silently ends keyboard navigation mid-list. Rows are therefore identified by a
 *    caller-supplied key rather than by element, and focus is restored to the row with the same
 *    key — but *only* when the pane had focus before the redraw, so a background refresh never
 *    steals the caret out of the editor.
 *
 * No Obsidian imports: this is DOM only, which is what lets it be tested in jsdom against the
 * markup the panes really build.
 */
export interface RowActions {
  /** Enter or Space. The event is passed on so a modifier can still open in a new tab. */
  activate?: (event: KeyboardEvent) => void;
  /** ArrowRight on a collapsed row. Omit for a row that cannot expand. */
  expand?: () => void;
  /** ArrowLeft on an expanded row. Omit for a row that cannot collapse. */
  collapse?: () => void;
  /** The context-menu key, so every mouse-only right-click menu has a keyboard route. */
  menu?: (rowEl: HTMLElement) => void;
}

interface Row {
  key: string;
  el: HTMLElement;
  actions: RowActions;
}

export class RowKeyboardNav {
  private rows: Row[] = [];
  /** The row that holds the tab stop, by key — an element would not survive a redraw. */
  private currentKey: string | null = null;
  /** Whether the caret was inside this pane when the current render pass started. */
  private hadFocus = false;

  constructor(private readonly containerEl: HTMLElement) {
    // One delegated listener rather than one per row: the panes re-render constantly, and a
    // listener per row would have to be torn down in step with elements they no longer own.
    this.containerEl.addEventListener("keydown", (event) => this.onKeyDown(event));
    // Clicking a row makes it the tab stop too, so mouse and keyboard do not disagree.
    this.containerEl.addEventListener(
      "focusin",
      (event) => {
        const row = this.rowContaining(event.target);
        if (row) this.setCurrent(row.key);
      },
      // Capture: some rows stop propagation of their own events.
      true,
    );
  }

  /**
   * Call at the start of a render pass, **before** the container is emptied.
   *
   * Whether the pane held the caret has to be read here and not in `endRender`: emptying the
   * container detaches the focused row, which sends `document.activeElement` back to `<body>`, so
   * by the end of the pass every render looks like a background one and focus is never restored.
   */
  beginRender(): void {
    this.rows = [];
    this.hadFocus = this.containerEl.contains(this.containerEl.ownerDocument.activeElement);
  }

  /**
   * Call for each row as it is built, in the order it appears on screen.
   *
   * @param key stable across redraws — a vault path, a finding id, a commit sha.
   */
  register(rowEl: HTMLElement, key: string, actions: RowActions = {}): void {
    rowEl.tabIndex = -1;
    this.rows.push({ key, el: rowEl, actions });
  }

  /**
   * Call at the end of a render pass: puts the tab stop back, and the caret with it when the
   * pane is where the user was working.
   */
  endRender(): void {
    if (this.rows.length === 0) {
      this.currentKey = null;
      return;
    }
    // The row that was current may have been deleted, renamed or filtered out of the list.
    const kept = this.rows.find((row) => row.key === this.currentKey) ?? this.rows[0];

    this.currentKey = kept.key;
    for (const row of this.rows) row.el.tabIndex = row === kept ? 0 : -1;
    if (this.hadFocus) kept.el.focus();
  }

  /** Move the caret to a row by key, if it is currently on screen. */
  focusKey(key: string): void {
    this.focusRow(this.rows.find((row) => row.key === key));
  }

  private onKeyDown(event: KeyboardEvent): void {
    const row = this.rowContaining(event.target);
    if (!row) return;

    switch (event.key) {
      case "ArrowDown":
        this.moveBy(row, 1);
        break;
      case "ArrowUp":
        this.moveBy(row, -1);
        break;
      case "Home":
        this.focusRow(this.rows[0]);
        break;
      case "End":
        this.focusRow(this.rows[this.rows.length - 1]);
        break;
      case "ArrowRight":
        // Nothing to expand means the row is a leaf; falling through to the next row would
        // duplicate ArrowDown, so a leaf simply does nothing.
        if (!row.actions.expand) return;
        row.actions.expand();
        break;
      case "ArrowLeft":
        if (!row.actions.collapse) return;
        row.actions.collapse();
        break;
      case "Enter":
      case " ":
        if (!row.actions.activate) return;
        row.actions.activate(event);
        break;
      case "ContextMenu":
        if (!row.actions.menu) return;
        row.actions.menu(row.el);
        break;
      default:
        return;
    }
    // Only reached when the key was handled — Obsidian binds several of these globally, and
    // Space would otherwise scroll the pane underneath us.
    event.preventDefault();
    event.stopPropagation();
  }

  private moveBy(from: Row, delta: number): void {
    const next = this.rows[this.rows.indexOf(from) + delta];
    // Deliberately no wrap-around: at the ends, Tab and Shift+Tab are how you leave the list.
    if (next) this.focusRow(next);
  }

  private focusRow(row: Row | undefined): void {
    if (!row) return;
    this.setCurrent(row.key);
    row.el.focus();
  }

  private setCurrent(key: string): void {
    if (this.currentKey === key) return;
    this.currentKey = key;
    for (const row of this.rows) row.el.tabIndex = row.key === key ? 0 : -1;
  }

  private rowContaining(target: EventTarget | null): Row | undefined {
    if (!(target instanceof Node)) return undefined;
    return this.rows.find((row) => row.el === target || row.el.contains(target));
  }
}
