import { App, TAbstractFile, TFile, TFolder } from "obsidian";
import { ORDER_FILE } from "../constants";
import { stripMdExtension } from "../naming/pageNameCodec";
import { normalizeFolderPath, PageIndex } from "../pages/pageIndex";
import { MutationQueue } from "../util/mutationQueue";
import {
  emptyOrderFile,
  OrderFile,
  parseOrderFile,
  reconcileOrder,
  serializeOrderFile,
  withEntriesArranged,
  withEntryAppended,
  withEntryFirst,
  withEntryRenamed,
} from "./orderFile";

export interface RepairSummary {
  foldersChecked: number;
  foldersChanged: string[];
  added: number;
  removed: number;
}

/**
 * Where a change slots into the read → reconcile → write cycle.
 *
 * The side of reconciliation matters. A rename has to be applied *before*, or reconciliation
 * drops the old name (no longer on disk) and re-appends the new one at the end, losing the
 * page's position. A reorder has to be applied *after*, so it acts on the complete sequence —
 * including pages reconciliation has just seeded for a folder that had no .order file yet.
 */
interface SyncOptions {
  beforeReconcile?: (order: OrderFile) => OrderFile;
  afterReconcile?: (order: OrderFile) => OrderFile;
  /**
   * Page that must end up last: a newly created page goes to the end of the sequence,
   * matching the Azure DevOps portal, instead of being sorted in with the pages that
   * reconciliation seeds alphabetically.
   */
  appendLast?: string;
}

/**
 * Keeps every .order file in step with what is actually on disk (FR-2.1, FR-2.2).
 *
 * All operations funnel through the same routine: read the file, apply the change, then
 * reconcile against the pages the index reports on disk. That single path covers pages
 * created by our own commands and pages created behind our back (explorer drag, git pull),
 * and it seeds a correct .order for folders that never had one — using the alphabetical
 * sequence Azure DevOps is already displaying, so the visible page order never jumps.
 *
 * .order is a dotfile and therefore invisible to the Vault API; all I/O uses vault.adapter.
 */
export class OrderManager {
  private readonly queue = new MutationQueue();

  constructor(
    private readonly app: App,
    private readonly index: PageIndex,
  ) {}

  // ------------------------------------------------------------ vault events

  handleCreate(file: TAbstractFile): Promise<void> {
    if (!isPage(file)) return Promise.resolve();
    return this.sync(folderOf(file), { appendLast: stripMdExtension(file.name) });
  }

  handleDelete(file: TAbstractFile): Promise<void> {
    if (file instanceof TFolder) return this.sync(parentFolderOfPath(file.path));
    if (!isPage(file)) return Promise.resolve();
    return this.sync(folderOf(file));
  }

  async handleRename(file: TAbstractFile, oldPath: string): Promise<void> {
    if (file instanceof TFolder) {
      await this.sync(parentFolderOfPath(oldPath));
      await this.sync(parentFolderOfPath(file.path));
      return;
    }
    if (!isPage(file)) return;

    const oldFolder = parentFolderOfPath(oldPath);
    const newFolder = folderOf(file);
    const oldName = stripMdExtension(baseNameOf(oldPath));
    const newName = stripMdExtension(file.name);

    if (oldFolder === newFolder) {
      // Rename in place so the page keeps its position in the sequence.
      await this.sync(newFolder, {
        beforeReconcile: (order) => withEntryRenamed(order, oldName, newName),
      });
      return;
    }
    await this.sync(oldFolder);
    await this.sync(newFolder, { appendLast: newName });
  }

  // -------------------------------------------------------------- operations

  /**
   * Write an explicit page sequence for one folder (drag-to-reorder in the wiki tree).
   *
   * The caller passes the sequence it is displaying, so what lands in .order is exactly what
   * the user just arranged — no index arithmetic that could disagree with the visible tree.
   */
  reorder(folderPath: string, orderedNames: readonly string[]): Promise<void> {
    return this.sync(folderPath, {
      afterReconcile: (order) => withEntriesArranged(order, orderedNames),
    });
  }

  /** Make a page the first entry — at the wiki root, that is the wiki home page. */
  setFirst(folderPath: string, name: string): Promise<void> {
    return this.sync(folderPath, { afterReconcile: (order) => withEntryFirst(order, name) });
  }

  /** Bring one folder's .order back in line with disk. */
  repairFolder(folderPath: string): Promise<void> {
    return this.sync(folderPath);
  }

  /**
   * Check every folder that already has a .order file (FR-2.2).
   *
   * Folders without one are skipped on purpose: Azure DevOps renders them alphabetically,
   * which is by definition correct, so "repair" has nothing to fix there. Creating .order
   * files for them would pin that sequence and produce a sprawling diff nobody asked for.
   */
  async repairAll(): Promise<RepairSummary> {
    const folders = this.index.foldersWithPages();
    const summary: RepairSummary = {
      foldersChecked: 0,
      foldersChanged: [],
      added: 0,
      removed: 0,
    };

    for (const folder of folders) {
      await this.queue.run(async () => {
        if (!(await this.app.vault.adapter.exists(orderPathOf(folder)))) return;
        summary.foldersChecked++;
        const order = await this.read(folder);
        const result = reconcileOrder(order, this.index.pageNamesInFolder(folder));
        if (!result.changed) return;
        if (await this.write(folder, result.order)) {
          summary.foldersChanged.push(folder === "" ? "/" : folder);
          summary.added += result.added.length;
          summary.removed += result.removed.length;
        }
      });
    }

    await this.index.rebuild();
    return summary;
  }

  /** Wait for pending .order writes — used by tests and by the git sync flow. */
  idle(): Promise<void> {
    return this.queue.idle();
  }

  // ------------------------------------------------------------------ plumbing

  private sync(folderPath: string, options: SyncOptions = {}): Promise<void> {
    const folder = normalizeFolderPath(folderPath);
    const { beforeReconcile, afterReconcile, appendLast } = options;

    return this.queue.run(async () => {
      const current = await this.read(folder);
      const applied = beforeReconcile ? beforeReconcile(current) : current;

      const onDisk = this.index.pageNamesInFolder(folder);
      const toReconcile = appendLast ? onDisk.filter((name) => name !== appendLast) : onDisk;
      const reconciled = reconcileOrder(applied, toReconcile).order;
      const appended = appendLast ? withEntryAppended(reconciled, appendLast) : reconciled;
      const order = afterReconcile ? afterReconcile(appended) : appended;

      if (await this.write(folder, order)) await this.index.refreshFolderOrder(folder);
    });
  }

  private async read(folderPath: string): Promise<OrderFile> {
    const path = orderPathOf(folderPath);
    try {
      if (!(await this.app.vault.adapter.exists(path))) return emptyOrderFile();
      return parseOrderFile(await this.app.vault.adapter.read(path));
    } catch {
      return emptyOrderFile();
    }
  }

  /** Writes only when the content actually changes, so .order never adds git noise. */
  private async write(folderPath: string, order: OrderFile): Promise<boolean> {
    const path = orderPathOf(folderPath);
    const next = serializeOrderFile(order);
    const exists = await this.app.vault.adapter.exists(path);

    if (!exists && next.length === 0) return false;
    if (exists && (await this.app.vault.adapter.read(path)) === next) return false;

    await this.app.vault.adapter.write(path, next);
    return true;
  }
}

function orderPathOf(folderPath: string): string {
  const folder = normalizeFolderPath(folderPath);
  return folder.length === 0 ? ORDER_FILE : `${folder}/${ORDER_FILE}`;
}

function isPage(file: TAbstractFile): file is TFile {
  return (
    file instanceof TFile &&
    file.extension === "md" &&
    !file.path.split("/").some((segment) => segment.startsWith("."))
  );
}

function folderOf(file: TAbstractFile): string {
  return normalizeFolderPath(file.parent?.path ?? "");
}

function parentFolderOfPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function baseNameOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}
