import { App, Notice, TFile, TFolder } from "obsidian";
import { buildRenameReplacements, rewriteLinkTargets } from "../links/linkTargets";
import { stripMdExtension, wikiPathFromVaultPath } from "../naming/pageNameCodec";
import { joinPath, validateTitle } from "../naming/titleValidator";
import type { ValidationResult } from "../naming/titleValidator";
import type { OrderManager } from "../order/orderManager";
import { S } from "../strings";
import { ConfirmModal, TitlePromptModal } from "./pageModals";
import type { ParentChoice } from "./pageModals";
import type { PageEntry } from "./pageIndex";
import { PageIndex } from "./pageIndex";
import { namesWithOffset } from "./treeModel";

/**
 * Page lifecycle commands (FR-1.2, FR-1.3). Every path that touches disk goes through the
 * title validator first, and .order upkeep is left to OrderManager's vault-event handlers
 * so that pages created here and pages created elsewhere follow the identical code path.
 */
export class PageCommands {
  constructor(
    private readonly app: App,
    private readonly index: PageIndex,
    private readonly orderManager: OrderManager,
  ) {}

  // ---------------------------------------------------------------- creating

  /**
   * The generic "add a page" entry point, with a parent to choose.
   *
   * It defaults to the folder of the page that is open — which used to be the *only* thing it
   * could do, so putting a page anywhere else meant opening a page there first. That is what sent
   * users to Obsidian's *New folder* instead, and a bare folder is something Azure DevOps cannot
   * represent at all (`folderPlan.ts`).
   */
  promptNewPage(): void {
    const folderPath = this.activeEntry()?.folderPath ?? "";
    this.promptCreate(S.modals.newPageTitle, folderPath, this.parentChoices());
  }

  promptNewSubpage(): void {
    const parent = this.activeEntry();
    if (!parent) {
      new Notice(S.notices.noActivePage);
      return;
    }
    this.promptNewSubpageFor(parent);
  }

  /** Same prompt, for a page picked in the wiki tree rather than the active one. */
  promptNewSubpageFor(parent: PageEntry): void {
    // A page's subpages live in the folder that pairs with its file name.
    this.promptCreate(S.modals.newSubpageTitle(parent.title), stripMdExtension(parent.file.path));
  }

  private promptCreate(heading: string, folderPath: string, parents?: ParentChoice[]): void {
    new TitlePromptModal(this.app, {
      heading,
      cta: S.modals.create,
      folderPath,
      parents,
      validate: (title, folder) => this.validate(title, folder),
      onSubmit: (result, folder) => void this.createPage(result, folder),
    }).open();
  }

  /**
   * Every place a page can go: the wiki root, plus the subpage folder of every existing page.
   *
   * Listed by decoded title path so the dropdown reads like the wiki, and sorted so it stays
   * stable — a page's `.order` position decides where it renders, not where it is offered here.
   */
  private parentChoices(): ParentChoice[] {
    const choices = this.index
      .all()
      .map((entry) => ({
        folderPath: stripMdExtension(entry.file.path),
        label: entry.titlePath,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [{ folderPath: "", label: S.modals.parentRoot }, ...choices];
  }

  private async createPage(result: ValidationResult, folderPath: string): Promise<void> {
    try {
      await this.ensureFolder(folderPath);
      const file = await this.app.vault.create(result.path, "");
      await this.orderManager.idle();
      await this.app.workspace.getLeaf(false).openFile(file);
      new Notice(S.notices.pageCreated(result.title));
    } catch (error) {
      new Notice(S.notices.failed("create the page", messageOf(error)));
    }
  }

  /**
   * The same prompt, awaited — for Obsidian's own **New note** and **New folder**, which have to
   * be handed the file they asked for (`creationInterceptor.ts`).
   *
   * It does not open the page: the caller returns it to Obsidian, which opens or reveals it
   * itself, and opening it twice fights that.
   *
   * @param withSubpageFolder create the paired subpage folder too — what "New folder" means in a
   *   format that has pages rather than folders.
   * @returns the new page, or null if the user cancelled or it could not be created.
   */
  createPageByPrompt(folderPath: string, withSubpageFolder: boolean): Promise<TFile | null> {
    return new Promise((resolve) => {
      let settled = false;
      // One resolve either way: an unanswered promise here would hang Obsidian's own command.
      const finish = (file: TFile | null): void => {
        if (settled) return;
        settled = true;
        resolve(file);
      };

      new TitlePromptModal(this.app, {
        heading: withSubpageFolder ? S.modals.newSectionTitle : S.modals.newPageTitle,
        cta: S.modals.create,
        folderPath,
        parents: this.parentChoices(),
        validate: (title, folder) => this.validate(title, folder),
        onSubmit: (result, folder) => {
          void this.createForHost(result, folder, withSubpageFolder).then(finish);
        },
        onCancel: () => finish(null),
      }).open();
    });
  }

  private async createForHost(
    result: ValidationResult,
    folderPath: string,
    withSubpageFolder: boolean,
  ): Promise<TFile | null> {
    try {
      await this.ensureFolder(folderPath);
      const file = await this.app.vault.create(result.path, "");
      // The paired folder is what makes this page able to hold subpages; creating it up front is
      // the whole difference between "New folder" and "New note" in a wiki.
      if (withSubpageFolder) await this.ensureFolder(stripMdExtension(result.path));
      await this.orderManager.idle();
      new Notice(S.notices.pageCreated(result.title));
      return file;
    } catch (error) {
      new Notice(S.notices.failed("create the page", messageOf(error)));
      return null;
    }
  }

  // ---------------------------------------------------------------- renaming

  promptRename(): void {
    const entry = this.activeEntry();
    if (!entry) {
      new Notice(S.notices.noActivePage);
      return;
    }
    this.promptRenameFor(entry);
  }

  promptRenameFor(entry: PageEntry): void {
    new TitlePromptModal(this.app, {
      heading: S.modals.renameTitle,
      cta: S.modals.rename,
      initialValue: entry.title,
      // No parent picker: moving a page is a different operation (it has to carry its subpage
      // folder and rewrite every inbound link), and hiding it inside Rename would make one
      // large silent commit reachable by picking the wrong row of a dropdown.
      folderPath: entry.folderPath,
      validate: (title) => this.validate(title, entry.folderPath, entry.file.name),
      onSubmit: (result) => void this.renamePage(entry, result),
    }).open();
  }

  private async renamePage(entry: PageEntry, result: ValidationResult): Promise<void> {
    const oldTitle = entry.title;
    const oldWikiPath = entry.wikiPath;
    const oldFileName = entry.file.name;
    const pairedFolder = this.pairedFolderOf(entry);

    try {
      await this.app.fileManager.renameFile(entry.file, result.path);

      // Subpages live in the paired folder, so it has to follow the page's new name.
      if (pairedFolder) {
        const newFolderPath = joinPath(entry.folderPath, stripMdExtension(result.fileName));
        await this.app.fileManager.renameFile(pairedFolder, newFolderPath);
      }

      await this.orderManager.idle();
      const newWikiPath = wikiPathFromVaultPath(result.path);
      const updated = await this.updateInboundLinks(oldWikiPath, newWikiPath, {
        oldFileName,
        newFileName: result.fileName,
      });

      new Notice(S.notices.pageRenamed(oldTitle, result.title));
      if (updated.links > 0) {
        new Notice(S.notices.linksUpdated(updated.links, updated.files));
      }
    } catch (error) {
      new Notice(S.notices.failed("rename the page", messageOf(error)));
    }
  }

  /**
   * Rewrite every link that pointed at the old page — including links to its subpages,
   * whose paths moved with the paired folder.
   *
   * Every page is read (through the metadata cache, so this is cheap) rather than trusting
   * a pre-filter: Obsidian normalizes link targets in its cache, which would hide the
   * percent-encoded paths this format depends on.
   */
  private async updateInboundLinks(
    oldWikiPath: string,
    newWikiPath: string,
    fileNames: { oldFileName: string; newFileName: string },
  ): Promise<{ links: number; files: number }> {
    const absolute = buildRenameReplacements(oldWikiPath, newWikiPath);
    const relative = buildRenameReplacements(oldWikiPath, newWikiPath, fileNames);
    const oldFolder = folderPathOfPath(oldWikiPath.slice(1));

    let links = 0;
    let files = 0;

    for (const file of this.app.vault.getMarkdownFiles()) {
      // Relative links only resolve for pages that sat beside the renamed one.
      const entry = this.index.forFile(file);
      const replacements = entry?.folderPath === oldFolder ? relative : absolute;

      const content = await this.app.vault.cachedRead(file);
      const result = rewriteLinkTargets(content, replacements);
      if (result.count === 0) continue;

      await this.app.vault.modify(file, result.content);
      links += result.count;
      files++;
    }

    return { links, files };
  }

  // ---------------------------------------------------------------- deleting

  promptDelete(): void {
    const entry = this.activeEntry();
    if (!entry) {
      new Notice(S.notices.noActivePage);
      return;
    }
    this.promptDeleteFor(entry);
  }

  promptDeleteFor(entry: PageEntry): void {
    // Deleting a page whose folder still holds subpages would orphan them in the wiki.
    const subpages = this.index.childrenOf(entry);
    if (subpages.length > 0) {
      new Notice(S.notices.deleteHasSubpages(entry.title, subpages.length));
      return;
    }

    new ConfirmModal(this.app, {
      heading: S.modals.deleteConfirmTitle,
      body: S.modals.deleteConfirmBody(entry.title),
      cta: S.modals.delete,
      destructive: true,
      onConfirm: () => void this.deletePage(entry),
    }).open();
  }

  private async deletePage(entry: PageEntry): Promise<void> {
    const pairedFolder = this.pairedFolderOf(entry);
    try {
      await this.app.fileManager.trashFile(entry.file);
      // An empty paired folder left behind would render as a blank node in the wiki.
      if (pairedFolder && pairedFolder.children.length === 0) {
        await this.app.fileManager.trashFile(pairedFolder);
      }
      await this.orderManager.idle();
      new Notice(S.notices.pageDeleted(entry.title));
    } catch (error) {
      new Notice(S.notices.failed("delete the page", messageOf(error)));
    }
  }

  /**
   * Rename a page to the Azure DevOps-portable spelling of the title it already shows, without
   * asking — the fix for a page Obsidian's own *New note* has just created.
   *
   * `7.4 New Test Page.md` has literal spaces, and Azure DevOps answers such a page with
   * *"the page's title … does not conform to Wiki standards"* (PLAN note 12, confirmed in the
   * user's wiki). Nothing but the file name changes: the title the user typed survives the round
   * trip through the codec, which is exactly what makes it safe to do silently.
   *
   * @returns the new title on success, or null when there is nothing to fix or the rename failed.
   */
  async renameToPortableName(entry: PageEntry): Promise<string | null> {
    const result = this.validate(entry.title, entry.folderPath, entry.file.name);
    if (!result.ok || result.path === entry.file.path) return null;

    try {
      await this.app.fileManager.renameFile(entry.file, result.path);
      await this.orderManager.idle();
      return result.title;
    } catch {
      // The caller falls back to offering the Rename dialog, which can explain what went wrong.
      return null;
    }
  }

  // ------------------------------------------------------------- page order

  /**
   * Move a page one place up or down among its siblings, writing `.order`.
   *
   * This exists as a command and a context-menu item, not only as a drag in the wiki tree,
   * because Obsidian's own file explorer *cannot* show the wiki's order: it sorts alphabetically
   * and puts folders first, so a page with subpages jumps above its siblings (7.2 above 7.1 in the
   * reported screenshot) no matter what `.order` says. Users work in that explorer, so the way to
   * reorder has to be reachable from there — the wiki tree is where the result becomes visible.
   */
  async movePage(entry: PageEntry, delta: -1 | 1): Promise<void> {
    const moved = namesWithOffset(
      this.index.pageNamesInFolder(entry.folderPath),
      entry.name,
      delta,
    );
    if (!moved) {
      new Notice(S.notices.orderAtEdge(entry.title));
      return;
    }
    try {
      await this.orderManager.reorder(entry.folderPath, moved);
      new Notice(S.notices.orderMoved(entry.title, delta < 0 ? "up" : "down"));
    } catch (error) {
      new Notice(S.notices.failed("save the page order", messageOf(error)));
    }
  }

  /** First entry of the root `.order` — which is what makes a page the wiki's home page. */
  async setHomePage(entry: PageEntry): Promise<void> {
    try {
      await this.orderManager.setFirst("", entry.name);
      new Notice(S.notices.homePageSet(entry.title));
    } catch (error) {
      new Notice(S.notices.failed("set the home page", messageOf(error)));
    }
  }

  /** Where a page sits in its parent's sequence, and how long that sequence is. */
  positionOf(entry: PageEntry): { index: number; total: number } {
    const siblings = this.index.pageNamesInFolder(entry.folderPath);
    return { index: siblings.indexOf(entry.name), total: siblings.length };
  }

  // -------------------------------------------------------- .order maintenance

  async repairOrderFiles(): Promise<void> {
    try {
      const summary = await this.orderManager.repairAll();
      new Notice(
        S.notices.orderRepaired(summary.foldersChanged.length, summary.added, summary.removed),
      );
    } catch (error) {
      new Notice(S.notices.failed("repair the .order files", messageOf(error)));
    }
  }

  // ------------------------------------------------------------------ helpers

  private validate(title: string, folderPath: string, currentFileName?: string): ValidationResult {
    return validateTitle({
      title,
      folderPath,
      siblingFileNames: this.index.siblingFileNames(folderPath),
      currentFileName,
    });
  }

  private activeEntry(): PageEntry | null {
    const file = this.app.workspace.getActiveFile();
    return file ? this.index.forFile(file) : null;
  }

  private pairedFolderOf(entry: PageEntry): TFolder | null {
    const folder = this.app.vault.getAbstractFileByPath(stripMdExtension(entry.file.path));
    return folder instanceof TFolder ? folder : null;
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    if (folderPath.length === 0) return;
    const existing = this.app.vault.getAbstractFileByPath(folderPath);
    if (existing instanceof TFolder) return;
    if (existing instanceof TFile) throw new Error(`"${folderPath}" is a file, not a folder.`);
    await this.app.vault.createFolder(folderPath);
  }
}

function folderPathOfPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
