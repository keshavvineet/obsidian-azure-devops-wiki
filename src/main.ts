import {
  Editor,
  editorInfoField,
  FileSystemAdapter,
  Hotkey,
  MarkdownFileInfo,
  MarkdownRenderChild,
  MarkdownRenderer,
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import type { EditorState } from "@codemirror/state";
import { DEFAULT_WIKI_BRANCH, OBSIDIAN_CONFIG_DIR } from "./constants";
import { GitService } from "./git/gitService";
import { dirtyCount, type ChangeKind } from "./git/gitStatus";
import { branchToAdopt } from "./git/wikiBranch";
import { GitStatusBar } from "./git/gitStatusBar";
import { SyncOrchestrator } from "./git/syncOrchestrator";
import { ObsidianSyncUi } from "./git/syncUi";
import { WIKI_CHANGES_VIEW, WikiChangesView } from "./git/wikiChangesView";
import { PAGE_ACTIVITY_VIEW, PageActivityView } from "./comments/pageActivityView";
import { WikiCommentsClient } from "./comments/wikiCommentsClient";
import { CompatLinter } from "./lint/compatLinter";
import { countBySeverity } from "./lint/lintEngine";
import { LINT_VIEW, LintView, type LintScope } from "./lint/lintView";
import { SetupCheck } from "./setup/setupCheck";
import { AdoLinkService } from "./links/adoLinkService";
import { wikiRelativePath, wikiWebUrl } from "./links/adoWebUrl";
import { adoLivePreview } from "./links/livePreviewExtension";
import { AttachmentPasteHandler } from "./links/pasteHandler";
import { AdoReadingProcessor } from "./links/readingModeProcessor";
import { WikilinkInterceptor } from "./links/wikilinkInterceptor";
import { nonPortableSegments } from "./naming/portableName";
import { TitleDecorator } from "./naming/titleDecorator";
import { OrderManager } from "./order/orderManager";
import { PageCommands } from "./pages/pageCommands";
import { PageIndex } from "./pages/pageIndex";
import { PageNameGuard } from "./pages/pageNameGuard";
import { FolderGuard } from "./pages/folderGuard";
import { CreationInterceptor } from "./pages/creationInterceptor";
import { WikiPageSwitcher } from "./pages/pageSwitcher";
import { WIKI_TREE_VIEW, WikiTreeView } from "./pages/wikiTreeView";
import { AdoWikiSettings, DEFAULT_SETTINGS, AdoWikiSettingTab } from "./settings";
import { S } from "./strings";
import * as actions from "./toolbar/formatActions";
import { ToolbarManager } from "./toolbar/toolbarView";
import { AdoClient, resolvePat } from "./workitems/adoClient";
import { WorkItemHover } from "./workitems/workItemHover";
import { WorkItemSuggest } from "./workitems/workItemSuggest";

/**
 * Azure DevOps Wiki plugin — entry point.
 *
 * Subsystems are wired here as their phases land (see PLAN.md):
 *   Phase 1 ✅ pageIndex, orderManager, pageCommands
 *   Phase 2 ✅ titleDecorator, wikiTreeView, page switcher
 *   Phase 3 ✅ gitService, syncOrchestrator, gitStatusBar
 *   Phase 4 ✅ adoLinkService, reading-mode + live-preview renderers, pasteHandler, linkConverter
 *   Phase 5 ✅ toolbar, work-item client/suggester/hover, open-in-ADO, commit identity
 *   Phase 6: compatLinter
 */
export default class AdoWikiPlugin extends Plugin {
  settings: AdoWikiSettings = DEFAULT_SETTINGS;
  index!: PageIndex;
  orderManager!: OrderManager;
  links!: AdoLinkService;
  workItems!: AdoClient;
  linter!: CompatLinter;
  /** Null when the vault is not backed by a real folder (no git possible). */
  git: GitService | null = null;
  syncOrchestrator: SyncOrchestrator | null = null;
  private gitBar: GitStatusBar | null = null;
  /** Vault paths git reports as locally changed, so the explorer and tree can mark them. */
  private changedPaths = new Map<string, ChangeKind>();
  private pageCommands!: PageCommands;
  private nameGuard!: PageNameGuard;
  private folderGuard!: FolderGuard;
  /** True between the start and end of a Refresh or Publish — the FolderGuard stands down. */
  private syncFlowActive = false;
  private titleDecorator!: TitleDecorator;
  private wikilinks!: WikilinkInterceptor;
  private paste!: AttachmentPasteHandler;
  private toolbar!: ToolbarManager;
  private comments!: WikiCommentsClient;

  override async onload(): Promise<void> {
    await this.loadSettings();

    this.index = new PageIndex(this.app);
    this.orderManager = new OrderManager(this.app, this.index);
    this.pageCommands = new PageCommands(this.app, this.index, this.orderManager);
    this.nameGuard = new PageNameGuard(this.index, this.pageCommands, () => void this.runLint("vault"));
    this.folderGuard = new FolderGuard(this.app, this.orderManager, () => this.syncFlowActive);
    // Ask for the title before anything is written, so a name Azure DevOps cannot open never
    // exists on disk — not even for the moment it takes a guard to repair it.
    this.register(
      new CreationInterceptor(
        this.app,
        this.pageCommands,
        () => this.settings.promptForPageName,
      ).install(),
    );
    this.titleDecorator = new TitleDecorator(this.app, this.index, () => ({
      decodeTitles: this.settings.decorateFileExplorer,
      singleRowPerPage: this.settings.singleRowPerPage,
      markChanges: this.settings.gitEnabled && this.settings.markChangedPages,
      changeKindOf: (path) => this.changedPaths.get(path) ?? null,
    }));
    this.links = new AdoLinkService(this.app, this.index, () => this.settings);
    this.linter = new CompatLinter(this.app, this.index, this.links, () => this.settings);
    this.wikilinks = new WikilinkInterceptor(this.app, this.links, () => this.settings);
    this.workItems = new AdoClient(() => ({
      organizationUrl: this.settings.organizationUrl,
      project: this.settings.project,
      pat: resolvePat(this.settings.pat, process.env.ADO_WIKI_PAT),
    }));
    // Comments are the one thing that is not in the repository (Microsoft store them in their own
    // database), so this is the only feature a PAT is genuinely required for.
    this.comments = new WikiCommentsClient(() => ({
      organizationUrl: this.settings.organizationUrl,
      project: this.settings.project,
      wikiName: this.settings.wikiName,
      pat: resolvePat(this.settings.pat, process.env.ADO_WIKI_PAT),
    }));
    this.setupGit();
    this.setupRendering();
    this.setupEditing();
    this.setupToolbar();
    this.setupWorkItems();

    this.registerView(
      WIKI_TREE_VIEW,
      (leaf: WorkspaceLeaf) =>
        new WikiTreeView(leaf, {
          index: this.index,
          orderManager: this.orderManager,
          pageCommands: this.pageCommands,
          changeKindOf: (path) =>
            this.settings.markChangedPages ? (this.changedPaths.get(path) ?? null) : null,
        }),
    );
    this.registerView(
      LINT_VIEW,
      (leaf: WorkspaceLeaf) =>
        new LintView(leaf, {
          linter: this.linter,
          activeFile: () => this.app.workspace.getActiveFile(),
        }),
    );
    this.registerView(
      WIKI_CHANGES_VIEW,
      (leaf: WorkspaceLeaf) =>
        new WikiChangesView(leaf, {
          git: this.git,
          index: this.index,
          status: () => this.gitBar?.lastStatus ?? null,
          busy: () => this.syncOrchestrator?.busy ?? false,
          refresh: () => void this.runGitFlow("refresh"),
          publish: () => void this.runGitFlow("sync"),
        }),
    );
    this.registerView(
      PAGE_ACTIVITY_VIEW,
      (leaf: WorkspaceLeaf) =>
        new PageActivityView(leaf, {
          index: this.index,
          git: this.git,
          comments: this.comments,
          openSettings: () => this.openPluginSettings(),
        }),
    );
    this.addRibbonIcon("list-tree", S.commands.openWikiTree, () => void this.revealWikiTree());
    this.addRibbonIcon("history", S.commands.openWikiChanges, () => void this.revealChangesView());
    this.addRibbonIcon("message-square", S.commands.openPageActivity, () =>
      void this.revealActivityView(),
    );

    this.addSettingTab(new AdoWikiSettingTab(this.app, this));
    this.registerCommands();

    // Whatever happens, the host is left exactly as we found it.
    this.register(() => this.titleDecorator.disable());
    this.register(() => this.gitBar?.unmount());
    this.register(() => this.toolbar.disable());

    this.applyGitIntegration();
    this.applyToolbar();
    this.registerQuitSync();

    // Indexing waits for the vault to finish loading, otherwise it sees a partial file list.
    this.app.workspace.onLayoutReady(() => void this.initializeIndex());
  }

  override onunload(): void {
    // Commands, views, settings tab and vault events registered via this.register* are
    // released by Obsidian; the title decoration and the git UI are reverted by the
    // callbacks registered above.
  }

  /**
   * Reading mode and live preview (ARCHITECTURE §4.3–4.4). Both are registered unconditionally:
   * every transformation is display-only, and the individual features have their own settings.
   */
  private setupRendering(): void {
    const processor = new AdoReadingProcessor(this.app, this.links, () => this.settings);
    this.registerMarkdownPostProcessor(processor.process);
    this.registerEditorExtension(
      adoLivePreview({
        links: this.links,
        settings: () => this.settings,
        sourcePathOf: (state) => this.sourcePathOf(state),
        // Mermaid in live preview goes through Obsidian's own pipeline, exactly as in reading
        // mode — one renderer for both fence styles and both view modes.
        renderMarkdown: (markdown, el, sourcePath) => {
          const child = new MarkdownRenderChild(el);
          this.addChild(child);
          return MarkdownRenderer.render(this.app, markdown, el, sourcePath, child);
        },
        openHeading: (sourcePath, heading) => {
          void this.app.workspace.openLinkText(`${sourcePath}#${heading}`, sourcePath, false);
        },
      }),
    );
  }

  /** Paste/drop of attachments and wikilink conversion (FR-3.2, FR-3.4). */
  private setupEditing(): void {
    this.paste = new AttachmentPasteHandler(this.app, this.links);
    this.registerEvent(
      this.app.workspace.on("editor-paste", (event: ClipboardEvent, editor: Editor, info) =>
        this.paste.handlePaste(event, editor, info),
      ),
    );
    this.registerEvent(
      this.app.workspace.on("editor-drop", (event: DragEvent, editor: Editor, info) =>
        this.paste.handleDrop(event, editor, info),
      ),
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor: Editor, info: MarkdownFileInfo) =>
        this.wikilinks.handleEditorChange(editor, info),
      ),
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.wikilinks.handleActiveLeafChange()),
    );
  }

  /** The formatting toolbar (FR-5.1–5.4) and its two sync buttons. */
  private setupToolbar(): void {
    this.toolbar = new ToolbarManager({
      plugin: this,
      settings: () => this.settings,
      attachments: this.paste,
      workItemsAvailable: () => this.workItems.configured,
      sync: {
        available: () => this.settings.gitEnabled && this.syncOrchestrator !== null,
        busy: () => this.syncOrchestrator?.busy ?? false,
        busyAction: () => {
          const flow = this.syncOrchestrator?.flow ?? null;
          if (flow === null) return null;
          return flow === "refresh" ? "refresh" : "publish";
        },
        pending: () => {
          const status = this.gitBar?.lastStatus;
          return status ? dirtyCount(status) : 0;
        },
        // Only as fresh as the last refresh, which is what the tooltips say.
        incoming: () => this.gitBar?.lastStatus?.behind ?? 0,
        refresh: () => void this.runGitFlow("refresh"),
        publish: () => void this.runGitFlow("sync"),
      },
    });
  }

  /** Turn the toolbar on or off to match the setting (live, no reload). */
  applyToolbar(): void {
    if (this.settings.showToolbar) this.toolbar.enable();
    else this.toolbar.disable();
  }

  /** Work-item suggester and hover titles (FR-6.2, FR-6.3). */
  private setupWorkItems(): void {
    const suggest = new WorkItemSuggest(this.app, this.workItems);
    this.registerEditorSuggest(suggest);
    new WorkItemHover(this.workItems).register(this);
  }

  /**
   * Which file an editor is showing. Read from the editor's own state rather than by matching the
   * CM6 view against the open leaves: the live-preview extension builds its block decorations
   * from state alone (see livePreviewExtension rule 2), and `editorInfoField` is the answer
   * Obsidian itself keeps there — correct even in a split, a popout, or a leaf that is not active.
   */
  private sourcePathOf(state: EditorState): string {
    const info = state.field(editorInfoField, false);
    return info?.file?.path ?? this.app.workspace.getActiveFile()?.path ?? "";
  }

  /** Re-render open pages so a rendering setting takes effect without a reload. */
  refreshRenderedPages(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView) view.previewMode?.rerender(true);
    }
  }

  private async initializeIndex(): Promise<void> {
    await this.index.rebuild();
    await this.links.reloadAttachments();
    this.registerVaultEvents();
    this.applyTitleDecoration();
    if (this.settings.repairOrderOnStartup) {
      await this.orderManager.repairAll();
    }
    await this.adoptWikiBranch();
    this.gitBar?.scheduleStartupRefresh();
  }

  /**
   * Adopt the branch this clone is actually on, so nobody has to look up something Azure DevOps
   * does not show them. The decision — and why an untracked or detached checkout is left alone —
   * is in `branchToAdopt`.
   *
   * This reads the full status rather than just `currentBranch()` because the upstream is the
   * signal that the branch came from the server. The status bar runs the same query moments
   * later, so no new kind of git call is introduced.
   */
  private async adoptWikiBranch(): Promise<void> {
    if (!this.git) return;

    const status = await this.git.status().catch(() => null);
    if (status === null) return;

    const branch = branchToAdopt(status, this.settings.wikiBranch, DEFAULT_WIKI_BRANCH);
    if (branch === null) return;

    this.settings.wikiBranch = branch;
    await this.saveSettings();
  }

  /**
   * Registered only after the initial index build, so that Obsidian's start-up file events
   * cannot race it. The index must update before OrderManager reconciles, because
   * reconciliation compares .order against what the index reports on disk.
   */
  private registerVaultEvents(): void {
    this.registerEvent(
      this.app.vault.on("create", (file: TAbstractFile) => {
        void this.index.handleCreate(file).then(() => {
          this.orderManager.handleCreate(file);
          // After the index update, so the guard's Rename offer can find the new page.
          this.nameGuard.check(file);
          // Folders are the guards' one overlap: an Azure DevOps wiki has none, so a folder
          // created here becomes a page before anything is put inside it (folderPlan.ts).
          this.folderGuard.check(file);
        });
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file: TAbstractFile) => {
        this.index.handleDelete(file);
        void this.orderManager.handleDelete(file);
        this.nameGuard.forget(file.path);
        this.folderGuard.forget(file.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        void this.index.handleRename(file, oldPath).then(() => {
          this.orderManager.handleRename(file, oldPath);
          this.nameGuard.forget(oldPath);
          this.nameGuard.check(file);
          // Obsidian's *New folder* creates "Untitled" and opens the row for renaming, so the
          // name the user actually means arrives here, not on the create event.
          this.folderGuard.forget(oldPath);
          this.folderGuard.check(file);
        });
      }),
    );

    // Every edit changes what the status bar should say about unsaved work (it debounces).
    this.registerEvent(this.app.vault.on("modify", () => this.gitBar?.notifyVaultChanged()));
    this.register(this.index.onChange(() => this.gitBar?.notifyVaultChanged()));

    // Explorer rows are rebuilt by Obsidian on every vault change; relabel what it redrew.
    this.register(this.index.onChange(() => this.titleDecorator.refresh()));

    this.registerSidebarMounting();
  }

  /**
   * Draw our sidebar panes when they become visible, because Obsidian may not ask them to.
   *
   * A leaf restored from the saved workspace holds a deferred placeholder; revealing it swaps the
   * real view in and calls **nothing** on it — no `onOpen`, no `onResize`. The pane then stays
   * blank for ever, which is exactly the "the tree view is not working" report. The view's own
   * `ensureMounted()` cannot help, because nothing invokes it on that path.
   *
   * So the mount is pushed from here instead of waited for. `active-leaf-change` fires when the
   * user clicks a sidebar tab, and `layout-ready`/`resize` cover a pane that is already open on
   * start-up. Every pane's `ensureVisible()` is idempotent, so being called more than once costs a
   * redraw of a list that is at most a few hundred rows.
   */
  private registerSidebarMounting(): void {
    const mountVisiblePanes = (): void => {
      for (const type of [WIKI_TREE_VIEW, LINT_VIEW, WIKI_CHANGES_VIEW, PAGE_ACTIVITY_VIEW]) {
        for (const leaf of this.app.workspace.getLeavesOfType(type)) {
          // A leaf that is still deferred has no real view yet; loading it is what un-defers it,
          // and the reveal that follows brings us back here.
          const deferred = leaf as WorkspaceLeaf & { isDeferred?: boolean };
          if (deferred.isDeferred || !isPaneAttached(leaf)) continue;
          const view = leaf.view as { ensureVisible?: () => void };
          view.ensureVisible?.();
        }
      }
    };

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => mountVisiblePanes()));
    this.registerEvent(this.app.workspace.on("resize", () => mountVisiblePanes()));
    this.app.workspace.onLayoutReady(() => mountVisiblePanes());
  }

  // ---------------------------------------------------------------------- git

  /**
   * Builds the git stack when the vault is a real folder on disk. Whether it is actually a
   * wiki clone is not decided here — the flows re-check that every time they run, because the
   * answer can change while Obsidian is open.
   */
  private setupGit(): void {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return;

    this.git = new GitService(adapter.getBasePath(), {
      onCommand: (result) => {
        if (!result.ok) console.debug(`[azure-devops-wiki] ${result.command}`, result.stderr);
      },
    });
    this.syncOrchestrator = new SyncOrchestrator({
      git: this.git,
      ui: new ObsidianSyncUi(this.app),
      settings: () => ({
        wikiBranch: this.settings.wikiBranch,
        commitMessageTemplate: this.settings.commitMessageTemplate,
      }),
      // .order writes are queued; a sync must not commit half of a rename.
      beforeStage: () => this.orderManager.idle(),
      preSyncCheck: () => this.preSyncLint(),
      onStateChange: (state) => {
        // A checkout lands a folder and its paired page as two events; the FolderGuard must not
        // "repair" the gap by inventing a page the server is about to deliver.
        this.syncFlowActive = state !== "idle";
        if (state === "idle") this.folderGuard.resume();
        this.gitBar?.onFlowState(state);
      },
    });
    this.gitBar = new GitStatusBar({
      plugin: this,
      git: this.git,
      orchestrator: this.syncOrchestrator,
      autoRefresh: () => ({
        onOpen: this.settings.autoRefreshOnOpen,
        intervalMinutes: this.settings.autoRefreshIntervalMin,
      }),
      openSettings: () => this.openPluginSettings(),
      onStatusChange: () => this.onGitStatusRead(),
    });
  }

  /**
   * One place where "git said something changed" fans out to everything that shows it: the
   * toolbar buttons, the explorer and tree marks, and the changes pane. Without a single funnel
   * these three would drift apart and each would need its own poller.
   */
  private onGitStatusRead(): void {
    const files = this.gitBar?.lastStatus?.files ?? [];
    this.changedPaths = new Map<string, ChangeKind>(
      files
        // The sync never publishes .obsidian/, so marking it as an unpublished page would be a
        // change the user cannot act on.
        .filter(
          (file) => !(file.kind === "untracked" && file.path.startsWith(OBSIDIAN_CONFIG_DIR)),
        )
        .map((file) => [file.path, file.kind]),
    );

    // All four are created after setupGit(), hence the optional chaining rather than a flag.
    this.toolbar?.refreshSyncState();
    this.titleDecorator?.refresh();
    for (const leaf of this.app.workspace.getLeavesOfType(WIKI_TREE_VIEW)) {
      if (leaf.view instanceof WikiTreeView) leaf.view.onStatusChange();
    }
    this.changesView()?.onStatusChange();
    for (const leaf of this.app.workspace.getLeavesOfType(PAGE_ACTIVITY_VIEW)) {
      if (leaf.view instanceof PageActivityView) leaf.view.onStatusChange();
    }
  }

  /**
   * FR-8.3: check the pages about to be published, and let the user decide (or stop them).
   *
   * Only *locally changed* pages are checked. A wiki inherits years of content nobody in this
   * session touched, and blocking a two-word fix on somebody else's 2019 callout would train
   * everyone to switch the setting off.
   */
  private async preSyncLint(): Promise<"ok" | "blocked"> {
    if (!this.git) return "ok";

    const status = await this.git.status().catch(() => null);
    const pages = (status?.files ?? []).filter((file) => file.path.toLowerCase().endsWith(".md"));
    const changed = pages.map((file) => file.path);
    if (changed.length === 0) return "ok";

    // A *new* page whose file name Azure DevOps cannot decode stops the publish whatever the
    // lint setting says: once pushed, the portal refuses to open it ("the page's title … does not
    // conform to Wiki standards") for the whole team, and it cannot be fixed from the portal.
    // Only new pages — an existing broken name is not made worse by publishing an edit to it,
    // and blocking that would trap someone who is fixing the page's content.
    const newBadNames = pages
      .filter((file) => file.kind === "added" || file.kind === "untracked")
      .map((file) => file.path)
      .filter((path) => nonPortableSegments(path).length > 0);
    if (newBadNames.length > 0) {
      new Notice(S.notices.badPageNamesBlockSync(newBadNames.length), 15_000);
      await this.runLint("vault");
      return "blocked";
    }

    const mode = this.settings.preSyncLint;
    if (mode === "off") return "ok";

    const report = await this.linter.lintVault(changed);
    const errors = report.findings.filter((finding) => finding.severity === "error");
    if (errors.length === 0) return "ok";

    const view = await this.revealLintView();
    view?.show(report.findings, report.pagesScanned);

    const counts = countBySeverity(errors);
    new Notice(S.lint.preSyncBody(counts.error), 8000);
    return mode === "block" ? "blocked" : "ok";
  }

  /** Turn the whole git surface on or off to match the setting (live, no reload). */
  applyGitIntegration(): void {
    if (!this.gitBar) return;
    if (this.settings.gitEnabled) {
      this.gitBar.mount();
      this.gitBar.applyAutoRefresh();
    } else {
      this.gitBar.unmount();
    }
  }

  /**
   * FR-7.5: publish pending edits on quit, opt-in. Unattended, so a conflict never parks the
   * repository mid-rebase behind a dialog nobody can answer — it aborts and leaves the work
   * committed locally for the next Refresh.
   */
  private registerQuitSync(): void {
    this.registerEvent(
      this.app.workspace.on("quit", (tasks) => {
        if (!this.settings.gitEnabled || !this.settings.autoSyncOnClose) return;
        const orchestrator = this.syncOrchestrator;
        if (!orchestrator) return;
        tasks.addPromise(orchestrator.sync({ unattended: true }));
      }),
    );
  }

  private async runGitFlow(flow: "refresh" | "sync"): Promise<void> {
    if (!this.syncOrchestrator) {
      new Notice(S.git.errors.notARepo);
      return;
    }
    if (!this.settings.gitEnabled) {
      new Notice(S.git.errors.disabled);
      return;
    }
    await (flow === "refresh" ? this.syncOrchestrator.refresh() : this.syncOrchestrator.sync());
    await this.gitBar?.refreshStatus();
    // A pull can bring in new attachments, and they are dotfiles: no vault event announces them.
    await this.links.reloadAttachments();
  }

  /** The settings window is not part of the public API, but this is its stable shape. */
  private openPluginSettings(): void {
    const setting = (
      this.app as unknown as {
        setting?: { open(): void; openTabById(id: string): void };
      }
    ).setting;
    setting?.open();
    setting?.openTabById(this.manifest.id);
  }

  /** Turn the explorer decorations on or off to match the settings (live, no reload). */
  applyTitleDecoration(): void {
    this.titleDecorator.apply();
  }

  private registerCommands(): void {
    this.addCommand({
      id: "new-page",
      name: S.commands.newPage,
      callback: () => this.pageCommands.promptNewPage(),
    });
    this.addCommand({
      id: "new-subpage",
      name: S.commands.newSubpage,
      callback: () => this.pageCommands.promptNewSubpage(),
    });
    this.addCommand({
      id: "rename-page",
      name: S.commands.renamePage,
      callback: () => this.pageCommands.promptRename(),
    });
    this.addCommand({
      id: "delete-page",
      name: S.commands.deletePage,
      callback: () => this.pageCommands.promptDelete(),
    });
    this.addCommand({
      id: "move-page-up",
      name: S.commands.movePageUp,
      checkCallback: (checking) => this.movePage(-1, checking),
    });
    this.addCommand({
      id: "move-page-down",
      name: S.commands.movePageDown,
      checkCallback: (checking) => this.movePage(1, checking),
    });
    this.addCommand({
      id: "repair-order-files",
      name: S.commands.repairOrder,
      callback: () => void this.pageCommands.repairOrderFiles(),
    });
    this.addCommand({
      id: "open-wiki-page",
      name: S.commands.openWikiPage,
      callback: () => this.openPageSwitcher(),
    });
    this.addCommand({
      id: "open-wiki-tree",
      name: S.commands.openWikiTree,
      callback: () => void this.revealWikiTree(),
    });
    this.addCommand({
      id: "open-wiki-changes",
      name: S.commands.openWikiChanges,
      callback: () => void this.revealChangesView(),
    });
    this.addCommand({
      id: "open-page-activity",
      name: S.commands.openPageActivity,
      callback: () => void this.revealActivityView(),
    });
    this.addCommand({
      id: "refresh",
      name: S.commands.refresh,
      callback: () => void this.runGitFlow("refresh"),
    });
    this.addCommand({
      id: "sync",
      name: S.commands.sync,
      callback: () => void this.runGitFlow("sync"),
    });
    this.addCommand({
      id: "convert-page-links",
      name: S.commands.convertPageLinks,
      callback: () => void this.wikilinks.convertActivePage(),
    });
    this.addCommand({
      id: "convert-vault-links",
      name: S.commands.convertVaultLinks,
      callback: () => void this.wikilinks.convertVault(),
    });

    this.addCommand({
      id: "lint-file",
      name: S.commands.lintFile,
      callback: () => void this.runLint("file"),
    });
    this.addCommand({
      id: "lint-vault",
      name: S.commands.lintVault,
      callback: () => void this.runLint("vault"),
    });
    this.addCommand({
      id: "open-lint-results",
      name: S.commands.openLintResults,
      callback: () => void this.revealLintView(),
    });
    this.addCommand({
      id: "setup-check",
      name: S.commands.setupCheck,
      callback: () => void new SetupCheck(this.app, this.git).run(),
    });

    this.registerFormatCommands();
    this.registerAdoLinkCommands();
  }

  /** Move the page that is open one place up or down in its parent's sequence (FR-2.1). */
  private movePage(delta: -1 | 1, checking: boolean): boolean {
    const entry = this.activePageEntry();
    if (!entry) return false;
    if (!checking) void this.pageCommands.movePage(entry, delta);
    return true;
  }

  private async runLint(scope: LintScope): Promise<void> {
    const view = await this.revealLintView();
    await view?.scan(scope);
  }

  /** Open the compatibility pane in the right sidebar (reusing it if it is already there). */
  private async revealLintView(): Promise<LintView | null> {
    const leaf = await this.revealPane(LINT_VIEW);
    return leaf?.view instanceof LintView ? leaf.view : null;
  }

  /** Every toolbar action as a command too (FR-5.4), with hotkeys matching ADO where sensible. */
  private registerFormatCommands(): void {
    const formatCommand = (
      id: string,
      name: string,
      run: (editor: Editor) => void,
      hotkeys?: Hotkey[],
    ): void => {
      this.addCommand({ id, name, hotkeys, editorCallback: (editor: Editor) => run(editor) });
    };

    formatCommand("format-bold", S.toolbar.bold, actions.toggleBold, [
      { modifiers: ["Mod"], key: "b" },
    ]);
    formatCommand("format-italic", S.toolbar.italic, actions.toggleItalic, [
      { modifiers: ["Mod"], key: "i" },
    ]);
    formatCommand("format-strikethrough", S.toolbar.strikethrough, actions.toggleStrikethrough);
    formatCommand("format-inline-code", S.toolbar.inlineCode, actions.toggleInlineCode);
    formatCommand("format-code-block", S.toolbar.codeBlock, actions.insertCodeBlock);
    formatCommand("format-quote", S.toolbar.quote, actions.applyQuote);
    formatCommand("format-bullet-list", S.toolbar.bulletList, actions.applyBulletList);
    formatCommand("format-numbered-list", S.toolbar.numberedList, actions.applyNumberedList);
    formatCommand("format-task-list", S.toolbar.taskList, actions.applyTaskList);
    formatCommand("format-horizontal-rule", S.toolbar.horizontalRule, actions.insertHorizontalRule);
    formatCommand("format-link", S.toolbar.link, actions.insertLink, [
      { modifiers: ["Mod"], key: "k" },
    ]);
    formatCommand("format-table", S.toolbar.table, (editor) => actions.insertTable(editor));
    formatCommand("format-toc", S.toolbar.toc, actions.insertToc);
    formatCommand("format-mermaid", S.toolbar.mermaid, actions.insertMermaidBlock);
    formatCommand("format-math", S.toolbar.math, actions.insertMathBlock);

    for (let level = 1; level <= 6; level++) {
      formatCommand(`format-heading-${level}`, `Heading ${level}`, (editor) =>
        actions.applyHeading(editor, level),
      );
    }
    formatCommand("format-heading-clear", "Normal text (clear heading)", (editor) =>
      actions.applyHeading(editor, 0),
    );
  }

  /** "Open in Azure DevOps" and the two copy-link commands (FR-9.1, FR-9.2). */
  private registerAdoLinkCommands(): void {
    this.addCommand({
      id: "open-in-ado",
      name: S.commands.openInAdo,
      checkCallback: (checking) => {
        const url = this.adoWebUrlForActiveFile();
        if (!checking && url) window.open(url, "_blank");
        return url !== null;
      },
    });
    this.addCommand({
      id: "copy-ado-link",
      name: S.commands.copyAdoLink,
      checkCallback: (checking) => {
        const url = this.adoWebUrlForActiveFile();
        if (!checking && url) void navigator.clipboard.writeText(url).then(() => {
          new Notice(S.notices.copiedAdoLink);
        });
        return url !== null;
      },
    });
    this.addCommand({
      id: "copy-wiki-relative-path",
      name: S.commands.copyWikiPath,
      checkCallback: (checking) => {
        const entry = this.activePageEntry();
        if (!entry) return false;
        if (!checking) {
          void navigator.clipboard
            .writeText(wikiRelativePath(entry.titlePath))
            .then(() => new Notice(S.notices.copiedWikiPath));
        }
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) =>
        this.addPageMenuItems(menu, file),
      ),
    );
  }

  /**
   * The wiki items on the file explorer's own right-click menu.
   *
   * A folder is accepted, not just a file, because in the explorer the row for a page *with
   * subpages* is the folder row — with `singleRowPerPage` on it is the only row that page has, so
   * a menu that only handled files would leave exactly those pages without one.
   */
  private addPageMenuItems(menu: Menu, file: TAbstractFile): void {
    const entry =
      file instanceof TFile
        ? this.index.forFile(file)
        : this.index.forPath(`${file.path}.md`); // the page whose subpages live in this folder
    if (!entry) return;

    // First, and in its own section: this is the answer to "how do I make a page under this
    // one?" — the question that otherwise gets answered with Obsidian's *New folder*, which an
    // Azure DevOps wiki cannot represent at all (folderPlan.ts).
    menu.addItem((item) =>
      item
        .setSection("adowiki-create")
        .setTitle(S.menu.newSubpage)
        .setIcon("file-plus")
        .onClick(() => this.pageCommands.promptNewSubpageFor(entry)),
    );

    const { index: position, total } = this.pageCommands.positionOf(entry);
    menu.addItem((item) =>
      item
        .setSection("adowiki-order")
        .setTitle(S.menu.moveUp)
        .setIcon("arrow-up")
        .setDisabled(position <= 0)
        .onClick(() => void this.pageCommands.movePage(entry, -1)),
    );
    menu.addItem((item) =>
      item
        .setSection("adowiki-order")
        .setTitle(S.menu.moveDown)
        .setIcon("arrow-down")
        .setDisabled(position === -1 || position >= total - 1)
        .onClick(() => void this.pageCommands.movePage(entry, 1)),
    );
    if (entry.folderPath === "") {
      menu.addItem((item) =>
        item
          .setSection("adowiki-order")
          .setTitle(S.menu.setHomePage)
          .setIcon("home")
          .setDisabled(position === 0)
          .onClick(() => void this.pageCommands.setHomePage(entry)),
      );
    }
    menu.addItem((item) =>
      item
        .setSection("adowiki-order")
        .setTitle(S.menu.showInWikiTree)
        .setIcon("list-tree")
        .onClick(() => void this.revealWikiTree()),
    );

    const url = wikiWebUrl(
      {
        organizationUrl: this.settings.organizationUrl,
        project: this.settings.project,
        wikiName: this.settings.wikiName,
      },
      entry.titlePath,
    );
    if (!url) return;
    menu.addItem((item) =>
      item
        .setTitle(S.commands.openInAdo)
        .setIcon("external-link")
        .onClick(() => window.open(url, "_blank")),
    );
  }

  private activePageEntry() {
    const file = this.app.workspace.getActiveFile();
    return file ? this.index.forFile(file) : null;
  }

  private adoWebUrlForActiveFile(): string | null {
    const entry = this.activePageEntry();
    if (!entry) return null;
    return wikiWebUrl(
      {
        organizationUrl: this.settings.organizationUrl,
        project: this.settings.project,
        wikiName: this.settings.wikiName,
      },
      entry.titlePath,
    );
  }

  private openPageSwitcher(): void {
    if (this.index.size === 0) {
      new Notice(S.notices.noWikiPages);
      return;
    }
    new WikiPageSwitcher(this.app, this.index).open();
  }

  /** Open the wiki tree in the right sidebar (reusing it if it is already there) and focus it. */
  private async revealWikiTree(): Promise<void> {
    const leaf = await this.revealPane(WIKI_TREE_VIEW);
    if (leaf?.view instanceof WikiTreeView) leaf.view.revealActiveFile();
  }

  /**
   * Reveal one of our sidebar panes, rebuilding its leaf if the host left it half-open.
   *
   * The report this exists for: the **Wiki pages** tab was present in the sidebar and selected,
   * and the pane below it was blank. Measured over CDP — the leaf's `containerEl` and its tab
   * header were both in the document, `leaf.view` was a real `WikiTreeView`, `isDeferred` was
   * false, and **`view.containerEl.isConnected` was false**: Obsidian had created the view object
   * and never attached its element or called `onOpen()`. Neither `loadIfDeferred()` nor
   * `setViewState()` on that leaf repaired it.
   *
   * So a leaf in that state is discarded and a fresh one opened, which is the path that does work.
   * The check is on the *view's* element, not the leaf's: a leaf whose tab is simply not the
   * active one is perfectly healthy and must be left alone.
   */
  private async revealPane(type: string): Promise<WorkspaceLeaf | null> {
    const healthy = this.app.workspace
      .getLeavesOfType(type)
      .filter((leaf) => isPaneAttached(leaf));

    let leaf: WorkspaceLeaf | null = healthy[0] ?? null;
    if (!leaf) {
      // Nothing usable — drop any half-open leaves so they cannot be picked up again.
      for (const broken of this.app.workspace.getLeavesOfType(type)) broken.detach();
      const fresh = this.app.workspace.getRightLeaf(false);
      if (!fresh) return null;
      await fresh.setViewState({ type, active: true });
      leaf = fresh;
    }

    await this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  /** The changes pane, when it is open — the status bar pushes fresh git state into it. */
  private changesView(): WikiChangesView | null {
    for (const leaf of this.app.workspace.getLeavesOfType(WIKI_CHANGES_VIEW)) {
      if (leaf.view instanceof WikiChangesView) return leaf.view;
    }
    return null;
  }

  /** Open the changes pane in the right sidebar (reusing it if it is already there). */
  private async revealChangesView(): Promise<void> {
    await this.revealPane(WIKI_CHANGES_VIEW);
  }

  /** Open the page activity pane in the right sidebar (reusing it if it is already there). */
  private async revealActivityView(): Promise<void> {
    await this.revealPane(PAGE_ACTIVITY_VIEW);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

/**
 * Whether the host has really opened this leaf's view, i.e. put the view's own element into the
 * document.
 *
 * A leaf can be in the workspace, carry a tab header, report `isDeferred === false` and hold a real
 * view object whose element was never attached — which renders as a tab you can select above a
 * blank pane (round-8 report 3, measured over CDP). A leaf whose tab is merely *inactive* reports
 * true here, which is correct: it is healthy and must not be rebuilt.
 */
function isPaneAttached(leaf: WorkspaceLeaf): boolean {
  const el = (leaf.view as { containerEl?: HTMLElement } | undefined)?.containerEl;
  return el?.isConnected === true;
}
