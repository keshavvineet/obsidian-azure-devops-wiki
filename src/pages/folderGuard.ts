import { App, debounce, Notice, TAbstractFile, TFile, TFolder } from "obsidian";
import { S } from "../strings";
import { planFolderAdoption } from "./folderPlan";
import type { OrderManager } from "../order/orderManager";

/**
 * Makes a folder created in the file explorer into the page Azure DevOps needs it to be.
 *
 * A wiki has pages, not folders (`folderPlan.ts`). Obsidian offers *New folder* and users take it —
 * then the page they put inside is orphaned, missing from every `.order`, and if the folder name
 * contains a space the publish gate blocks the whole sync with a message about the *page*. Rather
 * than explain a distinction the wiki format does not have, the folder is turned into a page:
 * `This is a new page/` becomes `This-is-a-new-page.md` + `This-is-a-new-page/`, and the page
 * lands in its parent's `.order` through the ordinary create event.
 *
 * Three things make this safe to do without asking:
 *
 *  - **Nothing is lost.** Creating the paired page adds a file; it never moves, merges or deletes
 *    the folder's contents. The folder rename is the same encoding the page guard already applies.
 *  - **It cannot fire on someone else's work.** The vault's `create` event for a folder only fires
 *    for a folder that did not exist a moment ago, and the decision is re-taken at flush time
 *    against the live vault, so a folder that has meanwhile been deleted, renamed or paired with a
 *    page of its own is dropped.
 *  - **It stands down during a sync.** A Refresh checks out whole subtrees, and the paired page
 *    may simply be a second later than its folder in the same checkout. Work queued while a git
 *    flow runs waits for it to finish and is then re-judged.
 *
 * The settle delay matters for a second reason: Obsidian creates *New folder* as `Untitled` and
 * puts the row straight into rename mode, so the name the user means arrives as a `rename` event.
 * Acting on the `create` would adopt a folder called "Untitled" while they are still typing.
 */
/** How long a folder must sit unchanged before it is judged — long enough to be named. */
const FOLDER_SETTLE_MS = 2000;

export class FolderGuard {
  private readonly pending = new Set<string>();
  private readonly flush = debounce(() => void this.adoptPending(), FOLDER_SETTLE_MS, false);

  constructor(
    private readonly app: App,
    private readonly orderManager: OrderManager,
    /** True while a Refresh or Publish is running — see the class comment. */
    private readonly isSyncing: () => boolean,
  ) {}

  /** Wired to the vault's create and rename events; ignores everything that is not a folder. */
  check(file: TAbstractFile): void {
    if (!(file instanceof TFolder)) return;
    this.pending.add(file.path);
    this.flush();
  }

  /** A path that has been deleted or renamed away cannot be adopted under that name. */
  forget(path: string): void {
    this.pending.delete(path);
  }

  /**
   * Called when a git flow finishes, to judge what was held back while it ran.
   *
   * A signal rather than a poll: re-arming the timer from inside the flush would leave a timer
   * rescheduling itself every two seconds for as long as the flow lasts — and a conflict dialog
   * keeps the state non-idle until somebody answers it, which could be hours.
   */
  resume(): void {
    if (this.pending.size > 0) this.flush();
  }

  private async adoptPending(): Promise<void> {
    // Held, not dropped: the folder is still wrong, it is just not our turn. `resume()` returns.
    if (this.isSyncing()) return;

    const paths = [...this.pending];
    this.pending.clear();

    const adopted: string[] = [];
    for (const path of paths) {
      const title = await this.adopt(path);
      if (title !== null) adopted.push(title);
    }
    if (adopted.length === 1) new Notice(S.notices.folderIsNowAPage(adopted[0]), 12_000);
    else if (adopted.length > 1) new Notice(S.notices.foldersAreNowPages(adopted.length), 12_000);
  }

  /** @returns the new page's title, or null when there was nothing to do. */
  private async adopt(path: string): Promise<string | null> {
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!(folder instanceof TFolder)) return null;

    const plan = planFolderAdoption(path, {
      hasPairedPage: this.app.vault.getAbstractFileByPath(`${path}.md`) instanceof TFile,
    });
    if (plan === null) return null;
    // Someone may already hold the name the folder wants — leave it rather than collide.
    if (this.app.vault.getAbstractFileByPath(plan.pagePath) !== null) return null;
    if (plan.renameFolder && this.app.vault.getAbstractFileByPath(plan.folderPath) !== null) {
      return null;
    }

    try {
      // Rename first: the page has to pair with the folder's final name, and doing it the other
      // way round would leave a page paired with nothing for the length of one event loop.
      if (plan.renameFolder) await this.app.fileManager.renameFile(folder, plan.folderPath);
      await this.app.vault.create(plan.pagePath, "");
      await this.orderManager.idle();
      return plan.title;
    } catch (error) {
      console.error("[azure-devops-wiki] could not adopt folder", path, error);
      return null;
    }
  }
}
