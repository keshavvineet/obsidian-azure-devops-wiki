import { debounce, ItemView, Keymap, setIcon, type WorkspaceLeaf } from "obsidian";
import { OBSIDIAN_CONFIG_DIR } from "../constants";
import { decodeFileName, stripMdExtension } from "../naming/pageNameCodec";
import type { PageIndex } from "../pages/pageIndex";
import { S } from "../strings";
import type { GitService } from "./gitService";
import { pagesOf, type WikiCommit } from "./gitLog";
import { formatRelativeTime, type ChangedFile, type GitStatus } from "./gitStatus";
import { RowKeyboardNav } from "../util/rowKeyboardNav";

export const WIKI_CHANGES_VIEW = "adowiki-wiki-changes";

export interface WikiChangesDeps {
  /** Null when the vault is not a folder on disk; the view then says so and offers nothing. */
  git: GitService | null;
  index: PageIndex;
  /** The git state the status bar last read — one source for every view that shows it. */
  status: () => GitStatus | null;
  busy: () => boolean;
  refresh: () => void;
  publish: () => void;
}

/**
 * "Wiki changes" sidebar: what is not published yet, and what changed recently (FR-7.8).
 *
 * The two questions this answers are the ones a non-technical author actually asks — "did my edit
 * reach the team" and "what did everyone else change" — so the pane is deliberately two lists and
 * two buttons, with no git vocabulary in it. Every page name is a decoded title, and clicking one
 * opens it, which is the whole point of showing it.
 *
 * It reads git through the injected service and never writes: the two buttons hand off to the same
 * Refresh/Sync flows the ribbon and the toolbar use.
 */
export class WikiChangesView extends ItemView {
  private commits: WikiCommit[] = [];
  private loadingCommits = false;
  private expanded = new Set<string>();
  private keyboard: RowKeyboardNav | null = null;

  /** Status arrives on a timer and in bursts around a sync; one render will do. */
  private readonly scheduleRender = debounce(() => this.render(), 100, true);
  /** `git log` is cheap but not free, and the status poll fires every minute. */
  private readonly scheduleCommitLoad = debounce(() => void this.loadCommits(), 2000, false);

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: WikiChangesDeps,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return WIKI_CHANGES_VIEW;
  }

  override getDisplayText(): string {
    return S.changes.title;
  }

  override getIcon(): string {
    return "history";
  }

  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("adowiki-changes");

    // A page renamed or created elsewhere changes the titles this pane shows.
    this.register(this.deps.index.onChange(() => this.scheduleRender()));

    this.render();
    await this.loadCommits();
  }

  override async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** Draw even if the host called no lifecycle hook — see `wikiTreeView.ensureVisible`. */
  ensureVisible(): void {
    this.render();
  }

  /** Called by the git status bar after every status read. */
  onStatusChange(): void {
    this.scheduleRender();
    this.scheduleCommitLoad();
  }

  private async loadCommits(): Promise<void> {
    const git = this.deps.git;
    if (!git || this.loadingCommits) return;

    this.loadingCommits = true;
    try {
      this.commits = await git.recentCommits(15);
    } catch {
      // Not a repository, no commits yet, or git is missing — the empty list says it.
      this.commits = [];
    } finally {
      this.loadingCommits = false;
      this.render();
    }
  }

  // --------------------------------------------------------------- rendering

  private render(): void {
    const root = this.contentEl;
    // Created on the first render rather than in onOpen: the two lists share one navigation, so
    // it has to own the element that contains both of them.
    this.keyboard ??= new RowKeyboardNav(root);

    this.keyboard.beginRender();
    root.empty();

    this.renderActions(root);
    this.renderLocalChanges(root);
    this.renderHistory(root);
    this.keyboard.endRender();
  }

  private renderActions(root: HTMLElement): void {
    const bar = root.createDiv({ cls: "adowiki-changes__actions" });
    const busy = this.deps.busy();

    const pull = bar.createEl("button", { cls: "adowiki-changes__action" });
    setIcon(pull.createSpan({ cls: "adowiki-changes__action-icon" }), "download-cloud");
    pull.createSpan({ text: S.toolbar.getUpdates });
    pull.disabled = busy;
    pull.addEventListener("click", () => this.deps.refresh());

    const push = bar.createEl("button", {
      cls: "adowiki-changes__action adowiki-changes__action--primary",
    });
    setIcon(push.createSpan({ cls: "adowiki-changes__action-icon" }), "upload-cloud");
    push.createSpan({ text: S.toolbar.publish });
    push.disabled = busy;
    push.addEventListener("click", () => this.deps.publish());
  }

  private renderLocalChanges(root: HTMLElement): void {
    const status = this.deps.status();
    const files = (status?.files ?? []).filter((file) => !isNoise(file));

    const section = root.createDiv({ cls: "adowiki-changes__section" });
    section.createDiv({
      cls: "adowiki-changes__heading",
      text: S.changes.pendingHeading(files.length),
    });

    if (!this.deps.git) {
      section.createDiv({ cls: "adowiki-changes__empty", text: S.changes.noRepo });
      return;
    }
    if (files.length === 0) {
      section.createDiv({
        cls: "adowiki-changes__empty",
        text: status === null ? S.changes.notReadYet : S.changes.nothingPending,
      });
      return;
    }

    for (const file of files) {
      const row = section.createDiv({ cls: "adowiki-changes__row is-clickable" });
      row.createSpan({
        cls: `adowiki-changes__badge adowiki-changes__badge--${file.kind}`,
        text: S.changes.kindLabel[file.kind],
      });
      row.createSpan({ cls: "adowiki-changes__name", text: this.labelFor(file.path) });
      // A deleted page cannot be opened, and neither can an attachment in an Obsidian leaf.
      if (file.kind === "deleted" || !file.path.toLowerCase().endsWith(".md")) {
        row.addClass("adowiki-changes__row--inert");
        continue;
      }
      row.addEventListener("click", (event) => void this.openPage(file.path, event));
      this.keyboard?.register(row, `pending:${file.path}`, {
        activate: (event) => void this.openPage(file.path, event),
      });
    }
  }

  private renderHistory(root: HTMLElement): void {
    const section = root.createDiv({ cls: "adowiki-changes__section" });
    section.createDiv({ cls: "adowiki-changes__heading", text: S.changes.recentHeading });

    if (!this.deps.git) return;
    if (this.commits.length === 0) {
      section.createDiv({
        cls: "adowiki-changes__empty",
        text: this.loadingCommits ? S.changes.loading : S.changes.noHistory,
      });
      return;
    }

    const now = Date.now();
    for (const commit of this.commits) {
      const pages = pagesOf(commit);
      const item = section.createDiv({ cls: "adowiki-changes__commit" });
      const row = item.createDiv({ cls: "adowiki-changes__row is-clickable" });

      const toggle = row.createDiv({ cls: "adowiki-changes__toggle" });
      if (pages.length > 0) {
        setIcon(toggle, this.expanded.has(commit.sha) ? "chevron-down" : "chevron-right");
      }

      const text = row.createDiv({ cls: "adowiki-changes__commit-text" });
      text.createDiv({ cls: "adowiki-changes__subject", text: commit.subject });
      text.createDiv({
        cls: "adowiki-changes__meta",
        text: S.changes.commitMeta(
          commit.author,
          commit.timestamp === null
            ? S.changes.unknownTime
            : formatRelativeTime(commit.timestamp, now),
          pages.length,
        ),
      });

      const toggleCommit = (): void => {
        if (pages.length === 0) return;
        if (this.expanded.has(commit.sha)) this.expanded.delete(commit.sha);
        else this.expanded.add(commit.sha);
        this.render();
      };
      row.addEventListener("click", toggleCommit);

      const isExpanded = this.expanded.has(commit.sha);
      if (pages.length > 0) row.setAttribute("aria-expanded", String(isExpanded));
      this.keyboard?.register(row, `commit:${commit.sha}`, {
        activate: toggleCommit,
        expand: pages.length > 0 && !isExpanded ? toggleCommit : undefined,
        collapse: isExpanded ? toggleCommit : undefined,
      });

      if (!isExpanded) continue;
      const list = item.createDiv({ cls: "adowiki-changes__pages" });
      for (const page of pages) {
        const pageRow = list.createDiv({ cls: "adowiki-changes__row is-clickable" });
        pageRow.createSpan({ cls: "adowiki-changes__name", text: this.labelFor(page) });
        // A page that has since been deleted or renamed is not in the index any more.
        if (!this.deps.index.forPath(page)) {
          pageRow.addClass("adowiki-changes__row--inert");
          pageRow.setAttribute("aria-label", S.changes.pageGone);
          continue;
        }
        pageRow.addEventListener("click", (event) => void this.openPage(page, event));
        this.keyboard?.register(pageRow, `commit:${commit.sha}:${page}`, {
          activate: (event) => void this.openPage(page, event),
        });
      }
    }
  }

  // ---------------------------------------------------------------- behaviour

  /**
   * The `TFile`, never `openLinkText`: an ADO page name is full of characters the link resolver
   * treats as meaningful (`%3F`, `%7C`, dots), and an unresolved link makes it *create* the file —
   * which in this vault is a new wiki page waiting to be published.
   */
  private async openPage(vaultPath: string, event: MouseEvent | KeyboardEvent): Promise<void> {
    event.stopPropagation();
    const entry = this.deps.index.forPath(vaultPath);
    if (!entry) return; // the row is inert in this case and has no click handler
    await this.app.workspace.getLeaf(Keymap.isModEvent(event)).openFile(entry.file);
  }

  /** The decoded page title where we know it, and a decoded file name where we do not. */
  private labelFor(repoPath: string): string {
    const entry = this.deps.index.forPath(repoPath);
    if (entry) return entry.title;

    const name = repoPath.split("/").pop() ?? repoPath;
    if (!name.toLowerCase().endsWith(".md")) return repoPath;
    return decodeFileName(stripMdExtension(name));
  }
}

/**
 * `.obsidian/` is this app's own configuration, which the sync deliberately never publishes —
 * listing it as a pending wiki change would be a lie the user cannot act on.
 */
function isNoise(file: ChangedFile): boolean {
  return file.kind === "untracked" && file.path.startsWith(OBSIDIAN_CONFIG_DIR);
}
