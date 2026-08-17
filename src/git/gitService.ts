import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { OBSIDIAN_CONFIG_DIR } from "../constants";
import { LOG_FORMAT, parseLog, type WikiCommit } from "./gitLog";
import { GitStatus, parseStatus } from "./gitStatus";

/**
 * Thin, typed wrapper around the system `git` binary (FR-7.3, ARCHITECTURE §4.5).
 *
 * Rules this module exists to enforce:
 *  - arguments are always passed as an array to `execFile` — never a shell string, so no user
 *    input (page titles, commit messages, branch names) can ever be interpreted as a command;
 *  - no destructive command is reachable from any code path: no `reset --hard`, no
 *    `push --force`, no `clean` (NFR-3);
 *  - a non-zero exit is data (`GitResult.ok === false`), not an exception — the orchestrator
 *    decides what a failure means for the user.
 *
 * Deliberately free of Obsidian imports: it takes a working directory and returns plain data,
 * which is what makes it testable against a real repository in a temp directory.
 */

export interface GitResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  /** The command as it was run, for the developer log when something fails. */
  command: string;
}

/** Thrown only when git itself cannot be started (not installed, or not on PATH). */
export class GitUnavailableError extends Error {
  constructor(cause: string) {
    super(cause);
    this.name = "GitUnavailableError";
  }
}

/** Thrown when a command outlives its timeout and had to be killed. */
export class GitTimeoutError extends Error {
  constructor(readonly command: string) {
    super(`${command} timed out`);
    this.name = "GitTimeoutError";
  }
}

export type InProgressState = "rebase" | "merge" | "cherry-pick" | "revert" | null;

/** Which side of a conflict the user chose, in their words rather than git's. */
export type ConflictChoice = "mine" | "server";

export interface GitServiceOptions {
  /** Overrides the `git` on PATH; empty means "use PATH". */
  gitPath?: string;
  timeoutMs?: number;
  networkTimeoutMs?: number;
  /** Called with every command and its outcome — wired to the console in the plugin. */
  onCommand?: (result: GitResult) => void;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_NETWORK_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

export class GitService {
  private readonly gitPath: string;
  private readonly timeoutMs: number;
  private readonly networkTimeoutMs: number;
  private readonly onCommand: ((result: GitResult) => void) | undefined;

  constructor(
    readonly cwd: string,
    options: GitServiceOptions = {},
  ) {
    this.gitPath = options.gitPath && options.gitPath.length > 0 ? options.gitPath : "git";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.networkTimeoutMs = options.networkTimeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS;
    this.onCommand = options.onCommand;
  }

  // ----------------------------------------------------------------- plumbing

  /**
   * Runs one git command. `readOnly` commands set GIT_OPTIONAL_LOCKS=0 so that background
   * polling never fights the user's own git for the index lock.
   */
  async run(
    args: string[],
    options: { network?: boolean; readOnly?: boolean; stdin?: string } = {},
  ): Promise<GitResult> {
    // core.quotepath=false keeps unicode in page names readable instead of \303\251 escapes.
    const fullArgs = ["-c", "core.quotepath=false", ...args];
    const command = `git ${args.join(" ")}`;

    return new Promise<GitResult>((resolve, reject) => {
      const child = execFile(
        this.gitPath,
        fullArgs,
        {
          cwd: this.cwd,
          timeout: options.network ? this.networkTimeoutMs : this.timeoutMs,
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
          encoding: "utf8",
          env: {
            ...process.env,
            // A credential prompt on stdin would hang us forever; GUI helpers still work.
            GIT_TERMINAL_PROMPT: "0",
            // Nothing we run may open an editor (rebase --continue would, otherwise).
            GIT_EDITOR: "true",
            GIT_SEQUENCE_EDITOR: "true",
            // Stable, parseable English for the few places we inspect git's prose.
            LC_ALL: "C",
            GIT_OPTIONAL_LOCKS: options.readOnly ? "0" : "1",
          },
        },
        (error, stdout, stderr) => {
          if (error && typeof error.code !== "number") {
            // Either the timeout killed the process, or git could not be started at all
            // (ENOENT/EACCES) — two very different messages for the user.
            reject(error.killed ? new GitTimeoutError(command) : new GitUnavailableError(error.message));
            return;
          }
          const result: GitResult = {
            ok: !error,
            code: typeof error?.code === "number" ? error.code : 0,
            stdout,
            stderr,
            command,
          };
          this.onCommand?.(result);
          resolve(result);
        },
      );
      if (options.stdin !== undefined) child.stdin?.end(options.stdin);
    });
  }

  // -------------------------------------------------------------- guard rails

  /** The installed git version, or null when git cannot be started at all. */
  async version(): Promise<string | null> {
    try {
      const result = await this.run(["--version"], { readOnly: true });
      return result.ok ? result.stdout.trim() : null;
    } catch {
      return null;
    }
  }

  async isRepo(): Promise<boolean> {
    const result = await this.run(["rev-parse", "--is-inside-work-tree"], { readOnly: true });
    return result.ok && result.stdout.trim() === "true";
  }

  /** Absolute path of the repository root; null when the working directory is not in a repo. */
  async repoRoot(): Promise<string | null> {
    const result = await this.run(["rev-parse", "--show-toplevel"], { readOnly: true });
    return result.ok ? result.stdout.trim() : null;
  }

  /**
   * Whether the working directory *is* the repository root, rather than a folder inside one.
   *
   * Asked of git rather than by comparing `repoRoot()` with `cwd`, because those two strings
   * disagree for the same directory: Windows hands out 8.3 short names (`C:\Users\VINEET~1\…`)
   * where git reports the long form (`C:/Users/VineetKhurana/…`), and normalising slashes and
   * case cannot reconcile them. `--show-prefix` is the cwd relative to the root, so it is empty
   * exactly at the root — no path comparison at all.
   */
  async isAtRepoRoot(): Promise<boolean> {
    const result = await this.run(["rev-parse", "--show-prefix"], { readOnly: true });
    return result.ok && result.stdout.trim().length === 0;
  }

  // ------------------------------------------------- setting a wiki up in an existing folder

  /**
   * `git init` in the vault.
   *
   * A wiki is set up this way rather than with `git clone` because the vault already contains
   * `.obsidian/`, and clone refuses a directory that is not empty ("destination path already
   * exists and is not an empty directory"). init + fetch + checkout reaches the same state and
   * leaves the Obsidian configuration where it is — verified against a real repository.
   */
  init(): Promise<GitResult> {
    return this.run(["init"]);
  }

  addRemote(url: string, remote = "origin"): Promise<GitResult> {
    return this.run(["remote", "add", remote, url]);
  }

  /** Branch names the server offers, without fetching anything. */
  async remoteHeads(remote = "origin"): Promise<string[]> {
    const result = await this.run(["ls-remote", "--heads", remote], {
      network: true,
      readOnly: true,
    });
    if (!result.ok) return [];
    return result.stdout
      .split("\n")
      .map((line) => line.split("\t")[1] ?? "")
      .filter((ref) => ref.startsWith("refs/heads/"))
      .map((ref) => ref.slice("refs/heads/".length).trim())
      .filter((name) => name.length > 0);
  }

  /**
   * The branch the server's HEAD points at, which is the wiki's own branch — or null when the
   * server does not say. A fresh `init` has no `origin/HEAD` to read, so this has to be asked.
   */
  async remoteDefaultBranch(remote = "origin"): Promise<string | null> {
    const result = await this.run(["ls-remote", "--symref", remote, "HEAD"], {
      network: true,
      readOnly: true,
    });
    if (!result.ok) return null;
    for (const line of result.stdout.split("\n")) {
      const match = /^ref:\s+refs\/heads\/(.+?)\s+HEAD$/.exec(line.trim());
      if (match?.[1]) return match[1];
    }
    return null;
  }

  /**
   * Check out a fetched branch, tracking its remote counterpart. Not destructive: git refuses
   * rather than overwrite an untracked file, which is the protection that lets this run in a
   * folder the user already had open.
   */
  checkoutTracking(branch: string, remote = "origin"): Promise<GitResult> {
    return this.run(["checkout", "-t", `${remote}/${branch}`]);
  }

  async currentBranch(): Promise<string | null> {
    const result = await this.run(["rev-parse", "--abbrev-ref", "HEAD"], { readOnly: true });
    if (!result.ok) return null;
    const branch = result.stdout.trim();
    return branch === "HEAD" ? null : branch;
  }

  /**
   * Whether git is parked mid-operation. Read from the files git itself uses as its state,
   * because there is no porcelain command that answers this question.
   */
  async inProgressState(): Promise<InProgressState> {
    const result = await this.run(["rev-parse", "--git-dir"], { readOnly: true });
    if (!result.ok) return null;
    const raw = result.stdout.trim();
    const gitDir = isAbsolute(raw) ? raw : join(this.cwd, raw);

    if (existsSync(join(gitDir, "rebase-merge")) || existsSync(join(gitDir, "rebase-apply"))) {
      return "rebase";
    }
    if (existsSync(join(gitDir, "MERGE_HEAD"))) return "merge";
    if (existsSync(join(gitDir, "CHERRY_PICK_HEAD"))) return "cherry-pick";
    if (existsSync(join(gitDir, "REVERT_HEAD"))) return "revert";
    return null;
  }

  /**
   * Whether the remote answers (FR-7.7). Separate from fetch so a flow can warn before it
   * changes anything; `--exit-code` turns "no matching refs" into a failure too.
   */
  async remoteReachable(remote = "origin"): Promise<boolean> {
    const result = await this.run(["ls-remote", "--exit-code", "--heads", remote], {
      network: true,
    });
    return result.ok;
  }

  // ------------------------------------------------------------------- status

  /**
   * `-uall` is not optional here: by default `git status` **collapses an untracked directory into
   * a single entry** ending in `/`, so a brand-new folder full of new pages is reported as
   * `? This is a new page/` and not one line per page.
   *
   * Everything downstream keys on a page's vault path, so that one entry matched no page: the
   * explorer and tree marked none of them as unpublished, the changes pane listed a folder instead
   * of the pages, and — the damaging one — the publish gate filters status entries by `.md` before
   * checking names, so a folder and page with literal spaces sailed past it and were published to
   * the portal, where they cannot be opened or repaired (main.ts's `preSyncLint`).
   *
   * Verified against a real repository: default reports `? This is a new page/`, `-uall` reports
   * `? This is a new page/This is a sample page 2.md`.
   */
  async status(): Promise<GitStatus> {
    const result = await this.run(["status", "--porcelain=v2", "--branch", "-uall"], {
      readOnly: true,
    });
    if (!result.ok) throw new Error(firstLine(result.stderr) || "git status failed");
    return parseStatus(result.stdout);
  }

  async headSha(): Promise<string | null> {
    const result = await this.run(["rev-parse", "HEAD"], { readOnly: true });
    return result.ok ? result.stdout.trim() : null;
  }

  /**
   * Paths whose **content** differs from what is committed — the answer to "what have I actually
   * changed", which `git status` does not give.
   *
   * `git status` reports a file as modified whenever its recorded stat no longer matches disk,
   * and on Windows that happens without a single character changing: Obsidian always saves LF,
   * git checks the file out as CRLF when `core.autocrlf=true`, and the file then stays "modified"
   * for good. Three pages in the reference wiki were in exactly that state — byte-identical to
   * their committed blob (`git hash-object` matched) yet permanently listed by `git status`, which
   * is what made the plugin's unpublished-page marks look like they appeared at random.
   *
   * `git diff` applies the same end-of-line conversion before comparing, so it answers the
   * question the user is really asking. `-z` because a page name may contain anything except a
   * NUL (ADO-WIKI-FORMAT §2).
   *
   * @returns the changed paths, or null when git could not answer — "do not filter anything"
   *   is the honest fallback, and it keeps a broken diff from hiding real work.
   */
  async contentChangedPaths(): Promise<Set<string> | null> {
    const [worktree, staged] = await Promise.all([
      this.run(["diff", "--name-only", "-z"], { readOnly: true }),
      this.run(["diff", "--cached", "--name-only", "-z"], { readOnly: true }),
    ]);
    if (!worktree.ok || !staged.ok) return null;

    const paths = new Set<string>();
    for (const result of [worktree, staged]) {
      for (const path of result.stdout.split("\0")) {
        if (path.length > 0) paths.add(path);
      }
    }
    return paths;
  }

  /** One config value from this repository's effective configuration; null when it is unset. */
  async configValue(key: string): Promise<string | null> {
    const result = await this.run(["config", "--get", key], { readOnly: true });
    if (!result.ok) return null;
    const value = result.stdout.trim();
    return value.length === 0 ? null : value;
  }

  /** Write a config value into **this repository only** — never the user's global git config. */
  async setLocalConfig(key: string, value: string): Promise<boolean> {
    return (await this.run(["config", "--local", key, value])).ok;
  }

  /**
   * Bring the index's cached stat information back in line with disk.
   *
   * Purely a bookkeeping call — it can add, remove or change nothing, it only stops git from
   * reporting files as modified when their content is identical. Exit code 1 just means "some
   * entries really have changed", which is not a failure here.
   */
  async refreshIndex(): Promise<void> {
    await this.run(["update-index", "--refresh"]).catch(() => undefined);
  }

  /**
   * The identity that will appear on the next commit — asked for directly rather than assumed,
   * because a machine that already has git configured globally can carry a different name here
   * than the one someone expects to see on their wiki edits (ADO-WIKI-FORMAT §5's evidence: the
   * same reference wiki's history shows a different author for commits made from Obsidian than
   * for ones made in the portal). `set*` write to *this* repository only, matching the identity
   * to what the user actually wants credited here without touching any other clone.
   */
  async userName(): Promise<string> {
    const result = await this.run(["config", "user.name"], { readOnly: true });
    return result.ok ? result.stdout.trim() : "";
  }

  async userEmail(): Promise<string> {
    const result = await this.run(["config", "user.email"], { readOnly: true });
    return result.ok ? result.stdout.trim() : "";
  }

  async setUserName(name: string): Promise<boolean> {
    return (await this.run(["config", "user.name", name])).ok;
  }

  async setUserEmail(email: string): Promise<boolean> {
    return (await this.run(["config", "user.email", email])).ok;
  }

  async remoteUrl(remote = "origin"): Promise<string | null> {
    const result = await this.run(["remote", "get-url", remote], { readOnly: true });
    return result.ok ? result.stdout.trim() : null;
  }

  /**
   * "Sign out": tells the credential helper to forget whatever it has cached for this remote,
   * so the next Refresh or Sync re-authenticates instead of silently reusing an old account.
   * `git credential reject` only erases the cache — it cannot fail destructively, and it never
   * opens a prompt itself.
   */
  async forgetStoredCredential(remote = "origin"): Promise<boolean> {
    const url = await this.remoteUrl(remote);
    if (url === null) return false;
    return (await this.run(["credential", "reject"], { stdin: `url=${url}\n\n` })).ok;
  }

  /** Paths changed between two commits — how a refresh reports what arrived. */
  async changedFilesBetween(from: string, to: string): Promise<string[]> {
    const result = await this.run(["diff", "--name-only", from, to], { readOnly: true });
    return result.ok ? splitLines(result.stdout) : [];
  }

  /**
   * The most recent commits and the files each touched — what the "Recent changes" sidebar shows
   * (FR-7.8). Read-only, no network: it reports the history this clone already has, which is
   * exactly what "since my last Refresh" means to the user.
   */
  async recentCommits(limit = 20): Promise<WikiCommit[]> {
    const result = await this.run(
      [
        "log",
        `--max-count=${Math.max(1, Math.floor(limit))}`,
        "--name-only",
        "--no-renames",
        `--pretty=format:${LOG_FORMAT}`,
      ],
      { readOnly: true },
    );
    // A repository with no commits yet fails here, and an empty history is the honest answer.
    return result.ok ? parseLog(result.stdout) : [];
  }

  /**
   * The commits that touched one page — "who changed this page, and when".
   *
   * `--follow` so a page keeps its history across the rename that every retitling performs in
   * this format, and the pathspec is passed after `--` because an ADO page name can contain `?`,
   * `*` and leading dashes, all of which git would otherwise read as options or globs.
   */
  async fileHistory(vaultPath: string, limit = 20): Promise<WikiCommit[]> {
    const result = await this.run(
      [
        "log",
        `--max-count=${Math.max(1, Math.floor(limit))}`,
        "--name-only",
        "--follow",
        `--pretty=format:${LOG_FORMAT}`,
        "--",
        vaultPath,
      ],
      { readOnly: true },
    );
    return result.ok ? parseLog(result.stdout) : [];
  }

  async stagedFiles(): Promise<string[]> {
    const result = await this.run(["diff", "--cached", "--name-only"], { readOnly: true });
    return result.ok ? splitLines(result.stdout) : [];
  }

  // --------------------------------------------------------------- operations

  fetch(remote = "origin"): Promise<GitResult> {
    return this.run(["fetch", remote], { network: true });
  }

  /** FR-7.1: the refresh. --autostash so an in-flight edit never blocks a pull. */
  pullRebaseAutostash(): Promise<GitResult> {
    return this.run(["pull", "--rebase", "--autostash"], { network: true });
  }

  /**
   * Stages everything below the vault, including deletions; never outside it.
   *
   * `.obsidian/` is this app's own configuration, not wiki content — a functional user's first
   * Sync must not drop an Obsidian workspace into a wiki everyone else reads. (Phase 6's setup
   * check fixes the underlying problem properly by putting it in `.gitignore`.) Excluding it
   * here also means a repo that *does* track it keeps its existing history untouched.
   */
  stageAll(): Promise<GitResult> {
    return this.run(["add", "-A", "--", ".", `:(exclude)${OBSIDIAN_CONFIG_DIR}`]);
  }

  commit(message: string): Promise<GitResult> {
    return this.run(["commit", "-m", message]);
  }

  push(): Promise<GitResult> {
    return this.run(["push"], { network: true });
  }

  rebaseContinue(): Promise<GitResult> {
    return this.run(["rebase", "--continue"]);
  }

  rebaseSkip(): Promise<GitResult> {
    return this.run(["rebase", "--skip"]);
  }

  rebaseAbort(): Promise<GitResult> {
    return this.run(["rebase", "--abort"]);
  }

  /**
   * Resolve one conflicted file the way the user asked.
   *
   * The inversion is the whole reason this lives behind a named method: **during a rebase git's
   * `--ours` is the server's branch** (the commits being rebased onto) and `--theirs` is the
   * local work being replayed. Wiring the modal's "keep my version" straight to `--ours` would
   * silently do the opposite of what the user clicked. The same holds while an autostash is
   * being re-applied: `--ours` is the freshly pulled tree, `--theirs` the stashed edits.
   *
   * @returns false when the file could not be resolved and needs a human.
   */
  async resolveConflict(path: string, choice: ConflictChoice): Promise<boolean> {
    const stages = await this.unmergedStages(path);
    if (stages.size === 0) return true; // already resolved

    const wanted = choice === "mine" ? 3 : 2;
    if (!stages.has(wanted)) {
      // The chosen side deleted the page — accepting that side means removing the file.
      const removed = await this.run(["rm", "-f", "--", path]);
      return removed.ok;
    }

    const side = choice === "mine" ? "--theirs" : "--ours";
    const checkout = await this.run(["checkout", side, "--", path]);
    if (!checkout.ok) return false;
    return (await this.run(["add", "--", path])).ok;
  }

  /** Which sides of a conflict exist: 1 = common ancestor, 2 = server ("ours"), 3 = local. */
  private async unmergedStages(path: string): Promise<Set<number>> {
    const result = await this.run(["ls-files", "-u", "--", path], { readOnly: true });
    const stages = new Set<number>();
    if (!result.ok) return stages;
    for (const line of splitLines(result.stdout)) {
      // <mode> <sha> <stage>\t<path>
      const match = /^\d+ [0-9a-f]+ ([123])\t/.exec(line);
      if (match) stages.add(Number(match[1]));
    }
    return stages;
  }
}

export function firstLine(text: string): string {
  return text.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.length > 0);
}
