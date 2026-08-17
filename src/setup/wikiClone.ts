/**
 * Setting a wiki up inside an empty vault, from the URL the portal's *Clone wiki* button gives
 * (FR-7.8).  [PURE]
 *
 * PURE MODULE — must not import from 'obsidian'.
 *
 * The user pastes one URL and the plugin works out the rest, because the alternative is asking
 * a non-technical user to assemble `{org}/{project}/_git/{project}.wiki` by hand, percent-encode
 * the project name, and know which of those three words the portal calls what.
 */

/** Everything the setup flow needs, recovered from one pasted URL. */
export interface WikiCloneTarget {
  /** What `git remote add` is given. Any embedded password is stripped first. */
  remoteUrl: string;
  /** For the Organization URL setting — no user info, no trailing slash. */
  organizationUrl: string;
  /** Decoded, as a human reads it: `AX BIS`, not `AX%20BIS`. */
  project: string;
  /** Decoded repository name, usually `{project}.wiki`. */
  wikiName: string;
}

export type CloneUrlProblem =
  | "empty"
  | "not-a-url"
  /** The address bar of the wiki itself rather than its clone URL — the likeliest mistake. */
  | "portal-page-url"
  /** SSH form: valid git, but needs a key pair this audience will not have set up. */
  | "ssh"
  | "not-a-git-url"
  | "missing-parts";

export type WikiCloneUrlResult =
  | { ok: true; target: WikiCloneTarget }
  | { ok: false; problem: CloneUrlProblem };

/** The segment Azure DevOps puts before a repository name in every clone URL. */
const GIT_SEGMENT = "/_git/";

export function parseWikiCloneUrl(input: string): WikiCloneUrlResult {
  const raw = input.trim();
  if (raw.length === 0) return { ok: false, problem: "empty" };

  // `git@ssh.dev.azure.com:v3/org/project/repo` is not a URL any parser accepts, and it is worth
  // naming rather than calling malformed: the Clone dialog offers it right beside HTTPS.
  if (raw.startsWith("git@") || raw.startsWith("ssh://")) return { ok: false, problem: "ssh" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, problem: "not-a-url" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, problem: "not-a-url" };
  }

  // Copying the address bar while reading the wiki gives `/_wiki/wikis/…`, which is a different
  // thing entirely and cannot be cloned. Say so specifically.
  if (url.pathname.includes("/_wiki/")) return { ok: false, problem: "portal-page-url" };

  const at = url.pathname.indexOf(GIT_SEGMENT);
  if (at === -1) return { ok: false, problem: "not-a-git-url" };

  const before = url.pathname.slice(0, at);
  // Anything after the repository name (a query, a trailing path) is not part of it.
  const repo = trimSlashes(url.pathname.slice(at + GIT_SEGMENT.length)).split("/")[0] ?? "";

  const segments = trimSlashes(before)
    .split("/")
    .filter((segment) => segment.length > 0);
  const project = segments[segments.length - 1] ?? "";
  if (repo.length === 0 || project.length === 0) return { ok: false, problem: "missing-parts" };

  // The organization is everything above the project: `dev.azure.com/{org}`, a legacy
  // `{org}.visualstudio.com`, or an on-premises `{host}/tfs/{collection}`. Keeping whatever is
  // there, rather than assuming two segments, is what makes on-premises servers work.
  const orgPath = segments.slice(0, -1).join("/");
  const organizationUrl = `${url.protocol}//${url.host}${orgPath.length > 0 ? `/${orgPath}` : ""}`;

  return {
    ok: true,
    target: {
      remoteUrl: remoteUrlOf(url),
      organizationUrl,
      project: decodeSegment(project),
      wikiName: decodeSegment(stripGitSuffix(repo)),
    },
  };
}

/**
 * The URL to store as `origin`, with any password removed.
 *
 * A pasted URL can carry a personal access token as `https://anything:{pat}@dev.azure.com/…`,
 * and `git remote add` would write it into `.git/config` in clear text, where it outlives the
 * token's usefulness and gets shared by anyone who copies the folder. The user name is kept:
 * Azure DevOps puts the organization there and Git Credential Manager uses it to pick an account.
 */
function remoteUrlOf(url: URL): string {
  const clean = new URL(url.toString());
  clean.password = "";
  clean.search = "";
  clean.hash = "";
  return clean.toString();
}

function stripGitSuffix(repo: string): string {
  return repo.endsWith(".git") ? repo.slice(0, -".git".length) : repo;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

/** A project or repository name may be percent-encoded (`AX%20BIS`); show it as it reads. */
function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// --------------------------------------------------------------- may we set this vault up?

export interface CloneEligibilityFacts {
  /** False when git is missing or unusable — nothing here can work without it. */
  gitAvailable: boolean;
  /** Whether git considers the vault to be in a repository *at all* (it searches upwards). */
  isRepo: boolean;
  /** Whether the vault is that repository's root. Only meaningful when `isRepo`. */
  atRepoRoot: boolean;
  /** Markdown files already in the vault, which a checkout must not be allowed to collide with. */
  markdownFileCount: number;
}

export type CloneBlocker =
  | "no-git"
  /** Already a wiki clone: there is nothing to set up, and re-initialising would be destructive. */
  | "already-a-clone"
  /** The vault is a folder inside someone else's repository — `git init` would nest a repository. */
  | "inside-another-repo"
  /** Someone's notes are already here; a checkout could overwrite them. */
  | "vault-not-empty";

/**
 * Whether the plugin may set this vault up, or null when it may.
 *
 * Deliberately conservative: every branch here is a refusal to run `git init` somewhere it would
 * do harm. `inside-another-repo` is the one measured in anger — git searches upwards, so a vault
 * created inside an unrelated checkout looks like a healthy repository, and initialising one there
 * nests a repository that the outer one commits as a gitlink (CLAUDE.md).
 */
export function cloneBlocker(facts: CloneEligibilityFacts): CloneBlocker | null {
  if (!facts.gitAvailable) return "no-git";
  if (facts.isRepo) return facts.atRepoRoot ? "already-a-clone" : "inside-another-repo";
  if (facts.markdownFileCount > 0) return "vault-not-empty";
  return null;
}
