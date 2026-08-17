/**
 * The checks behind "Check vault setup" (ARCHITECTURE §7).
 *
 * Split from the modal so each rule is a small function over facts, not over Obsidian: the
 * facts are gathered by `setupCheck.ts` and the decisions live here, where they can be read
 * in one screen and tested.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */
import { OBSIDIAN_CONFIG_DIR } from "../constants";
import { S } from "../strings";

export type SetupIssueId =
  | "gitignore"
  | "cloud-folder"
  | "wikilinks"
  | "link-format"
  | "detect-extensions"
  | "source-mode"
  | "line-endings"
  | "not-a-repo"
  | "not-repo-root";

export interface SetupIssue {
  id: SetupIssueId;
  severity: "error" | "warn" | "info";
  name: string;
  description: string;
  /** Present when the plugin can put it right; absent when only the user can. */
  fixLabel?: string;
  advice?: string;
}

export interface VaultFacts {
  /** Absolute path of the vault on disk. */
  vaultPath: string;
  isRepo: boolean;
  /** Absolute path of the repository root, when there is one. */
  repoRoot: string | null;
  /** Contents of the vault's .gitignore, or null when there is none. */
  gitignore: string | null;
  /** Obsidian's own per-vault options, as far as they matter here. */
  useWikilinks: boolean;
  newLinkFormat: string;
  detectAllExtensions: boolean;
  /**
   * False when Obsidian is set to plain Source mode, in which *nothing* renders while editing —
   * not tables, not images, and none of this plugin's Azure DevOps rendering either. Reported
   * because "the markdown does not render in edit mode" has this as one of its two causes.
   */
  livePreview: boolean;
  /**
   * The effective `core.autocrlf` of this clone, lowercased; null when git could not be asked.
   *
   * `true` is the default Git for Windows installs, and it is wrong for a wiki edited in Obsidian:
   * git checks pages out with CRLF, Obsidian saves them back with LF, and git then calls every
   * edited page modified forever — which is what made the "not published yet" marks look random
   * (round 4, item 1). `input` and `false` both leave the bytes alone and are fine.
   */
  autocrlf: string | null;
}

/** File-syncing services that lock files while uploading — the top risk in ARCHITECTURE §10. */
const CLOUD_FOLDERS: ReadonlyArray<[RegExp, string]> = [
  [/[/\\]OneDrive([ -][^/\\]*)?[/\\]/i, "OneDrive"],
  [/[/\\]Dropbox[/\\]/i, "Dropbox"],
  [/[/\\]Google ?Drive[/\\]/i, "Google Drive"],
  [/[/\\]iCloudDrive?[/\\]/i, "iCloud Drive"],
  [/[/\\]Box( Sync)?[/\\]/i, "Box"],
];

export function checkVault(facts: VaultFacts): SetupIssue[] {
  const issues: SetupIssue[] = [];

  if (!facts.isRepo) {
    issues.push({
      id: "not-a-repo",
      severity: "error",
      name: S.setup.notARepoName,
      description: S.setup.notARepoDesc,
    });
  } else if (facts.repoRoot !== null && !samePath(facts.repoRoot, facts.vaultPath)) {
    issues.push({
      id: "not-repo-root",
      severity: "error",
      name: S.setup.rootName,
      description: `${S.setup.rootDesc} (${facts.repoRoot})`,
    });
  }

  const cloud = cloudServiceOf(facts.vaultPath);
  if (cloud !== null) {
    issues.push({
      id: "cloud-folder",
      severity: "warn",
      name: S.setup.cloudName(cloud),
      description: S.setup.cloudDesc,
      advice: S.setup.cloudAdvice,
    });
  }

  if (facts.isRepo && facts.autocrlf === "true") {
    issues.push({
      id: "line-endings",
      severity: "warn",
      name: S.setup.lineEndingsName,
      description: S.setup.lineEndingsDesc,
      fixLabel: S.setup.lineEndingsFix,
    });
  }

  if (facts.isRepo && !ignoresObsidianConfig(facts.gitignore)) {
    issues.push({
      id: "gitignore",
      severity: "warn",
      name: S.setup.gitignoreName,
      description: S.setup.gitignoreDesc,
      fixLabel: S.setup.gitignoreFix,
    });
  }

  if (facts.useWikilinks) {
    issues.push({
      id: "wikilinks",
      severity: "warn",
      name: S.setup.wikilinksName,
      description: S.setup.wikilinksDesc,
      fixLabel: S.setup.wikilinksFix,
    });
  }

  if (facts.newLinkFormat !== "absolute") {
    issues.push({
      id: "link-format",
      severity: "info",
      name: S.setup.linkFormatName,
      description: S.setup.linkFormatDesc,
      fixLabel: S.setup.linkFormatFix,
    });
  }

  if (!facts.livePreview) {
    issues.push({
      id: "source-mode",
      severity: "warn",
      name: S.setup.sourceModeName,
      description: S.setup.sourceModeDesc,
      fixLabel: S.setup.sourceModeFix,
    });
  }

  if (facts.detectAllExtensions) {
    issues.push({
      id: "detect-extensions",
      severity: "info",
      name: S.setup.extensionsName,
      description: S.setup.extensionsDesc,
      fixLabel: S.setup.extensionsFix,
    });
  }

  return issues;
}

/** Which file-syncing service a path sits inside, or null. */
export function cloudServiceOf(path: string): string | null {
  const padded = `${path.replace(/[\\/]+$/, "")}/`;
  for (const [pattern, name] of CLOUD_FOLDERS) {
    if (pattern.test(padded)) return name;
  }
  return null;
}

/** Whether a .gitignore already keeps Obsidian's config out of the wiki. */
export function ignoresObsidianConfig(gitignore: string | null): boolean {
  if (gitignore === null) return false;
  return gitignore
    .split(/\r?\n/)
    .some((line) => new RegExp(`^\\s*/?${OBSIDIAN_CONFIG_DIR}/?\\s*$`).test(line));
}

/** The lines to append to .gitignore, keeping whatever is already there. */
export function gitignoreAddition(gitignore: string | null): string {
  const wanted = [`${OBSIDIAN_CONFIG_DIR}/`, ".trash/", ".DS_Store"];
  const existing = new Set(
    (gitignore ?? "").split(/\r?\n/).map((line) => line.trim().replace(/^\//, "")),
  );
  const missing = wanted.filter((line) => !existing.has(line) && !existing.has(line.replace(/\/$/, "")));
  if (missing.length === 0) return "";

  const base = gitignore ?? "";
  const separator = base.length === 0 || base.endsWith("\n") ? "" : "\n";
  const heading = base.length === 0 ? "" : "\n# Obsidian (added by the Azure DevOps Wiki plugin)\n";
  return `${separator}${heading}${missing.join("\n")}\n`;
}

function samePath(a: string, b: string): boolean {
  const normalize = (path: string): string =>
    path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return normalize(a) === normalize(b);
}
