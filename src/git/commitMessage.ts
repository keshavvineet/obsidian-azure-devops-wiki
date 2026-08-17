import { ATTACHMENTS_DIR } from "../constants";
import { decodeFileName } from "../naming/pageNameCodec";
import { S } from "../strings";

/**
 * Commit message templating (FR-7.6).  [PURE]
 *
 * The audience is the Azure DevOps history pane, where these messages sit next to commits
 * written by engineers — so a change to two pages reads "Home, Release Notes", not
 * "2 files changed". Page names are decoded, because nobody recognises
 * `Pre%2DRelease-RCA-Categories`.
 */

export const DEFAULT_COMMIT_TEMPLATE = "wiki: edited {files} ({date})";

export interface CommitContext {
  /** Repo-relative paths of everything staged. */
  paths: readonly string[];
  /** git config user.name, or '' when git has none configured. */
  user: string;
  date: Date;
}

export function formatCommitMessage(template: string, context: CommitContext): string {
  const source = template.trim().length === 0 ? DEFAULT_COMMIT_TEMPLATE : template;

  const filled = source
    .replace(/\{files\}/g, summarizeChanges(context.paths))
    .replace(/\{date\}/g, formatTimestamp(context.date))
    .replace(/\{user\}/g, context.user.trim());

  // A blank {user} would otherwise leave a double space or a dangling 'by'.
  const cleaned = filled
    .replace(/\bby\s+(?=[(,]|$)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return cleaned.length === 0 ? summarizeChanges(context.paths) : cleaned;
}

/** '2026-08-07 14:03' in the user's own timezone — history is read locally, not in UTC. */
export function formatTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

const MAX_NAMED_PAGES = 3;

/**
 * Human summary of a change set: named pages first, other files counted.
 * '' when nothing changed — callers never commit in that case.
 */
export function summarizeChanges(paths: readonly string[]): string {
  const pages: string[] = [];
  let attachments = 0;
  let others = 0;

  for (const path of paths) {
    if (path.toLowerCase().endsWith(".md")) pages.push(pageTitleOf(path));
    else if (path.split("/").includes(ATTACHMENTS_DIR)) attachments++;
    else others++;
  }

  const parts: string[] = [];
  if (pages.length > 0) parts.push(listPages(pages));
  if (attachments > 0) parts.push(S.git.attachmentCount(attachments));
  if (others > 0) parts.push(S.git.otherFileCount(others));

  if (parts.length <= 1) return parts[0] ?? "";
  return parts.slice(0, -1).join(", ") + S.git.andJoin + parts[parts.length - 1];
}

function listPages(pages: readonly string[]): string {
  if (pages.length <= MAX_NAMED_PAGES) return pages.join(", ");
  const named = pages.slice(0, MAX_NAMED_PAGES).join(", ");
  return named + S.git.andMorePages(pages.length - MAX_NAMED_PAGES);
}

/** Only the page's own name: the full path would swamp a one-line commit message. */
function pageTitleOf(path: string): string {
  const segments = path.split("/");
  return decodeFileName(segments[segments.length - 1]);
}

/** Pages (not attachments) in a change set — what "N pages updated" counts. */
export function countPages(paths: readonly string[]): number {
  return paths.filter((path) => path.toLowerCase().endsWith(".md")).length;
}
