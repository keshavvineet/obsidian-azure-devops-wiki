import { App, FuzzySuggestModal, Keymap } from "obsidian";
import { S } from "../strings";
import type { PageEntry } from "./pageIndex";
import type { PageIndex } from "./pageIndex";

/**
 * "Open wiki page" — a fuzzy switcher over decoded titles (FR-1.1).
 *
 * Obsidian's own quick switcher matches on file names, which in this vault are encoded, so
 * searching for "Pre-Release RCA" finds nothing there. Rather than patch the native switcher,
 * the plugin ships its own over the page index (ARCHITECTURE §4.1); the native one keeps
 * working unchanged for anyone who prefers it.
 *
 * Matching runs against the full decoded title path ("Product Documentation/1. Setup"), so a
 * page can be found by its own title or by its parent's.
 */
export class WikiPageSwitcher extends FuzzySuggestModal<PageEntry> {
  constructor(
    app: App,
    private readonly index: PageIndex,
  ) {
    super(app);
    this.setPlaceholder(S.switcher.placeholder);
    this.setInstructions([
      { command: "↵", purpose: S.switcher.openHint },
      { command: "Ctrl ↵", purpose: S.switcher.newTabHint },
    ]);
  }

  getItems(): PageEntry[] {
    return this.index.all().sort((a, b) => a.titlePath.localeCompare(b.titlePath));
  }

  getItemText(item: PageEntry): string {
    return item.titlePath;
  }

  onChooseItem(item: PageEntry, event: MouseEvent | KeyboardEvent): void {
    void this.app.workspace.getLeaf(Keymap.isModEvent(event)).openFile(item.file);
  }
}
