import { debounce, Menu, Plugin, setIcon } from "obsidian";
import { S } from "../strings";
import type { GitService } from "./gitService";
import { describeStatus, GitStatus, withoutUnchangedFiles } from "./gitStatus";
import type { SyncOrchestrator, SyncState } from "./syncOrchestrator";

/**
 * The always-visible half of the git integration (FR-7.1, FR-7.2, FR-7.5):
 * status bar item, its menu, and the timers behind automatic refreshing.
 *
 * Everything it owns is created in {@link mount} and released in {@link unmount}, so the
 * `gitEnabled` setting can turn the whole surface on and off without a reload.
 */

export interface AutoRefreshSettings {
  onOpen: boolean;
  intervalMinutes: number;
}

export interface GitStatusBarDeps {
  plugin: Plugin;
  git: GitService;
  orchestrator: SyncOrchestrator;
  autoRefresh: () => AutoRefreshSettings;
  openSettings: () => void;
  /**
   * Called whenever the git state has been re-read, so the other places that show it (the
   * toolbar's Get updates / Publish buttons, the changes sidebar) update from one source.
   */
  onStatusChange?: () => void;
}

/** How often the status bar re-reads local state (branch, dirty count). No network. */
const STATUS_POLL_MS = 60_000;
/** Let the vault settle before the first automatic refresh; start-up is busy enough. */
const STARTUP_REFRESH_DELAY_MS = 4_000;

export class GitStatusBar {
  private statusEl: HTMLElement | null = null;
  private pollTimer: number | null = null;
  private autoRefreshTimer: number | null = null;

  private status: GitStatus | null = null;
  private mounted = false;

  /** File events arrive in bursts (a git pull, a repair sweep); one status read will do. */
  private readonly scheduleRefresh = debounce(() => void this.refreshStatus(), 1500);

  constructor(private readonly deps: GitStatusBarDeps) {}

  /**
   * The last git state read, for the other views that show it. Null when the vault is not a
   * repository, or before the first read — both mean "do not claim anything".
   */
  get lastStatus(): GitStatus | null {
    return this.status;
  }

  mount(): void {
    if (this.mounted) return;
    this.mounted = true;

    const { plugin } = this.deps;
    this.statusEl = plugin.addStatusBarItem();
    this.statusEl.addClass("adowiki-status", "mod-clickable");
    this.statusEl.addEventListener("click", (event) => this.showMenu(event));

    // No ribbon icons for Refresh and Publish. The toolbar above every page carries both, with
    // counts and plain-language tooltips (Phase 7), the changes pane carries both, and the status
    // bar's own menu carries both — a fourth copy in the ribbon was three too many, and it is the
    // copy furthest from the page the user is editing (round-7 report 3).
    this.render();
    void this.refreshStatus();

    this.pollTimer = window.setInterval(() => void this.refreshStatus(), STATUS_POLL_MS);
    this.applyAutoRefresh();
  }

  unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;

    if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
    if (this.autoRefreshTimer !== null) window.clearInterval(this.autoRefreshTimer);
    this.pollTimer = null;
    this.autoRefreshTimer = null;
    this.statusEl?.remove();
    this.statusEl = null;
  }

  /** Re-arm the interval timer after the auto-refresh settings change. */
  applyAutoRefresh(): void {
    if (!this.mounted) return;
    if (this.autoRefreshTimer !== null) window.clearInterval(this.autoRefreshTimer);
    this.autoRefreshTimer = null;

    const { intervalMinutes } = this.deps.autoRefresh();
    if (intervalMinutes <= 0) return;
    this.autoRefreshTimer = window.setInterval(
      () => void this.refresh({ unattended: true }),
      intervalMinutes * 60_000,
    );
  }

  /** Called once the workspace is ready (FR-7.5). */
  scheduleStartupRefresh(): void {
    if (!this.mounted || !this.deps.autoRefresh().onOpen) return;
    const timer = window.setTimeout(() => void this.refresh({ unattended: true }), STARTUP_REFRESH_DELAY_MS);
    this.deps.plugin.register(() => window.clearTimeout(timer));
  }

  /** The plugin forwards vault changes here; cheap and debounced. */
  notifyVaultChanged(): void {
    if (this.mounted) this.scheduleRefresh();
  }

  /** The plugin forwards orchestrator state changes here. */
  onFlowState(_state: SyncState): void {
    this.render();
  }

  async refresh(options: { unattended?: boolean } = {}): Promise<void> {
    await this.deps.orchestrator.refresh(options);
    await this.refreshStatus();
  }

  async sync(options: { unattended?: boolean } = {}): Promise<void> {
    await this.deps.orchestrator.sync(options);
    await this.refreshStatus();
  }

  /**
   * Re-read the git state that every other surface shows (marks, counts, changes pane).
   *
   * The status is filtered through `withoutUnchangedFiles` here, once, rather than in each
   * consumer: a page whose text matches Azure DevOps must not be counted as unpublished anywhere,
   * and this is the single place the raw status enters the plugin's UI.
   */
  async refreshStatus(): Promise<void> {
    if (!this.mounted) return;
    try {
      const status = await this.deps.git.status();
      const contentChanged = status.files.some((file) => file.kind === "modified")
        ? await this.deps.git.contentChangedPaths()
        : null;
      this.status = withoutUnchangedFiles(status, contentChanged);
    } catch {
      // Not a repo (yet), or git is unavailable — the status bar says so, nothing else breaks.
      this.status = null;
    }
    this.render();
  }

  private render(): void {
    // Announced even when the status bar itself is not mounted: the toolbar buttons and the
    // changes view are driven from here and must not go stale because a bar was hidden.
    this.deps.onStatusChange?.();

    const statusEl = this.statusEl;
    if (!statusEl) return;

    const { text, tooltip } = describeStatus(this.status, {
      lastRefresh: this.deps.orchestrator.lastRefresh,
      now: Date.now(),
      busy: busyLabel(this.deps.orchestrator.state),
    });

    statusEl.empty();
    const iconEl = statusEl.createSpan({ cls: "adowiki-status__icon" });
    setIcon(iconEl, this.deps.orchestrator.busy ? "refresh-cw" : "git-branch");
    statusEl.createSpan({ cls: "adowiki-status__text", text });
    statusEl.setAttribute("aria-label", tooltip);
    statusEl.toggleClass("adowiki-status--busy", this.deps.orchestrator.busy);
  }

  private showMenu(event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(S.git.menu.refresh)
        .setIcon("refresh-cw")
        .setDisabled(this.deps.orchestrator.busy)
        .onClick(() => void this.refresh()),
    );
    menu.addItem((item) =>
      item
        .setTitle(S.git.menu.sync)
        .setIcon("upload-cloud")
        .setDisabled(this.deps.orchestrator.busy)
        .onClick(() => void this.sync()),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(S.git.menu.settings)
        .setIcon("settings")
        .onClick(() => this.deps.openSettings()),
    );
    menu.showAtMouseEvent(event);
  }
}

function busyLabel(state: SyncState): string | null {
  switch (state) {
    case "refreshing":
      return S.git.busy.refreshing;
    case "syncing":
      return S.git.busy.syncing;
    case "conflict":
      return S.git.busy.conflict;
    default:
      return null;
  }
}
