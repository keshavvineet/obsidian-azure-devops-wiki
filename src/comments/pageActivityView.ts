import { ItemView, Notice, TFile, type WorkspaceLeaf, debounce } from "obsidian";
import type { GitService } from "../git/gitService";
import { formatRelativeTime } from "../git/gitStatus";
import type { WikiCommit } from "../git/gitLog";
import type { PageEntry, PageIndex } from "../pages/pageIndex";
import { S } from "../strings";
import { RowKeyboardNav } from "../util/rowKeyboardNav";
import type { WikiComment } from "./wikiComments";
import type { WikiCommentsClient } from "./wikiCommentsClient";

export const PAGE_ACTIVITY_VIEW = "adowiki-page-activity";

export interface PageActivityDeps {
  index: PageIndex;
  /** Null when the vault is not a folder on disk — history is then simply absent. */
  git: GitService | null;
  comments: WikiCommentsClient;
  openSettings: () => void;
}

/**
 * "Page activity": who changed the page that is open, and the comments on it in Azure DevOps
 * (round-7 report 4; PLAN feature request 2).
 *
 * The two halves come from completely different places, and the pane is honest about it:
 *
 *  - **History** is `git log` for this file, so it is free, offline, and as current as the last
 *    Refresh. It is what this clone knows.
 *  - **Comments** live in Azure DevOps' own database, not the repository — Microsoft's
 *    documentation is explicit about that — so they need the REST API and a PAT. Without one the
 *    pane says which setting is missing instead of showing an empty list, because "no comments"
 *    and "cannot ask" look identical and mean opposite things.
 *
 * Everything is scoped to the page in the active tab and re-read when it changes.
 */
export class PageActivityView extends ItemView {
  private entry: PageEntry | null = null;
  private commits: WikiCommit[] = [];
  private comments: WikiComment[] = [];
  private commentsState: "idle" | "loading" | "ready" | CommentsProblem = "idle";
  private draft = "";
  private posting = false;
  private keyboard: RowKeyboardNav | null = null;

  /** Switching tabs quickly must not queue a REST call per tab. */
  private readonly scheduleLoad = debounce(() => void this.reload(), 250, true);

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: PageActivityDeps,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return PAGE_ACTIVITY_VIEW;
  }

  override getDisplayText(): string {
    return S.activity.title;
  }

  override getIcon(): string {
    return "message-square";
  }

  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("adowiki-activity");
    this.keyboard = new RowKeyboardNav(this.contentEl);

    this.registerEvent(this.app.workspace.on("file-open", () => this.scheduleLoad()));
    // A rename changes the page's path, and with it the id the comment routes are keyed by.
    this.register(
      this.deps.index.onChange(() => {
        this.deps.comments.forgetPageIds();
        this.scheduleLoad();
      }),
    );

    await this.reload();
  }

  override async onClose(): Promise<void> {
    this.contentEl.empty();
    this.keyboard = null;
  }

  /** Draw even if the host called no lifecycle hook — see `wikiTreeView.ensureVisible`. */
  ensureVisible(): void {
    void this.reload();
  }

  /** Called after a Refresh or Publish: the history has moved on. */
  onStatusChange(): void {
    this.scheduleLoad();
  }

  /** Named `reload`, not `load`: `Component.load()` is the host's own lifecycle hook. */
  private async reload(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    const entry = file instanceof TFile ? this.deps.index.forFile(file) : null;
    this.entry = entry;
    this.commits = [];
    this.comments = [];
    this.commentsState = "idle";
    this.render();
    if (!entry) return;

    // History first and on its own: it always works, and waiting for a REST round trip before
    // showing it would make the offline half feel as slow as the online one.
    this.commits = (await this.deps.git?.fileHistory(entry.file.path, 15)) ?? [];
    if (this.entry !== entry) return; // the user moved on while git was reading
    this.render();

    this.commentsState = "loading";
    this.render();
    const result = await this.deps.comments.list(entry.titlePath);
    if (this.entry !== entry) return;

    if (result.ok) {
      this.comments = result.comments;
      this.commentsState = "ready";
    } else {
      this.commentsState = result.reason;
    }
    this.render();
  }

  // --------------------------------------------------------------- rendering

  private render(): void {
    const root = this.contentEl;
    this.keyboard?.beginRender();
    root.empty();

    if (!this.entry) {
      root.createDiv({ cls: "adowiki-activity__empty", text: S.activity.noPage });
      this.keyboard?.endRender();
      return;
    }

    root.createDiv({ cls: "adowiki-activity__page", text: this.entry.title });
    this.renderComments(root);
    this.renderHistory(root);
    this.keyboard?.endRender();
  }

  private renderComments(root: HTMLElement): void {
    const section = root.createDiv({ cls: "adowiki-activity__section" });
    section.createDiv({ cls: "adowiki-activity__heading", text: S.activity.commentsHeading });

    if (this.commentsState === "loading" || this.commentsState === "idle") {
      section.createDiv({ cls: "adowiki-activity__empty", text: S.activity.loading });
      return;
    }
    if (this.commentsState !== "ready") {
      this.renderCommentsProblem(section, this.commentsState);
      return;
    }

    if (this.comments.length === 0) {
      section.createDiv({ cls: "adowiki-activity__empty", text: S.activity.noComments });
    }
    const now = Date.now();
    for (const comment of this.comments) {
      const row = section.createDiv({ cls: "adowiki-activity__comment" });
      // A reply is indented rather than nested: the API gives one flat list with a parentId.
      if (comment.parentId !== null) row.addClass("adowiki-activity__comment--reply");

      const meta = row.createDiv({ cls: "adowiki-activity__meta" });
      meta.createSpan({
        cls: "adowiki-activity__author",
        text: comment.author.length > 0 ? comment.author : S.activity.unknownAuthor,
      });
      meta.createSpan({ cls: "adowiki-activity__when", text: whenOf(comment.createdDate, now) });
      // Comment text is markdown in the portal, but it arrives as untrusted text from other
      // users — it goes in as text, never as HTML.
      row.createDiv({ cls: "adowiki-activity__text", text: comment.text });

      this.keyboard?.register(row, `comment:${comment.id}`);
    }

    this.renderComposer(section);
  }

  private renderCommentsProblem(section: HTMLElement, problem: CommentsProblem): void {
    const text =
      problem === "not-configured"
        ? S.activity.notConfigured
        : problem === "unauthorized"
          ? S.activity.unauthorized
          : problem === "no-such-page"
            ? S.activity.notPublished
            : S.activity.commentsFailed;
    section.createDiv({ cls: "adowiki-activity__problem", text });

    if (problem === "not-configured" || problem === "unauthorized") {
      const button = section.createEl("button", {
        cls: "adowiki-activity__action",
        text: S.activity.openSettings,
      });
      button.addEventListener("click", () => this.deps.openSettings());
      return;
    }
    const retry = section.createEl("button", {
      cls: "adowiki-activity__action",
      text: S.activity.retry,
    });
    retry.addEventListener("click", () => void this.reload());
  }

  private renderComposer(section: HTMLElement): void {
    const composer = section.createDiv({ cls: "adowiki-activity__composer" });
    const input = composer.createEl("textarea", {
      cls: "adowiki-activity__input",
      attr: { rows: "3", placeholder: S.activity.commentPlaceholder },
    });
    input.value = this.draft;
    input.disabled = this.posting;
    input.addEventListener("input", () => {
      // Kept on the view, not re-rendered from: a redraw mid-sentence must not lose the text.
      this.draft = input.value;
      post.disabled = this.posting || input.value.trim().length === 0;
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      void this.post();
    });

    const post = composer.createEl("button", {
      cls: "adowiki-activity__action mod-cta",
      text: this.posting ? S.activity.posting : S.activity.postComment,
    });
    post.disabled = this.posting || this.draft.trim().length === 0;
    post.addEventListener("click", () => void this.post());
    composer.createDiv({ cls: "adowiki-activity__hint", text: S.activity.postHint });
  }

  private renderHistory(root: HTMLElement): void {
    const section = root.createDiv({ cls: "adowiki-activity__section" });
    section.createDiv({ cls: "adowiki-activity__heading", text: S.activity.historyHeading });

    if (!this.deps.git) {
      section.createDiv({ cls: "adowiki-activity__empty", text: S.activity.noRepo });
      return;
    }
    if (this.commits.length === 0) {
      section.createDiv({ cls: "adowiki-activity__empty", text: S.activity.noHistory });
      return;
    }

    const now = Date.now();
    for (const commit of this.commits) {
      const row = section.createDiv({ cls: "adowiki-activity__commit" });
      row.createDiv({ cls: "adowiki-activity__subject", text: commit.subject });
      row.createDiv({
        cls: "adowiki-activity__meta",
        text: S.activity.commitMeta(commit.author, whenOf(commit.timestamp, now)),
      });
      this.keyboard?.register(row, `commit:${commit.sha}`);
    }
  }

  private async post(): Promise<void> {
    const entry = this.entry;
    const text = this.draft.trim();
    if (!entry || text.length === 0 || this.posting) return;

    this.posting = true;
    this.render();
    const result = await this.deps.comments.add(entry.titlePath, text);
    this.posting = false;

    if (!result.ok) {
      new Notice(
        result.reason === "unauthorized"
          ? S.activity.unauthorized
          : S.notices.failed("add the comment", result.detail ?? S.activity.commentsFailed),
        10_000,
      );
      this.render();
      return;
    }

    // Only cleared once it is really posted, so a failure never loses what was typed.
    this.draft = "";
    await this.reload();
  }
}

type CommentsProblem = "not-configured" | "unauthorized" | "no-such-page" | "failed";

function whenOf(timestamp: string | number | null, now: number): string {
  if (timestamp === null) return S.activity.unknownTime;
  const millis = typeof timestamp === "number" ? timestamp : Date.parse(timestamp);
  if (Number.isNaN(millis)) return S.activity.unknownTime;
  return formatRelativeTime(millis, now);
}
