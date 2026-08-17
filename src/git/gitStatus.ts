import { OBSIDIAN_CONFIG_DIR } from "../constants";
import { S } from "../strings";

/**
 * Parsing and presentation of `git status --porcelain=v2 --branch` (FR-7.2).  [PURE]
 *
 * Porcelain v2 is the format git guarantees for scripts: field positions never change, and
 * ahead/behind arrive as data rather than as an English sentence we would have to scrape.
 */

export type ChangeKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflicted";

export interface ChangedFile {
  /** Repo-relative path (the new path for a rename). */
  path: string;
  kind: ChangeKind;
  /** True when the change is already in the index. */
  staged: boolean;
}

export interface GitStatus {
  /** Current branch, or null when HEAD is detached. */
  branch: string | null;
  detached: boolean;
  /** Upstream tracking branch, e.g. 'origin/wikiMain'; null when the branch tracks nothing. */
  upstream: string | null;
  /** Commits we have that the remote does not — as of the last fetch. */
  ahead: number;
  /** Commits the remote has that we do not — as of the last fetch. */
  behind: number;
  files: ChangedFile[];
}

export const EMPTY_STATUS: GitStatus = {
  branch: null,
  detached: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  files: [],
};

export function parseStatus(stdout: string): GitStatus {
  const status: GitStatus = { ...EMPTY_STATUS, files: [] };

  for (const line of stdout.split(/\r?\n/)) {
    if (line.length === 0) continue;

    if (line.startsWith("# ")) {
      applyHeader(status, line.slice(2));
      continue;
    }

    switch (line[0]) {
      case "1": {
        // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
        const { fields, rest } = splitFields(line, 8);
        status.files.push(ordinaryChange(fields[1], unquotePath(rest)));
        break;
      }
      case "2": {
        // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path><TAB><origPath>
        const { fields, rest } = splitFields(line, 9);
        const [path] = rest.split("\t");
        status.files.push({
          path: unquotePath(path),
          kind: "renamed",
          staged: fields[1][0] !== ".",
        });
        break;
      }
      case "u": {
        // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
        const { rest } = splitFields(line, 10);
        status.files.push({ path: unquotePath(rest), kind: "conflicted", staged: false });
        break;
      }
      case "?":
        status.files.push({
          path: unquotePath(line.slice(2)),
          kind: "untracked",
          staged: false,
        });
        break;
      default:
        // '!' is an ignored file (only listed with --ignored); anything else is not ours.
        break;
    }
  }

  return status;
}

function applyHeader(status: GitStatus, header: string): void {
  const space = header.indexOf(" ");
  if (space === -1) return;
  const key = header.slice(0, space);
  const value = header.slice(space + 1).trim();

  if (key === "branch.head") {
    status.detached = value === "(detached)";
    status.branch = status.detached ? null : value;
  } else if (key === "branch.upstream") {
    status.upstream = value;
  } else if (key === "branch.ab") {
    // '+3 -1' — ahead 3, behind 1.
    const match = /^\+(\d+) -(\d+)$/.exec(value);
    if (match) {
      status.ahead = Number(match[1]);
      status.behind = Number(match[2]);
    }
  }
}

function ordinaryChange(xy: string, path: string): ChangedFile {
  const [staged, worktree] = [xy[0], xy[1]];
  const code = staged !== "." ? staged : worktree;
  const kind: ChangeKind =
    code === "A" ? "added" : code === "D" ? "deleted" : code === "U" ? "conflicted" : "modified";
  return { path, kind, staged: staged !== "." };
}

/** Splits off the first `count` space-separated fields; `rest` is the remainder verbatim. */
function splitFields(line: string, count: number): { fields: string[]; rest: string } {
  const fields: string[] = [];
  let index = 0;
  for (let field = 0; field < count; field++) {
    const space = line.indexOf(" ", index);
    if (space === -1) {
      fields.push(line.slice(index));
      return { fields, rest: "" };
    }
    fields.push(line.slice(index, space));
    index = space + 1;
  }
  return { fields, rest: line.slice(index) };
}

/**
 * Git C-quotes paths containing control characters, quotes or backslashes. Non-ASCII stays
 * literal because every call passes `-c core.quotepath=false` (gitService), which matters
 * here: ADO page names keep unicode punctuation as-is (ADO-WIKI-FORMAT §2).
 */
function unquotePath(path: string): string {
  if (!path.startsWith('"') || !path.endsWith('"') || path.length < 2) return path;
  return path
    .slice(1, -1)
    .replace(/\\([\\"tnr])/g, (_, char: string) =>
      char === "t" ? "\t" : char === "n" ? "\n" : char === "r" ? "\r" : char,
    );
}

// ------------------------------------------------------------------ queries

export function conflictedPaths(status: GitStatus): string[] {
  return status.files.filter((file) => file.kind === "conflicted").map((file) => file.path);
}

/**
 * Files the user has touched — what "you have unsaved wiki changes" means.
 *
 * An untracked `.obsidian/` is this app's own config, which the sync deliberately never stages;
 * counting it would leave a permanent "you have changes" badge next to "nothing to sync". A
 * *tracked* one belongs to the repository and is counted like any other file.
 */
export function dirtyCount(status: GitStatus): number {
  return status.files.filter((file) => file.kind !== "conflicted" && !isAppConfigNoise(file))
    .length;
}

function isAppConfigNoise(file: ChangedFile): boolean {
  return file.kind === "untracked" && file.path.startsWith(OBSIDIAN_CONFIG_DIR);
}

/**
 * Drop files `git status` calls modified but whose content is identical to what is committed.
 *
 * On Windows this is not an edge case. Obsidian saves every file with LF; git checks wiki pages
 * out with CRLF whenever `core.autocrlf=true`; from then on `git status` lists those pages as
 * modified for good, while `git diff` — which applies the same conversion before comparing —
 * reports nothing. Marking them as unpublished told the user they had edited pages they had never
 * touched, and the set drifted as they browsed, which is why it read as random.
 *
 * Everything that is not an "is the text different" question is kept as-is: an untracked file has
 * no committed version to compare against, a rename can be a real change with identical content,
 * and a conflict is never noise.
 *
 * @param contentChanged paths `git diff` reports, or null when git could not say — in which case
 *   the status is returned untouched, because hiding real work is the worse failure.
 */
export function withoutUnchangedFiles(
  status: GitStatus,
  contentChanged: ReadonlySet<string> | null,
): GitStatus {
  if (contentChanged === null) return status;
  return {
    ...status,
    files: status.files.filter(
      (file) =>
        file.kind === "untracked" ||
        file.kind === "conflicted" ||
        file.kind === "renamed" ||
        contentChanged.has(file.path),
    ),
  };
}

// --------------------------------------------------------------- presentation

export interface StatusDisplay {
  text: string;
  tooltip: string;
}

/**
 * The status bar's one-line summary plus its hover detail (FR-7.2).
 *
 * Ahead/behind counts are only as fresh as the last fetch, so the tooltip says when that was
 * rather than implying the plugin is watching the server continuously.
 */
export function describeStatus(
  status: GitStatus | null,
  options: { lastRefresh: number | null; now: number; busy?: string | null },
): StatusDisplay {
  if (options.busy) {
    return { text: `${S.git.statusPrefix} ${options.busy}`, tooltip: options.busy };
  }
  if (!status) {
    return { text: S.git.statusUnavailable, tooltip: S.git.statusUnavailableDetail };
  }

  const parts = [status.detached ? S.git.detached : (status.branch ?? S.git.unknownBranch)];
  if (status.behind > 0) parts.push(`↓${status.behind}`);
  if (status.ahead > 0) parts.push(`↑${status.ahead}`);
  const dirty = dirtyCount(status);
  if (dirty > 0) parts.push(`●${dirty}`);
  const conflicts = conflictedPaths(status).length;
  if (conflicts > 0) parts.push(`⚠${conflicts}`);

  const detail = [`${S.git.branchLabel}: ${status.branch ?? S.git.detached}`];
  detail.push(dirty > 0 ? S.git.dirtyDetail(dirty) : S.git.cleanDetail);
  if (status.behind > 0) detail.push(S.git.behindDetail(status.behind));
  if (status.ahead > 0) detail.push(S.git.aheadDetail(status.ahead));
  if (conflicts > 0) detail.push(S.git.conflictDetail(conflicts));
  detail.push(
    options.lastRefresh === null
      ? S.git.neverRefreshed
      : S.git.lastRefreshed(formatRelativeTime(options.lastRefresh, options.now)),
  );
  detail.push(S.git.clickForActions);

  return { text: `${S.git.statusPrefix} ${parts.join(" ")}`, tooltip: detail.join("\n") };
}

/** Coarse "how long ago" for the status bar — precision below a minute helps nobody. */
export function formatRelativeTime(then: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return S.git.justNow;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return S.git.minutesAgo(minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return S.git.hoursAgo(hours);
  return S.git.daysAgo(Math.round(hours / 24));
}
