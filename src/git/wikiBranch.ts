import type { GitStatus } from "./gitStatus";

/**
 * Working out which branch a wiki clone lives on, so the user never has to (FR-7.7).  [PURE]
 *
 * Azure DevOps does not tell anyone the branch of a provisioned wiki: the Wiki hub never shows
 * it, and the portal's *Clone wiki* dialog hands out a URL with no branch name. Finding it means
 * knowing to open the hidden `{project}.wiki` repository by direct URL — so making the user
 * supply it is asking for something the product does not show them (ADO-WIKI-FORMAT §5).
 *
 * Git already knows. `git clone` checks out whatever the server calls the default branch, which
 * for a provisioned wiki *is* the wiki branch, and for a "publish code as wiki" repository is the
 * branch the clone was taken from. So the branch the clone is sitting on is the answer, and the
 * plugin adopts it rather than asking.
 *
 * Two rules stop that from adopting something wrong:
 *
 *   - **A branch must track an upstream.** That is what distinguishes a branch the server gave us
 *     from a scratch branch somebody made locally, so a clone parked on an experiment is left
 *     alone and still gets the "you are on the wrong branch" guard rail.
 *   - **A branch the user chose themselves is never overridden** — adoption only fills in a
 *     setting still sitting at its factory default.
 */
/**
 * Which branch to check out when setting a vault up from a clone URL, or null when the server's
 * answer is too ambiguous to guess from.
 *
 * A fresh `git init` has no `origin/HEAD`, so the server has to be asked. `ls-remote --symref`
 * answers directly and is preferred; measured against a local stand-in it can come back empty, so
 * the ladder falls through to the branch list: one branch is unambiguous, and beyond that only
 * the two names Azure DevOps gives a provisioned wiki are safe to assume.
 */
export function chooseCloneBranch(symrefBranch: string | null, heads: readonly string[]): string | null {
  if (symrefBranch !== null && heads.includes(symrefBranch)) return symrefBranch;
  // Trust a symref even for a repository that offered no head list, since it is the server's own
  // statement about where HEAD points.
  if (symrefBranch !== null && heads.length === 0) return symrefBranch;
  if (heads.length === 1) return heads[0] ?? null;
  for (const candidate of ["wikiMain", "wikiMaster"]) {
    if (heads.includes(candidate)) return candidate;
  }
  return null;
}

export function branchToAdopt(
  status: GitStatus,
  configuredBranch: string,
  factoryDefault: string,
): string | null {
  // The user has named a branch; it is not ours to second-guess.
  if (configuredBranch !== factoryDefault) return null;

  // A detached HEAD is not a branch, and syncing needs one — `syncOrchestrator` says so in
  // words the user can act on, which is more use than silently adopting nothing.
  if (status.detached || status.branch === null) return null;

  // No upstream means nothing on the server corresponds to this branch, so it cannot be the
  // wiki's branch — it is a local scratch branch.
  if (status.upstream === null) return null;

  // Already correct: writing the setting would only dirty `data.json` on every start-up.
  if (status.branch === configuredBranch) return null;

  return status.branch;
}
