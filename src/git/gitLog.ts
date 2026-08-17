/**
 * Reading `git log` for the "what changed lately" sidebar (FR-7.8, partial).  [PURE]
 *
 * A functional user's question is "what did other people change, and can I open it" — which is
 * history, not a diff. The format below is built for parsing rather than for reading: record and
 * unit separators (`\x1e`, `\x1f`) can never occur in a commit subject, an author name or a page
 * path, so nothing a person can type can shift a field. Wiki page names contain almost every
 * punctuation mark there is (ADO-WIKI-FORMAT §2), which rules out the usual `|` or `\t` delimiter.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */

/** `--pretty=format:` argument matching {@link parseLog}. */
export const LOG_FORMAT = "%x1e%H%x1f%an%x1f%aI%x1f%s";

export interface WikiCommit {
  sha: string;
  /** Short form for display; git accepts it wherever the full sha is accepted. */
  shortSha: string;
  author: string;
  /** Author date, ISO-8601, as git printed it. Null when it could not be parsed. */
  timestamp: number | null;
  subject: string;
  /** Repo-relative paths the commit touched, in git's order. Empty for a merge. */
  files: string[];
}

/**
 * Parse the output of
 * `git log --name-only --pretty=format:<LOG_FORMAT>`.
 *
 * Anything that does not match the expected shape is skipped rather than guessed at: a history
 * pane that silently shows one commit fewer is better than one that shows a wrong author.
 */
export function parseLog(stdout: string): WikiCommit[] {
  const commits: WikiCommit[] = [];

  for (const record of stdout.split("\x1e")) {
    if (record.trim().length === 0) continue;

    const lines = record.split(/\r?\n/);
    const fields = (lines.shift() ?? "").split("\x1f");
    if (fields.length < 4) continue;

    const [sha, author, date, ...subjectParts] = fields;
    if (!/^[0-9a-f]{7,40}$/.test(sha)) continue;

    commits.push({
      sha,
      shortSha: sha.slice(0, 8),
      author: author.trim(),
      timestamp: parseTimestamp(date),
      // A subject containing our own separator would be extraordinary; join it back anyway.
      subject: subjectParts.join("\x1f").trim(),
      files: lines.map((line) => line.trim()).filter((line) => line.length > 0),
    });
  }

  return commits;
}

function parseTimestamp(date: string): number | null {
  const parsed = Date.parse(date.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/** The pages a commit touched — attachments and `.order` files are not somewhere to navigate. */
export function pagesOf(commit: WikiCommit): string[] {
  return commit.files.filter((file) => file.toLowerCase().endsWith(".md"));
}
