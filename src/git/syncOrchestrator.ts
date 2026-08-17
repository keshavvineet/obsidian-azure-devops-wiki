import { decodeFileName } from "../naming/pageNameCodec";
import { S } from "../strings";
import { countPages, formatCommitMessage } from "./commitMessage";
import {
  ConflictChoice,
  firstLine,
  GitResult,
  GitService,
  GitTimeoutError,
  GitUnavailableError,
} from "./gitService";
import { conflictedPaths, GitStatus } from "./gitStatus";

/**
 * Refresh and Sync for people who have never used git (FR-7.1, FR-7.4, FR-7.7).
 *
 * The state machine is ARCHITECTURE §4.5. Two rules shape everything here:
 *  - the repository is never left mid-rebase without the user being told and offered a way
 *    out — every conflict path ends in resolve-and-continue or a clean abort;
 *  - guard rails are re-checked at the start of every flow, because the user may have done
 *    anything in a terminal since the last one.
 *
 * No Obsidian imports: all user interaction goes through the injected {@link SyncUi}, which is
 * what lets the flows be tested end-to-end against real repositories.
 */

export type SyncState = "idle" | "refreshing" | "syncing" | "conflict";

/**
 * Which of the two user actions is in flight. Distinct from {@link SyncState} because a publish
 * fetches and rebases on the way, and a conflict dialog replaces the state entirely — the *button*
 * the user pressed must keep its spinner throughout, and the other one must never start one.
 */
export type SyncFlow = "refresh" | "sync";

export type SyncOutcome =
  | "ok"
  | "up-to-date"
  | "nothing-to-do"
  | "conflict-aborted"
  | "blocked"
  | "busy"
  | "offline"
  | "error";

export interface SyncResult {
  outcome: SyncOutcome;
  /** Pages added, changed or removed by this flow. */
  pages: number;
  message: string;
}

export interface ConflictFile {
  /** Repo-relative path, e.g. 'Product-Documentation/Setup.md'. */
  path: string;
  /** Decoded page title, e.g. 'Setup' — what the user recognises. */
  title: string;
}

export type ConflictAnswer =
  | { action: "resolve"; choices: ReadonlyMap<string, ConflictChoice> }
  | { action: "abort" };

/** Everything the flows need from the outside world that is not git. */
export interface SyncUi {
  info(message: string): void;
  success(message: string): void;
  error(message: string, detail?: string): void;
  /** Resolves when the user has chosen; the flow is suspended until then. */
  askConflicts(files: ConflictFile[]): Promise<ConflictAnswer>;
}

export interface SyncSettings {
  wikiBranch: string;
  commitMessageTemplate: string;
}

export interface SyncDeps {
  git: GitService;
  ui: SyncUi;
  settings: () => SyncSettings;
  /** Flush queued file mutations (.order writes) so a sync never commits a half-written vault. */
  beforeStage?: () => Promise<void>;
  /** Phase 6 hooks the compatibility linter in here; 'blocked' cancels the sync. */
  preSyncCheck?: () => Promise<"ok" | "blocked">;
  onStateChange?: (state: SyncState) => void;
  now?: () => Date;
}

export interface FlowOptions {
  /**
   * Background run (auto-refresh, quit sync): success and no-op messages stay silent and
   * conflicts are never left waiting on a dialog nobody is looking at.
   */
  unattended?: boolean;
}

/** A rebase can stop once per replayed commit; the bound only guards against a runaway loop. */
const MAX_CONFLICT_ROUNDS = 25;

export class SyncOrchestrator {
  private currentState: SyncState = "idle";
  private currentFlow: SyncFlow | null = null;
  private lastRefreshAt: number | null = null;

  constructor(private readonly deps: SyncDeps) {}

  get state(): SyncState {
    return this.currentState;
  }

  /** The action the user started, or null when idle — see {@link SyncFlow}. */
  get flow(): SyncFlow | null {
    return this.currentFlow;
  }

  get lastRefresh(): number | null {
    return this.lastRefreshAt;
  }

  get busy(): boolean {
    return this.currentState !== "idle";
  }

  // -------------------------------------------------------------------- flows

  /** FR-7.1: bring the vault up to date with Azure DevOps. */
  async refresh(options: FlowOptions = {}): Promise<SyncResult> {
    if (this.busy) return this.report(options, "busy", 0, S.git.errors.busy, { subtle: true });
    this.currentFlow = "refresh";
    this.setState("refreshing");
    try {
      return await this.runRefresh(options);
    } catch (error) {
      return this.reportFailure(options, error);
    } finally {
      this.currentFlow = null;
      this.setState("idle");
    }
  }

  /** FR-7.1: publish local edits — stage, commit, rebase on top of the server, push. */
  async sync(options: FlowOptions = {}): Promise<SyncResult> {
    if (this.busy) return this.report(options, "busy", 0, S.git.errors.busy, { subtle: true });
    this.currentFlow = "sync";
    this.setState("syncing");
    try {
      return await this.runSync(options);
    } catch (error) {
      return this.reportFailure(options, error);
    } finally {
      this.currentFlow = null;
      this.setState("idle");
    }
  }

  private async runRefresh(options: FlowOptions): Promise<SyncResult> {
    const status = await this.checkGuardRails(options);
    if (!status) return this.result("blocked", 0, S.git.errors.blocked);

    const fetched = await this.deps.git.fetch();
    if (!fetched.ok) return this.offline(options, fetched);
    this.lastRefreshAt = Date.now();

    const fetchedStatus = await this.deps.git.status();
    if (fetchedStatus.behind === 0) {
      return this.report(options, "up-to-date", 0, S.git.notices.upToDate, { subtle: true });
    }

    const before = await this.deps.git.headSha();
    const pull = await this.deps.git.pullRebaseAutostash();
    if (!pull.ok) {
      const resolved = await this.settleConflicts(options);
      if (resolved === "aborted") {
        return this.report(options, "conflict-aborted", 0, S.git.notices.conflictAborted, {
          subtle: true,
        });
      }
      if (resolved === "none" || resolved === "unresolved") {
        return this.failure(options, S.git.errors.refreshFailed, detailOf(pull));
      }
    }

    const pages = await this.pagesChangedSince(before);
    return this.report(options, "ok", pages, S.git.notices.refreshed(pages), { subtle: pages === 0 });
  }

  private async runSync(options: FlowOptions): Promise<SyncResult> {
    const status = await this.checkGuardRails(options);
    if (!status) return this.result("blocked", 0, S.git.errors.blocked);

    if (this.deps.preSyncCheck && (await this.deps.preSyncCheck()) === "blocked") {
      return this.result("blocked", 0, S.git.errors.blockedByLint);
    }

    // Queued .order writes must land before staging, or we commit half a rename.
    await this.deps.beforeStage?.();

    const staged = await this.stageEverything();
    if (staged === null) return this.failure(options, S.git.errors.stageFailed);

    if (staged.length > 0) {
      const committed = await this.commit(staged);
      if (!committed.ok) return this.failure(options, S.git.errors.commitFailed, detailOf(committed));
    } else if (status.ahead === 0) {
      return this.report(options, "nothing-to-do", 0, S.git.notices.nothingToSync, { subtle: true });
    }

    const pages = countPages(staged);

    const fetched = await this.deps.git.fetch();
    if (!fetched.ok) {
      // The work is committed locally, so nothing is lost — say exactly that.
      return this.report(options, "offline", pages, S.git.notices.committedOffline(pages), {
        subtle: true,
      });
    }
    this.lastRefreshAt = Date.now();

    if ((await this.deps.git.status()).behind > 0) {
      const pull = await this.deps.git.pullRebaseAutostash();
      if (!pull.ok) {
        const resolved = await this.settleConflicts(options);
        if (resolved === "aborted") {
          return this.report(options, "conflict-aborted", pages, S.git.notices.conflictAbortedSync, {
            subtle: true,
          });
        }
        if (resolved === "none" || resolved === "unresolved") {
          return this.failure(options, S.git.errors.refreshFailed, detailOf(pull));
        }
      }
    }

    const pushed = await this.deps.git.push();
    if (!pushed.ok) {
      return this.failure(options, S.git.errors.pushFailed, pushHint(pushed));
    }

    return this.report(options, "ok", pages, S.git.notices.synced(pages));
  }

  // -------------------------------------------------------------- guard rails

  /**
   * Everything that must hold before a flow touches the repository (ARCHITECTURE §4.5).
   * Returns the status it already had to read, or null when the flow must not proceed.
   */
  private async checkGuardRails(options: FlowOptions): Promise<GitStatus | null> {
    const { git, ui } = this.deps;

    if ((await git.version()) === null) {
      this.notifyError(options, S.git.errors.gitMissing);
      return null;
    }
    if (!(await git.isRepo())) {
      this.notifyError(options, S.git.errors.notARepo);
      return null;
    }

    const inProgress = await git.inProgressState();
    if (inProgress === "rebase") {
      // Left over from a previous session or a terminal: finish it before anything else.
      // 'none' means it needed no decisions and is now done — that is a clean start, not a stop.
      const settled = await this.settleConflicts(options);
      if (settled === "aborted") {
        if (!options.unattended) ui.info(S.git.notices.conflictAborted);
        return null;
      }
      if (settled === "unresolved") return null;
    } else if (inProgress !== null) {
      this.notifyError(options, S.git.errors.operationInProgress(inProgress));
      return null;
    }

    const status = await git.status();
    const branch = this.deps.settings().wikiBranch;

    if (status.detached) {
      this.notifyError(options, S.git.errors.detachedHead(branch));
      return null;
    }
    if (status.branch !== branch) {
      this.notifyError(options, S.git.errors.wrongBranch(status.branch ?? "?", branch));
      return null;
    }
    if (status.upstream === null) {
      this.notifyError(options, S.git.errors.noUpstream(branch));
      return null;
    }
    return status;
  }

  // ---------------------------------------------------------------- conflicts

  /**
   * Drive the repository out of a conflicted state, one stopped commit at a time.
   *
   * 'none' means there was nothing conflicted to settle — the caller's command failed for
   * another reason and should say so rather than claim a conflict.
   */
  private async settleConflicts(
    options: FlowOptions,
  ): Promise<"resolved" | "aborted" | "unresolved" | "none"> {
    const { git, ui } = this.deps;
    const flowState = this.currentState;
    let sawConflict = false;

    for (let round = 0; ; round++) {
      if (round > MAX_CONFLICT_ROUNDS) {
        this.notifyError(options, S.git.errors.tooManyConflictRounds);
        return "unresolved";
      }

      const conflicts = conflictedPaths(await git.status());
      const rebasing = (await git.inProgressState()) === "rebase";

      if (conflicts.length === 0) {
        if (!rebasing) return sawConflict ? "resolved" : "none";
        // A rebase parked with a clean tree (e.g. an emptied commit) still needs finishing.
        const advanced = await this.advanceRebase();
        if (advanced === "stopped") return "unresolved";
        if (advanced === "done") return sawConflict ? "resolved" : "none";
        continue;
      }

      sawConflict = true;
      if (options.unattended) {
        // Nobody is watching a background sync; never park the repo mid-rebase.
        return (await this.abortRebase(options, rebasing)) ? "aborted" : "unresolved";
      }

      this.setState("conflict");
      const answer = await ui.askConflicts(conflicts.map(toConflictFile));
      this.setState(flowState);

      if (answer.action === "abort") {
        return (await this.abortRebase(options, rebasing)) ? "aborted" : "unresolved";
      }

      const failed: string[] = [];
      for (const path of conflicts) {
        const choice = answer.choices.get(path) ?? "mine";
        if (!(await git.resolveConflict(path, choice))) failed.push(path);
      }
      if (failed.length > 0) {
        this.notifyError(options, S.git.errors.resolveFailed(failed.map(titleOf).join(", ")));
        return "unresolved";
      }

      if (!rebasing) return "resolved"; // conflicts came from re-applying the autostash
      if ((await this.advanceRebase()) === "stopped") return "unresolved";
      // Loop: the next replayed commit may conflict too.
    }
  }

  /** `rebase --continue`, falling back to `--skip` when our resolution emptied the commit. */
  private async advanceRebase(): Promise<"done" | "continued" | "stopped"> {
    const { git } = this.deps;
    let result = await git.rebaseContinue();
    if (!result.ok && isEmptyCommit(result)) result = await git.rebaseSkip();
    if (!result.ok && conflictedPaths(await git.status()).length === 0) return "stopped";
    return (await git.inProgressState()) === "rebase" ? "continued" : "done";
  }

  private async abortRebase(options: FlowOptions, rebasing: boolean): Promise<boolean> {
    if (!rebasing) {
      // Conflicts outside a rebase come from the autostash; only a human can unpick those.
      this.notifyError(options, S.git.errors.cannotAbort);
      return false;
    }
    const aborted = await this.deps.git.rebaseAbort();
    if (!aborted.ok) {
      this.notifyError(options, S.git.errors.abortFailed, detailOf(aborted));
      return false;
    }
    return true;
  }

  // ----------------------------------------------------------------- plumbing

  private async stageEverything(): Promise<string[] | null> {
    const staged = await this.deps.git.stageAll();
    if (!staged.ok) return null;
    return this.deps.git.stagedFiles();
  }

  private async commit(staged: readonly string[]): Promise<GitResult> {
    const message = formatCommitMessage(this.deps.settings().commitMessageTemplate, {
      paths: staged,
      user: await this.deps.git.userName(),
      date: (this.deps.now ?? (() => new Date()))(),
    });
    return this.deps.git.commit(message);
  }

  private async pagesChangedSince(before: string | null): Promise<number> {
    const after = await this.deps.git.headSha();
    if (!before || !after || before === after) return 0;
    return countPages(await this.deps.git.changedFilesBetween(before, after));
  }

  private offline(options: FlowOptions, result: GitResult): SyncResult {
    // Being offline is a normal state for a laptop, not a bug — never shout about it.
    this.notifyError(options, S.git.errors.unreachable, detailOf(result));
    return this.result("offline", 0, S.git.errors.unreachable);
  }

  private setState(state: SyncState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    this.deps.onStateChange?.(state);
  }

  private report(
    options: FlowOptions,
    outcome: SyncOutcome,
    pages: number,
    message: string,
    display: { subtle?: boolean } = {},
  ): SyncResult {
    if (!options.unattended) {
      if (display.subtle) this.deps.ui.info(message);
      else this.deps.ui.success(message);
    }
    return this.result(outcome, pages, message);
  }

  private failure(options: FlowOptions, message: string, detail?: string): SyncResult {
    this.notifyError(options, message, detail);
    return this.result("error", 0, message);
  }

  private reportFailure(options: FlowOptions, error: unknown): SyncResult {
    if (error instanceof GitUnavailableError) {
      return this.failure(options, S.git.errors.gitMissing, error.message);
    }
    if (error instanceof GitTimeoutError) {
      return this.failure(options, S.git.errors.timedOut, error.command);
    }
    return this.failure(options, S.git.errors.unexpected, messageOf(error));
  }

  /** Background runs log instead of interrupting; foreground runs always show a Notice. */
  private notifyError(options: FlowOptions, message: string, detail?: string): void {
    if (options.unattended) console.warn(`[azure-devops-wiki] ${message}`, detail ?? "");
    else this.deps.ui.error(message, detail);
  }

  private result(outcome: SyncOutcome, pages: number, message: string): SyncResult {
    return { outcome, pages, message };
  }
}

function toConflictFile(path: string): ConflictFile {
  return { path, title: titleOf(path) };
}

function titleOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.toLowerCase().endsWith(".md") ? decodeFileName(name) : name;
}

function detailOf(result: GitResult): string {
  return firstLine(result.stderr) || firstLine(result.stdout);
}

/** git's way of saying "your resolution left this commit with no changes". */
function isEmptyCommit(result: GitResult): boolean {
  return /nothing to commit|no changes|now empty|--skip/i.test(result.stderr + result.stdout);
}

function pushHint(result: GitResult): string {
  const detail = detailOf(result);
  return /non-fast-forward|fetch first|rejected/i.test(result.stderr)
    ? `${S.git.errors.pushRejectedHint} (${detail})`
    : detail;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
