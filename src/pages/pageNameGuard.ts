import { debounce, Notice, TAbstractFile, TFile } from "obsidian";
import { nonPortableSegments } from "../naming/portableName";
import type { NonPortableSegment } from "../naming/portableName";
import { S } from "../strings";
import type { PageIndex } from "./pageIndex";
import type { PageCommands } from "./pageCommands";

/**
 * Catches a page whose file name Azure DevOps cannot load, at the moment it appears (PLAN note 12).
 *
 * The plugin's own "Create wiki page" command always encodes the title, but Obsidian's own
 * *New note* and its explorer rename do not — and `7.4 New Test Page.md`, with literal spaces, is
 * exactly the file that produced the reported portal error, then got published and broke the page
 * in the portal for everyone.
 *
 * So there are two behaviours, split by how much the plugin can safely decide:
 *
 *  - **A page that has just been created and is still empty is renamed on the spot.** Its title is
 *    unchanged — only the encoding of the file name is — nothing links to it yet, and it has no
 *    subpage folder, so there is nothing a rename could damage. Doing this *is* the fix for
 *    "adding a new page in Obsidian gives an error in ADO": the broken name never reaches a commit.
 *  - **Anything else is reported, never touched.** A page with content may be someone else's, a
 *    pull can land hundreds of files, and a production wiki already contains such names — renaming
 *    those behind the user's back would be a commit they did not ask for. They get one notice with
 *    the pre-filled Rename dialog, or a pointer to the linter when there is more than one.
 */
/** How recently a file must have been created to count as "the user just made this". */
const FRESH_PAGE_MS = 60_000;

export class PageNameGuard {
  /** Page path → the one segment of it worth telling the user about. */
  private readonly pending = new Map<string, NonPortableSegment>();
  /** Paths already reported, so the same file cannot nag on every edit or re-index. */
  private readonly reported = new Set<string>();

  private readonly flush = debounce(() => this.report(), 1500, false);

  constructor(
    private readonly index: PageIndex,
    private readonly pageCommands: PageCommands,
    /** Opens the compatibility pane and scans the vault — the "show me all of them" path. */
    private readonly showLintResults: () => void,
  ) {}

  /** Wired to the vault's create and rename events for markdown files. */
  check(file: TAbstractFile): void {
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") return;
    if (this.reported.has(file.path)) return;

    const problems = nonPortableSegments(file.path);
    if (problems.length === 0) return;

    // The page's own name is the actionable one; a folder is fixed by renaming its parent page.
    const own = problems.find((problem) => problem.isPage);
    if (own && this.isFreshlyCreated(file)) {
      // Only the page's own name is fixed here, whether or not a folder above it is also wrong:
      // the folder belongs to another page and is repaired through that one. Requiring the page
      // to be the *sole* problem left a new note in a badly named folder with neither fix.
      void this.fixNow(file);
      return;
    }

    this.pending.set(file.path, problemFor(problems));
    this.flush();
  }

  /**
   * Whether this file is one the user has just made in this session and not yet written to.
   *
   * Both conditions matter. Empty rules out a page that arrived from a Refresh with content, and
   * the age check rules out an empty page that has been sitting in the wiki for months — in both
   * cases the file is the team's, not this session's, and gets a notice instead.
   */
  private isFreshlyCreated(file: TFile): boolean {
    return file.stat.size === 0 && Date.now() - file.stat.ctime < FRESH_PAGE_MS;
  }

  private async fixNow(file: TFile): Promise<void> {
    const entry = this.index.forPath(file.path);
    const oldName = file.name;
    const title = entry ? await this.pageCommands.renameToPortableName(entry) : null;

    if (title === null) {
      // Could not do it silently after all — fall back to telling the user, as before.
      const problems = nonPortableSegments(file.path);
      if (problems.length > 0) this.pending.set(file.path, problemFor(problems));
      this.flush();
      return;
    }
    new Notice(S.notices.pageNameFixed(oldName, title), 10_000);
  }

  /** A path that no longer exists cannot be reported, and may be re-created legitimately. */
  forget(path: string): void {
    this.pending.delete(path);
    this.reported.delete(path);
  }

  private report(): void {
    const entries = [...this.pending.entries()];
    this.pending.clear();
    for (const [path] of entries) this.reported.add(path);
    if (entries.length === 0) return;

    if (entries.length === 1) {
      const [path, problem] = entries[0];
      this.notifyOne(path, problem);
      return;
    }

    const notice = new Notice(S.notices.badPageNames(entries.length), 15_000);
    addAction(notice, S.notices.badPageNameShowAll, () => this.showLintResults());
  }

  /**
   * One page, one message — naming the file *the user has to rename*, which is not always the
   * file that triggered the check. `New folder/Untitled.md` has a perfectly good page name and a
   * folder Azure DevOps cannot read, and reporting the page's name against the folder's
   * suggestion (as this did) produced a message where neither half matched the other, over a
   * button that opened a dialog which could not fix it.
   */
  private notifyOne(path: string, problem: NonPortableSegment): void {
    if (problem.isPage) {
      const notice = new Notice(S.notices.badPageName(problem.name, problem.suggestion), 15_000);
      const entry = this.index.forPath(path);
      if (!entry) return;
      addAction(notice, S.notices.badPageNameFix, () => this.pageCommands.promptRenameFor(entry));
      return;
    }

    const pageName = path.split("/").pop() ?? path;
    const notice = new Notice(
      S.notices.badFolderName(problem.name, problem.suggestion, pageName),
      15_000,
    );
    // The folder is renamed by renaming the page it belongs to — `Some-Folder.md` owns
    // `Some-Folder/`. A folder with no such page is the FolderGuard's job, not a rename.
    const owner = this.index.forPath(`${problem.path}.md`);
    if (!owner) return;
    addAction(notice, S.notices.badFolderNameFix, () => this.pageCommands.promptRenameFor(owner));
  }
}

/**
 * Which problem to report for a page with more than one. The page's own name comes first — it is
 * the one the user can fix from this page — and a folder is reported only when the page itself is
 * fine, because a folder is shared by every page under it and belongs to a different owner.
 */
function problemFor(problems: NonPortableSegment[]): NonPortableSegment {
  return problems.find((problem) => problem.isPage) ?? problems[0];
}

/**
 * A clickable action inside a notice. `Notice.messageEl` is not in the public typings, so a
 * missing element simply means the notice stays informational rather than throwing.
 */
function addAction(notice: Notice, label: string, run: () => void): void {
  const messageEl = (notice as unknown as { messageEl?: HTMLElement }).messageEl;
  if (!messageEl) return;

  const button = messageEl.createEl("button", { cls: "adowiki-notice__action", text: label });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    notice.hide();
    run();
  });
}
