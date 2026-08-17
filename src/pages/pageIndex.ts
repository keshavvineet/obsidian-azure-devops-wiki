import { App, TAbstractFile, TFile, TFolder } from "obsidian";
import { ORDER_FILE } from "../constants";
import { decodeFileName, stripMdExtension, wikiPathFromVaultPath } from "../naming/pageNameCodec";
import { parseOrderFile } from "../order/orderFile";

/**
 * The single cached view of the wiki (ARCHITECTURE §3). Every feature reads the index;
 * nothing else walks the vault.
 *
 * Page hierarchy follows ADO's paired-folder convention, not the raw folder tree: the
 * subpages of `A/B.md` are the pages inside `A/B/`.
 */
export interface PageEntry {
  file: TFile;
  /** Decoded display title, e.g. 'Pre-Release RCA Categories'. */
  title: string;
  /** Encoded page name without .md, e.g. 'Pre%2DRelease-RCA-Categories'. */
  name: string;
  /** ADO link target, e.g. '/Product-Documentation/Child-Page'. */
  wikiPath: string;
  /** Decoded path for display, e.g. 'Product Documentation/Child Page'. */
  titlePath: string;
  /** Vault-relative parent folder; '' at the wiki root. */
  folderPath: string;
  /** Vault path of the parent page's file, or null at the wiki root. */
  parentPath: string | null;
  /** Position from .order; UNORDERED when the page is not listed. */
  order: number;
}

export const UNORDERED = Number.MAX_SAFE_INTEGER;

export class PageIndex {
  private byFilePath = new Map<string, PageEntry>();
  private byWikiPathExact = new Map<string, PageEntry>();
  private byWikiPathLower = new Map<string, PageEntry>();
  private byTitleLower = new Map<string, PageEntry[]>();
  /** folderPath → page names (no .md) in .order sequence. */
  private orderByFolder = new Map<string, string[]>();
  /**
   * folderPath → how many pages it holds. Maintained rather than counted on demand: the explorer
   * decorator asks "does this page have subpages?" for every row on every redraw, and answering
   * that by scanning the index turned one repaint into O(rows × pages) (NFR-2).
   */
  private pageCountByFolder = new Map<string, number>();
  private readonly changeListeners = new Set<() => void>();

  constructor(private readonly app: App) {}

  // ------------------------------------------------------------ subscription

  /**
   * Notified whenever the index content changes — pages added, removed, renamed, or a folder's
   * .order re-read. Views redraw from this instead of watching vault events themselves, so a
   * page created by a command and a page arriving from a git pull refresh the UI identically.
   *
   * @returns an unsubscribe function.
   */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private emitChange(): void {
    // Copied first: a listener that unsubscribes itself must not disturb this iteration.
    for (const listener of [...this.changeListeners]) listener();
  }

  // ---------------------------------------------------------------- building

  async rebuild(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles().filter((file) => !isHidden(file.path));
    const folders = new Set(files.map((file) => folderPathOf(file)));

    this.orderByFolder.clear();
    await Promise.all(
      [...folders].map(async (folder) => {
        this.orderByFolder.set(folder, await this.readOrderEntries(folder));
      }),
    );

    this.byFilePath.clear();
    this.byWikiPathExact.clear();
    this.byWikiPathLower.clear();
    this.byTitleLower.clear();
    this.pageCountByFolder.clear();
    for (const file of files) this.addEntry(file);

    this.emitChange();
  }

  /** Re-read one folder's .order and refresh the affected entries' positions. */
  async refreshFolderOrder(folderPath: string): Promise<void> {
    const folder = normalizeFolderPath(folderPath);
    this.orderByFolder.set(folder, await this.readOrderEntries(folder));
    for (const entry of this.byFilePath.values()) {
      if (entry.folderPath === folder) entry.order = this.orderOf(folder, entry.name);
    }
    this.emitChange();
  }

  private async readOrderEntries(folderPath: string): Promise<string[]> {
    // .order is a dotfile, so it is invisible to the Vault API — use the raw adapter.
    const path = folderPath.length === 0 ? ORDER_FILE : `${folderPath}/${ORDER_FILE}`;
    try {
      if (!(await this.app.vault.adapter.exists(path))) return [];
      return parseOrderFile(await this.app.vault.adapter.read(path)).entries;
    } catch {
      return [];
    }
  }

  private addEntry(file: TFile): PageEntry {
    const folderPath = folderPathOf(file);
    const name = stripMdExtension(file.name);
    const entry: PageEntry = {
      file,
      name,
      title: decodeFileName(name),
      wikiPath: wikiPathFromVaultPath(file.path),
      titlePath: folderPath.length === 0 ? decodeFileName(name) : decodePath(file.path),
      folderPath,
      parentPath: folderPath.length === 0 ? null : `${folderPath}.md`,
      order: this.orderOf(folderPath, name),
    };

    this.byFilePath.set(file.path, entry);
    this.byWikiPathExact.set(entry.wikiPath, entry);
    this.byWikiPathLower.set(entry.wikiPath.toLowerCase(), entry);
    this.pageCountByFolder.set(folderPath, (this.pageCountByFolder.get(folderPath) ?? 0) + 1);
    const titleKey = entry.title.toLowerCase();
    const sameTitle = this.byTitleLower.get(titleKey);
    if (sameTitle) sameTitle.push(entry);
    else this.byTitleLower.set(titleKey, [entry]);

    return entry;
  }

  private removeEntry(path: string): void {
    const entry = this.byFilePath.get(path);
    if (!entry) return;

    this.byFilePath.delete(path);
    if (this.byWikiPathExact.get(entry.wikiPath) === entry) {
      this.byWikiPathExact.delete(entry.wikiPath);
    }
    if (this.byWikiPathLower.get(entry.wikiPath.toLowerCase()) === entry) {
      this.byWikiPathLower.delete(entry.wikiPath.toLowerCase());
    }
    const titleKey = entry.title.toLowerCase();
    const sameTitle = this.byTitleLower.get(titleKey)?.filter((e) => e !== entry) ?? [];
    if (sameTitle.length > 0) this.byTitleLower.set(titleKey, sameTitle);
    else this.byTitleLower.delete(titleKey);

    const remaining = (this.pageCountByFolder.get(entry.folderPath) ?? 1) - 1;
    if (remaining > 0) this.pageCountByFolder.set(entry.folderPath, remaining);
    else this.pageCountByFolder.delete(entry.folderPath);
  }

  private orderOf(folderPath: string, name: string): number {
    const index = this.orderByFolder.get(folderPath)?.indexOf(name) ?? -1;
    return index === -1 ? UNORDERED : index;
  }

  // ------------------------------------------------------------ vault events

  async handleCreate(file: TAbstractFile): Promise<void> {
    if (!isIndexablePage(file)) return;
    await this.refreshFolderOrder(folderPathOf(file));
    this.addEntry(file);
    this.emitChange();
  }

  handleDelete(file: TAbstractFile): void {
    if (file instanceof TFolder) {
      for (const path of [...this.byFilePath.keys()]) {
        if (path.startsWith(`${file.path}/`)) this.removeEntry(path);
      }
      this.emitChange();
      return;
    }
    this.removeEntry(file.path);
    this.emitChange();
  }

  async handleRename(file: TAbstractFile, oldPath: string): Promise<void> {
    if (file instanceof TFolder) {
      // Child TFile paths are updated by Obsidian without individual events.
      await this.rebuild();
      return;
    }
    if (!isIndexablePage(file)) {
      this.removeEntry(oldPath);
      this.emitChange();
      return;
    }
    this.removeEntry(oldPath);
    await this.refreshFolderOrder(folderPathOf(file));
    if (folderPathOf(file) !== folderPathOfPath(oldPath)) {
      await this.refreshFolderOrder(folderPathOfPath(oldPath));
    }
    this.addEntry(file);
    this.emitChange();
  }

  // ------------------------------------------------------------------ lookup

  get size(): number {
    return this.byFilePath.size;
  }

  all(): PageEntry[] {
    return [...this.byFilePath.values()];
  }

  forFile(file: TFile): PageEntry | null {
    return this.byFilePath.get(file.path) ?? null;
  }

  forPath(vaultPath: string): PageEntry | null {
    return this.byFilePath.get(vaultPath) ?? null;
  }

  /** Resolve an ADO link target. Falls back to a case-insensitive match. */
  forWikiPath(wikiPath: string): PageEntry | null {
    const clean = wikiPath.split("#")[0].replace(/\/+$/, "");
    return (
      this.byWikiPathExact.get(clean) ?? this.byWikiPathLower.get(clean.toLowerCase()) ?? null
    );
  }

  forTitle(title: string): PageEntry[] {
    return this.byTitleLower.get(title.toLowerCase()) ?? [];
  }

  parentOf(entry: PageEntry): PageEntry | null {
    return entry.parentPath ? (this.byFilePath.get(entry.parentPath) ?? null) : null;
  }

  /** Subpages of a page, in .order sequence (unlisted pages sorted alphabetically last). */
  childrenOf(entry: PageEntry): PageEntry[] {
    return this.pagesInFolder(stripMdExtension(entry.file.path));
  }

  /**
   * Whether a folder holds any page — "does this page have subpages?" in O(1).
   *
   * Separate from `pagesInFolder` on purpose: the caller that asks this most often (the explorer
   * decorator, once per row per repaint) needs the answer, not the sorted list.
   */
  hasPagesInFolder(folderPath: string): boolean {
    return (this.pageCountByFolder.get(normalizeFolderPath(folderPath)) ?? 0) > 0;
  }

  /** Pages directly inside a folder, in .order sequence. */
  pagesInFolder(folderPath: string): PageEntry[] {
    const folder = normalizeFolderPath(folderPath);
    return this.all()
      .filter((entry) => entry.folderPath === folder)
      .sort(compareEntries);
  }

  /** Top-level pages of the wiki, in .order sequence. */
  rootPages(): PageEntry[] {
    return this.pagesInFolder("");
  }

  /**
   * Every page grouped by its containing folder, each list in .order sequence.
   *
   * One pass for the whole vault: the tree view needs the sequence of every level it draws,
   * and asking `pagesInFolder` per node would rescan the index once per node (NFR-2).
   */
  pagesByFolder(): Map<string, PageEntry[]> {
    const byFolder = new Map<string, PageEntry[]>();
    for (const entry of this.byFilePath.values()) {
      const siblings = byFolder.get(entry.folderPath);
      if (siblings) siblings.push(entry);
      else byFolder.set(entry.folderPath, [entry]);
    }
    for (const siblings of byFolder.values()) siblings.sort(compareEntries);
    return byFolder;
  }

  /** File names (with .md) in a folder — what the title validator needs for uniqueness. */
  siblingFileNames(folderPath: string): string[] {
    return this.pagesInFolder(folderPath).map((entry) => entry.file.name);
  }

  /** Page names (no .md) on disk in a folder — what .order reconciliation compares against. */
  pageNamesInFolder(folderPath: string): string[] {
    return this.pagesInFolder(folderPath).map((entry) => entry.name);
  }

  /** Every folder that currently holds at least one page. */
  foldersWithPages(): string[] {
    return [...new Set(this.all().map((entry) => entry.folderPath))].sort();
  }
}

export function compareEntries(a: PageEntry, b: PageEntry): number {
  return a.order !== b.order ? a.order - b.order : a.title.localeCompare(b.title);
}

function isIndexablePage(file: TAbstractFile): file is TFile {
  return file instanceof TFile && file.extension === "md" && !isHidden(file.path);
}

function isHidden(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

function folderPathOf(file: TAbstractFile): string {
  return normalizeFolderPath(file.parent?.path ?? "");
}

function folderPathOfPath(vaultPath: string): string {
  const slash = vaultPath.lastIndexOf("/");
  return slash === -1 ? "" : vaultPath.slice(0, slash);
}

export function normalizeFolderPath(folderPath: string): string {
  return folderPath === "/" || folderPath === "." ? "" : folderPath.replace(/^\/+|\/+$/g, "");
}

function decodePath(vaultPath: string): string {
  return vaultPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(decodeFileName)
    .join("/");
}
