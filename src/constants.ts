/** Hard limits and conventions of the Azure DevOps wiki format (docs/ADO-WIKI-FORMAT.md). */

export const MAX_FULL_PATH_CHARS = 235;
export const MAX_PAGE_FILE_BYTES = 18 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 19 * 1024 * 1024;

/**
 * ADO counts the repo URL toward the 235-character limit, and we only see the vault-relative
 * path. Warn once a path gets within a typical repo-URL's distance of the limit.
 */
export const PATH_LENGTH_WARN_CHARS = 180;

/** Names Windows refuses regardless of what ADO allows (the vault lives on disk). */
export const WINDOWS_RESERVED_NAMES: ReadonlySet<string> = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

/**
 * What a wiki provisioned today is on. Only a starting point: wikis created before Azure DevOps
 * renamed the default branch are still on `wikiMaster` and were never migrated, and a "publish
 * code as wiki" repository uses any branch at all (ADO-WIKI-FORMAT §5) — so this is the value
 * `branchToAdopt` treats as "the user has not chosen", not an assumption about the wiki.
 */
export const DEFAULT_WIKI_BRANCH = "wikiMain";

export const ATTACHMENTS_DIR = ".attachments";
export const ORDER_FILE = ".order";
/** Obsidian's own per-vault configuration — never wiki content, never staged for a sync. */
export const OBSIDIAN_CONFIG_DIR = ".obsidian";

/** Characters that may never appear in a page title. */
export const FORBIDDEN_TITLE_CHARS = ["/", "\\", "#"] as const;

/**
 * Title character → file-name escape. Space→hyphen is handled separately by the codec
 * (it is a substitution, not a percent-escape, and ordering between the two matters).
 */
export const TITLE_CHAR_TO_ESCAPE: ReadonlyMap<string, string> = new Map([
  ["-", "%2D"],
  [":", "%3A"],
  ["*", "%2A"],
  ["?", "%3F"],
  ["|", "%7C"],
  ['"', "%22"],
  ["<", "%3C"],
  [">", "%3E"],
]);
