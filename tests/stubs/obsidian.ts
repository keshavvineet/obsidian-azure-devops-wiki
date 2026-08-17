/**
 * Minimal stand-ins for the Obsidian runtime classes. vitest aliases the 'obsidian' module
 * to this file (see vitest.config.ts) so that `instanceof TFile` checks inside the plugin
 * resolve against the same classes the tests construct.
 *
 * Type-checking still happens against the real obsidian typings: tests cast these fakes
 * with `as unknown as App`, so a drift in the real API surfaces in `npm run build`.
 */
import { StateField } from "@codemirror/state";

export class TAbstractFile {
  parent: TFolder | null = null;

  constructor(public path: string) {}

  get name(): string {
    const slash = this.path.lastIndexOf("/");
    return slash === -1 ? this.path : this.path.slice(slash + 1);
  }
}

export class TFile extends TAbstractFile {
  get extension(): string {
    const dot = this.name.lastIndexOf(".");
    return dot === -1 ? "" : this.name.slice(dot + 1);
  }

  get basename(): string {
    const dot = this.name.lastIndexOf(".");
    return dot === -1 ? this.name : this.name.slice(0, dot);
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
}

export class App {}
export class Notice {
  constructor(
    public message: string,
    public duration?: number,
  ) {}
}

/** Real vaults are folder-backed; the fake vault in tests deliberately is not. */
export class FileSystemAdapter {
  getBasePath(): string {
    return "";
  }
}
export class Modal {
  constructor(public app: unknown) {}
  open(): void {}
  close(): void {}
}

export class FuzzySuggestModal extends Modal {
  setPlaceholder(): void {}
  setInstructions(): void {}
}

/** The title a leaf shows before TitleDecorator wraps this method. */
export class WorkspaceLeaf {
  view: unknown = null;
  getDisplayText(): string {
    return "raw";
  }
}

export class ItemView {
  constructor(public leaf: unknown) {}
}

export class MarkdownView {
  file: unknown = null;
}

/** Referenced by the reading-mode processor; never rendered outside Obsidian. */
export class MarkdownRenderChild {
  constructor(public containerEl: unknown) {}
}

export const MarkdownRenderer = {
  async render(): Promise<void> {},
};

export class Menu {
  addItem(): this {
    return this;
  }
  addSeparator(): this {
    return this;
  }
  showAtMouseEvent(): void {}
}

export const Keymap = {
  isModEvent: (): boolean => false,
};

export function setIcon(): void {}

/** Real network access; tests exercise the pure query/parsing helpers around it instead. */
export async function requestUrl(): Promise<{ status: number; json: unknown; text: string }> {
  throw new Error("requestUrl is not available in tests — mock the caller instead.");
}

export class Component {
  onload(): void {}
  onunload(): void {}
  register(): void {}
  registerEvent(): void {}
  addChild<T>(child: T): T {
    return child;
  }
}

/** Enough of EditorSuggest for tests to construct a subclass and call its pure-ish methods. */
export class EditorSuggest<T> {
  limit = 100;
  context: unknown = null;
  constructor(public app: unknown) {}
  open(): void {}
  close(): void {}
  setInstructions(): void {}
  getSuggestions(): T[] | Promise<T[]> {
    return [];
  }
}

/** Mirrors Obsidian's Debouncer, including `cancel()` and the `run()` flush callers rely on. */
export interface Debouncer<T extends unknown[]> {
  (...args: T): void;
  cancel(): void;
  run(): void;
}

export function debounce<T extends unknown[]>(
  callback: (...args: T) => void,
  timeout = 0,
): Debouncer<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  let pending: T | undefined;

  const clear = (): void => {
    if (handle !== undefined) clearTimeout(handle);
    handle = undefined;
  };

  const debounced = (...args: T): void => {
    pending = args;
    clear();
    handle = setTimeout(() => {
      handle = undefined;
      pending = undefined;
      callback(...args);
    }, timeout);
  };

  debounced.cancel = (): void => {
    clear();
    pending = undefined;
  };
  debounced.run = (): void => {
    const args = pending;
    clear();
    pending = undefined;
    if (args !== undefined) callback(...args);
  };

  return debounced;
}

/** Chainable no-op so a SettingTab can be constructed without a DOM. */
export class Setting {
  constructor(public containerEl?: unknown) {}
  setName(): this {
    return this;
  }
  setDesc(): this {
    return this;
  }
  setHeading(): this {
    return this;
  }
  setClass(): this {
    return this;
  }
  addText(): this {
    return this;
  }
  addDropdown(): this {
    return this;
  }
  addToggle(): this {
    return this;
  }
  addButton(): this {
    return this;
  }
}

export interface RegisteredCommand {
  id: string;
  name: string;
  callback?: () => void;
}

export class Plugin {
  readonly commands: RegisteredCommand[] = [];
  readonly registeredEvents: unknown[] = [];
  readonly registeredViews = new Map<string, unknown>();
  readonly ribbonIcons: string[] = [];
  readonly cleanups: Array<() => void> = [];
  readonly markdownPostProcessors: unknown[] = [];
  readonly editorExtensions: unknown[] = [];
  readonly editorSuggests: unknown[] = [];
  settingTabs: unknown[] = [];
  private data: unknown = null;

  constructor(public app: unknown, public manifest?: unknown) {}

  addCommand(command: RegisteredCommand): RegisteredCommand {
    this.commands.push(command);
    return command;
  }
  addSettingTab(tab: unknown): void {
    this.settingTabs.push(tab);
  }
  registerEvent(ref: unknown): void {
    this.registeredEvents.push(ref);
  }
  registerView(type: string, factory: unknown): void {
    this.registeredViews.set(type, factory);
  }
  addRibbonIcon(icon: string, _title: string, _callback: unknown): { icon: string } {
    this.ribbonIcons.push(icon);
    return { icon };
  }
  addStatusBarItem(): unknown {
    return null;
  }
  registerInterval(id: number): number {
    return id;
  }
  registerMarkdownPostProcessor(processor: unknown): unknown {
    this.markdownPostProcessors.push(processor);
    return processor;
  }
  registerEditorExtension(extension: unknown): void {
    this.editorExtensions.push(extension);
  }
  registerEditorSuggest(suggest: unknown): void {
    this.editorSuggests.push(suggest);
  }
  registerDomEvent(): void {}
  register(cleanup: () => void): void {
    this.cleanups.push(cleanup);
  }
  onunload(): void {}
  async loadData(): Promise<unknown> {
    return this.data;
  }
  async saveData(data: unknown): Promise<void> {
    this.data = data;
  }
}

export class PluginSettingTab {
  containerEl = { empty(): void {} };
  constructor(public app: unknown, public plugin: unknown) {}
}

/**
 * Obsidian keeps the file an editor is showing in this state field; `main.sourcePathOf` reads it
 * so that the live-preview extension can resolve links from editor state alone.
 */
export const editorInfoField = StateField.define<{ file: TFile | null }>({
  create: () => ({ file: null }),
  update: (value) => value,
});
