// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { RowKeyboardNav } from "../src/util/rowKeyboardNav";

/**
 * Keyboard navigation for the three sidebar panes, against real DOM.
 *
 * Asserting over a list of registered rows would prove nothing here: the behaviour that matters
 * is what `document.activeElement` and `tabIndex` do when a pane re-renders underneath the user,
 * and only a real document has either. This mirrors what the panes build — a container of rows,
 * emptied and rebuilt on every change.
 */
let container: HTMLElement;
let nav: RowKeyboardNav;

/** Rebuild the list from scratch, exactly as a pane's render() does. */
function render(keys: string[], options: { expandable?: string[]; expanded?: string[] } = {}) {
  const activated: string[] = [];
  nav.beginRender();
  container.replaceChildren();
  for (const key of keys) {
    const row = document.createElement("div");
    row.dataset.key = key;
    row.textContent = key;
    container.appendChild(row);
    const canExpand = options.expandable?.includes(key) ?? false;
    const isExpanded = options.expanded?.includes(key) ?? false;
    nav.register(row, key, {
      activate: () => activated.push(key),
      expand: canExpand && !isExpanded ? () => activated.push(`expand:${key}`) : undefined,
      collapse: isExpanded ? () => activated.push(`collapse:${key}`) : undefined,
    });
  }
  nav.endRender();
  return activated;
}

function rowFor(key: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-key="${key}"]`);
  if (!row) throw new Error(`No row for ${key}`);
  return row;
}

function press(key: string): void {
  const target = document.activeElement ?? container;
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

function focusedKey(): string | undefined {
  return (document.activeElement as HTMLElement | null)?.dataset?.key;
}

beforeEach(() => {
  document.body.replaceChildren();
  container = document.createElement("div");
  document.body.appendChild(container);
  nav = new RowKeyboardNav(container);
});

describe("RowKeyboardNav", () => {
  it("gives exactly one row the tab stop", () => {
    render(["a", "b", "c"]);

    expect(rowFor("a").tabIndex).toBe(0);
    expect(rowFor("b").tabIndex).toBe(-1);
    expect(rowFor("c").tabIndex).toBe(-1);
  });

  it("walks the list with the arrow keys and stops at both ends", () => {
    render(["a", "b", "c"]);
    rowFor("a").focus();

    press("ArrowDown");
    expect(focusedKey()).toBe("b");
    press("ArrowDown");
    expect(focusedKey()).toBe("c");
    // No wrap-around: Tab is how you leave the list, not another ArrowDown.
    press("ArrowDown");
    expect(focusedKey()).toBe("c");

    press("ArrowUp");
    expect(focusedKey()).toBe("b");
    press("Home");
    expect(focusedKey()).toBe("a");
    press("ArrowUp");
    expect(focusedKey()).toBe("a");
    press("End");
    expect(focusedKey()).toBe("c");
  });

  it("moves the tab stop with the caret", () => {
    render(["a", "b", "c"]);
    rowFor("a").focus();
    press("ArrowDown");

    expect(rowFor("a").tabIndex).toBe(-1);
    expect(rowFor("b").tabIndex).toBe(0);
  });

  it("activates a row on Enter and on Space", () => {
    const activated = render(["a", "b"]);
    rowFor("b").focus();

    press("Enter");
    press(" ");
    expect(activated).toEqual(["b", "b"]);
  });

  it("expands and collapses with the right and left arrows", () => {
    const collapsed = render(["a"], { expandable: ["a"] });
    rowFor("a").focus();
    press("ArrowRight");
    expect(collapsed).toEqual(["expand:a"]);

    const open = render(["a"], { expandable: ["a"], expanded: ["a"] });
    rowFor("a").focus();
    press("ArrowLeft");
    expect(open).toEqual(["collapse:a"]);
  });

  it("swallows the keys it handles, so Space does not scroll the pane", () => {
    render(["a", "b"]);
    rowFor("a").focus();
    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    rowFor("a").dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves keys it does not handle alone", () => {
    render(["a"]);
    rowFor("a").focus();
    const event = new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true });
    rowFor("a").dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("keeps the caret on the same row when the pane re-renders under it", () => {
    // A git pull, an .order write or a rescan rebuilds every row; without restoring focus by key
    // the caret lands back on <body> and keyboard navigation silently ends mid-list.
    render(["a", "b", "c"]);
    rowFor("b").focus();

    render(["a", "b", "c"]);
    expect(focusedKey()).toBe("b");
    expect(rowFor("b").tabIndex).toBe(0);
  });

  it("falls back to the first row when the one it was on has gone", () => {
    render(["a", "b", "c"]);
    rowFor("b").focus();

    render(["a", "c"]);
    expect(focusedKey()).toBe("a");
  });

  it("does not steal focus when the pane redraws in the background", () => {
    render(["a", "b"]);
    const elsewhere = document.createElement("input");
    document.body.appendChild(elsewhere);
    elsewhere.focus();

    render(["a", "b"]);
    expect(document.activeElement).toBe(elsewhere);
    // The tab stop is still placed, so Tab still enters the list at a sensible row.
    expect(rowFor("a").tabIndex).toBe(0);
  });

  it("adopts a row the user reached with the mouse", () => {
    render(["a", "b", "c"]);
    rowFor("c").focus();

    expect(rowFor("c").tabIndex).toBe(0);
    expect(rowFor("a").tabIndex).toBe(-1);
  });

  it("reacts to a key pressed on a child of the row, not only the row itself", () => {
    // Every pane builds rows out of nested spans, and that is what the event target will be.
    const activated = render(["a"]);
    const child = document.createElement("span");
    rowFor("a").appendChild(child);
    rowFor("a").focus();

    child.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(activated).toEqual(["a"]);
  });

  it("survives a render that produces no rows at all", () => {
    render(["a"]);
    rowFor("a").focus();

    expect(() => render([])).not.toThrow();
    expect(() => press("ArrowDown")).not.toThrow();
  });

  it("focuses a row by key, which is how the tree steps out to a parent", () => {
    render(["a", "b", "c"]);
    rowFor("c").focus();

    nav.focusKey("a");
    expect(focusedKey()).toBe("a");
    expect(rowFor("a").tabIndex).toBe(0);
  });
});
