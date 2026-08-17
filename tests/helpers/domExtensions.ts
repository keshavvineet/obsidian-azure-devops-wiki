/**
 * Obsidian adds a handful of methods to `HTMLElement` at runtime (`addClass`, `createDiv`, …).
 * Plugin code uses them freely, so any test that drives real DOM has to install them first —
 * jsdom on its own does not have them and the calls would throw.
 *
 * Only the ones the code under test actually calls are here, and each is the documented
 * behaviour rather than a guess: `toggleClass(cls, on)` is unconditional (not a toggle),
 * `createDiv` returns the child, and `setAttr` is `setAttribute`.
 *
 * They are installed through a single `Record<string, unknown>` cast: the real Obsidian typings
 * already declare these on `HTMLElement` with overloads far wider than a test needs, and matching
 * those signatures exactly would mean writing a second implementation of Obsidian rather than a
 * stub. The cast keeps that fiction out of the plugin's own types (CLAUDE.md: cast stub-only
 * surface rather than weakening the config).
 */
interface ElementOptions {
  cls?: string;
  text?: string;
}

let installed = false;

export function installObsidianDomExtensions(): void {
  if (installed) return;
  installed = true;

  const createEl = function (
    this: HTMLElement,
    tag: string,
    options: string | ElementOptions = {},
  ): HTMLElement {
    const normalized: ElementOptions = typeof options === "string" ? { cls: options } : options;
    const el = this.ownerDocument.createElement(tag);
    if (normalized.cls) el.className = normalized.cls;
    if (normalized.text !== undefined) el.textContent = normalized.text;
    this.appendChild(el);
    return el;
  };

  const extensions: Record<string, unknown> = {
    addClass(this: HTMLElement, ...classes: string[]): void {
      this.classList.add(...classes.filter((cls) => cls.length > 0));
    },
    removeClass(this: HTMLElement, ...classes: string[]): void {
      this.classList.remove(...classes.filter((cls) => cls.length > 0));
    },
    toggleClass(this: HTMLElement, classes: string | string[], value: boolean): void {
      for (const cls of Array.isArray(classes) ? classes : [classes]) {
        if (cls.length > 0) this.classList.toggle(cls, value);
      }
    },
    hasClass(this: HTMLElement, cls: string): boolean {
      return this.classList.contains(cls);
    },
    setAttr(this: HTMLElement, name: string, value: string | number | boolean | null): void {
      if (value === null) this.removeAttribute(name);
      else this.setAttribute(name, String(value));
    },
    empty(this: HTMLElement): void {
      while (this.firstChild) this.removeChild(this.firstChild);
    },
    detach(this: HTMLElement): void {
      this.remove();
    },
    createEl,
    createDiv(this: HTMLElement, options: string | ElementOptions = {}): HTMLElement {
      return createEl.call(this, "div", options);
    },
    createSpan(this: HTMLElement, options: string | ElementOptions = {}): HTMLElement {
      return createEl.call(this, "span", options);
    },
  };

  Object.assign(HTMLElement.prototype as unknown as Record<string, unknown>, extensions);
}
