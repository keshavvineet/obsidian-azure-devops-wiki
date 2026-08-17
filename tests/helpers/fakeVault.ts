import { TAbstractFile, TFile, TFolder } from "../stubs/obsidian";

/**
 * In-memory stand-in for Obsidian's vault, enough to drive PageIndex and OrderManager.
 *
 * Mirrors two behaviours that matter for this plugin:
 *  - getMarkdownFiles() never returns anything under a dot-folder (Obsidian hides them),
 *  - the adapter can still read and write those dotfiles, which is how .order is handled.
 */
export class FakeVault {
  private readonly folders = new Map<string, TFolder>();
  private readonly markdown = new Map<string, TFile>();
  /** Raw files reachable through the adapter, e.g. '.order' or 'Docs/.order'. */
  readonly disk = new Map<string, string>();
  /** Counts adapter writes so tests can assert that no-op saves are skipped. */
  writeCount = 0;

  /** Folders created through the adapter, e.g. '.attachments' before the first paste. */
  readonly createdFolders = new Set<string>();

  readonly adapter = {
    // A folder "exists" when something inside it does, which is how a real adapter behaves.
    exists: async (path: string): Promise<boolean> =>
      this.disk.has(path) ||
      this.createdFolders.has(path) ||
      [...this.disk.keys()].some((key) => key.startsWith(`${path}/`)),
    read: async (path: string): Promise<string> => {
      const content = this.disk.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    write: async (path: string, content: string): Promise<void> => {
      this.disk.set(path, content);
      this.writeCount++;
    },
    writeBinary: async (path: string, data: ArrayBuffer): Promise<void> => {
      this.disk.set(path, `binary:${data.byteLength}`);
      this.writeCount++;
    },
    mkdir: async (path: string): Promise<void> => {
      this.createdFolders.add(path);
    },
    list: async (path: string): Promise<{ files: string[]; folders: string[] }> => {
      const prefix = `${path}/`;
      const files = [...this.disk.keys()].filter(
        (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"),
      );
      return { files, folders: [] };
    },
  };

  /** Vault event subscriptions, keyed by event name. */
  readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  on(event: string, callback: (...args: unknown[]) => void): { event: string } {
    const existing = this.listeners.get(event) ?? [];
    existing.push(callback);
    this.listeners.set(event, existing);
    return { event };
  }

  getMarkdownFiles(): TFile[] {
    return [...this.markdown.values()];
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.markdown.get(path) ?? this.folders.get(path) ?? null;
  }

  addPage(path: string): TFile {
    const file = new TFile(path);
    file.parent = this.ensureFolder(parentOf(path));
    file.parent.children.push(file);
    this.markdown.set(path, file);
    return file;
  }

  removePage(path: string): TFile {
    const file = this.markdown.get(path);
    if (!file) throw new Error(`No such page: ${path}`);
    this.markdown.delete(path);
    detach(file);
    return file;
  }

  /** Renames a page and returns it with its new path, like Obsidian's rename. */
  renamePage(oldPath: string, newPath: string): TFile {
    const file = this.removePage(oldPath);
    file.path = newPath;
    file.parent = this.ensureFolder(parentOf(newPath));
    file.parent.children.push(file);
    this.markdown.set(newPath, file);
    return file;
  }

  /** Renames a folder and re-paths its descendants, like Obsidian's rename. */
  renameFolder(oldPath: string, newPath: string): TFolder {
    const folder = this.ensureFolder(oldPath);
    this.folders.delete(oldPath);
    folder.path = newPath;
    this.folders.set(newPath, folder);

    for (const [path, file] of [...this.markdown]) {
      if (!path.startsWith(`${oldPath}/`)) continue;
      this.markdown.delete(path);
      file.path = newPath + path.slice(oldPath.length);
      this.markdown.set(file.path, file);
    }
    return folder;
  }

  ensureFolder(path: string): TFolder {
    const normalized = path.length === 0 ? "/" : path;
    const existing = this.folders.get(normalized);
    if (existing) return existing;

    const folder = new TFolder(normalized);
    this.folders.set(normalized, folder);
    if (normalized !== "/") {
      folder.parent = this.ensureFolder(parentOf(normalized));
      folder.parent.children.push(folder);
    }
    return folder;
  }

  writeOrder(folderPath: string, ...entries: string[]): void {
    const path = folderPath.length === 0 ? ".order" : `${folderPath}/.order`;
    this.disk.set(path, entries.join("\n") + "\n");
  }

  readOrder(folderPath: string): string | undefined {
    return this.disk.get(folderPath.length === 0 ? ".order" : `${folderPath}/.order`);
  }

  orderEntries(folderPath: string): string[] {
    const raw = this.readOrder(folderPath);
    return raw === undefined ? [] : raw.split("\n").filter((line) => line.length > 0);
  }
}

/** The `app` object the plugin modules expect. */
export function fakeApp(vault: FakeVault): { vault: FakeVault } {
  return { vault };
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function detach(file: TAbstractFile): void {
  if (!file.parent) return;
  file.parent.children = file.parent.children.filter((child) => child !== file);
}
