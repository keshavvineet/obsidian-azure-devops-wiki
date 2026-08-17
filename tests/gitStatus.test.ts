import { describe, expect, it } from "vitest";
import {
  conflictedPaths,
  describeStatus,
  dirtyCount,
  formatRelativeTime,
  parseStatus,
  withoutUnchangedFiles,
} from "../src/git/gitStatus";

/** Real `git status --porcelain=v2 --branch` output, trimmed to the interesting lines. */
const SAMPLE = [
  "# branch.oid 6f1c0d2a8b",
  "# branch.head wikiMain",
  "# branch.upstream origin/wikiMain",
  "# branch.ab +2 -3",
  "1 .M N... 100644 100644 100644 aaa bbb Home.md",
  "1 A. N... 000000 100644 100644 000 ccc Product-Documentation/New-Page.md",
  "1 .D N... 100644 100644 000000 ddd eee Old-Page.md",
  "2 R. N... 100644 100644 100644 fff ggg R100 Renamed-Page.md\tOld-Name.md",
  "u UU N... 100644 100644 100644 100644 hhh iii jjj Release-Notes.md",
  "? untracked-note.md",
  "! .obsidian/workspace.json",
].join("\n");

describe("parseStatus", () => {
  it("reads branch, upstream and ahead/behind counts", () => {
    const status = parseStatus(SAMPLE);

    expect(status.branch).toBe("wikiMain");
    expect(status.detached).toBe(false);
    expect(status.upstream).toBe("origin/wikiMain");
    expect(status.ahead).toBe(2);
    expect(status.behind).toBe(3);
  });

  it("classifies every kind of change, and ignores ignored files", () => {
    const status = parseStatus(SAMPLE);

    expect(status.files).toEqual([
      { path: "Home.md", kind: "modified", staged: false },
      { path: "Product-Documentation/New-Page.md", kind: "added", staged: true },
      { path: "Old-Page.md", kind: "deleted", staged: false },
      { path: "Renamed-Page.md", kind: "renamed", staged: true },
      { path: "Release-Notes.md", kind: "conflicted", staged: false },
      { path: "untracked-note.md", kind: "untracked", staged: false },
    ]);
    expect(conflictedPaths(status)).toEqual(["Release-Notes.md"]);
    // The conflicted file is a decision, not a local edit — it is counted separately.
    expect(dirtyCount(status)).toBe(5);
  });

  it("keeps page names with spaces and encoded characters intact", () => {
    // ADO file names carry '%2D' and unicode; core.quotepath=false keeps them literal.
    const status = parseStatus(
      "1 .M N... 100644 100644 100644 aaa bbb Pre%2DRelease RCA — Categories.md",
    );

    expect(status.files[0].path).toBe("Pre%2DRelease RCA — Categories.md");
  });

  it("unquotes the paths git escapes", () => {
    const status = parseStatus('? "tab\\there.md"');

    expect(status.files[0].path).toBe("tab\there.md");
  });

  it("reports a detached head and a branch with no upstream", () => {
    const status = parseStatus(["# branch.oid abc", "# branch.head (detached)"].join("\n"));

    expect(status.detached).toBe(true);
    expect(status.branch).toBeNull();
    expect(status.upstream).toBeNull();
    expect(status.ahead).toBe(0);
  });

  it("does not count Obsidian's own config as unsynced wiki work", () => {
    // The sync never stages .obsidian/, so counting it would badge the status bar forever.
    const status = parseStatus(["? .obsidian/", "? Draft.md"].join("\n"));

    expect(dirtyCount(status)).toBe(1);
  });

  it("does count .obsidian when the repository tracks it", () => {
    // Someone deliberately committed it — then it is the repo's content, not our noise.
    const status = parseStatus("1 .M N... 100644 100644 100644 aaa bbb .obsidian/app.json");

    expect(dirtyCount(status)).toBe(1);
  });

  it("returns an empty status for a clean repository", () => {
    const status = parseStatus(
      ["# branch.oid abc", "# branch.head wikiMain", "# branch.ab +0 -0"].join("\n"),
    );

    expect(status.files).toEqual([]);
    expect(dirtyCount(status)).toBe(0);
  });
});

describe("describeStatus", () => {
  const now = 1_700_000_000_000;

  it("shows branch, incoming, outgoing and dirty counts", () => {
    const display = describeStatus(parseStatus(SAMPLE), { lastRefresh: now - 120_000, now });

    expect(display.text).toBe("Wiki wikiMain ↓3 ↑2 ●5 ⚠1");
    expect(display.tooltip).toContain("Branch: wikiMain");
    expect(display.tooltip).toContain("5 local changes not yet synced");
    expect(display.tooltip).toContain("3 updates waiting in Azure DevOps");
    expect(display.tooltip).toContain("Last checked 2 min ago");
  });

  it("shows only the branch when everything is in step", () => {
    const clean = parseStatus(["# branch.head wikiMain", "# branch.ab +0 -0"].join("\n"));

    expect(describeStatus(clean, { lastRefresh: null, now }).text).toBe("Wiki wikiMain");
    expect(describeStatus(clean, { lastRefresh: null, now }).tooltip).toContain(
      "No unsaved changes",
    );
  });

  it("says so when there is no repository at all", () => {
    expect(describeStatus(null, { lastRefresh: null, now }).text).toBe("Wiki: no repository");
  });

  it("reports the running flow instead of a stale count", () => {
    const display = describeStatus(parseStatus(SAMPLE), {
      lastRefresh: null,
      now,
      busy: "syncing…",
    });

    expect(display.text).toBe("Wiki syncing…");
  });
});

/**
 * The bug this closes: on Windows `git status` reports a page as modified whenever git checked it
 * out with CRLF and Obsidian saved it back with LF, even though `git diff` — and Azure DevOps —
 * see no difference. Marking those pages as unpublished is what made the marks look random.
 */
describe("withoutUnchangedFiles", () => {
  const status = parseStatus(SAMPLE);
  const pathsOf = (value: GitStatusLike): string[] => value.files.map((file) => file.path);
  type GitStatusLike = ReturnType<typeof parseStatus>;

  it("drops a page whose content git diff does not report", () => {
    const filtered = withoutUnchangedFiles(status, new Set(["Old-Page.md"]));

    expect(pathsOf(filtered)).not.toContain("Home.md");
    expect(pathsOf(filtered)).toContain("Old-Page.md");
  });

  it("keeps what is not a content comparison at all", () => {
    const filtered = withoutUnchangedFiles(status, new Set());

    // Untracked has no committed version, a rename can be identical, a conflict is never noise.
    expect(pathsOf(filtered)).toEqual([
      "Renamed-Page.md",
      "Release-Notes.md",
      "untracked-note.md",
    ]);
  });

  it("hides nothing when git could not answer", () => {
    expect(withoutUnchangedFiles(status, null)).toBe(status);
  });

  it("leaves the branch and ahead/behind counts alone", () => {
    const filtered = withoutUnchangedFiles(status, new Set());

    expect(filtered.branch).toBe("wikiMain");
    expect([filtered.ahead, filtered.behind]).toEqual([2, 3]);
  });
});

describe("formatRelativeTime", () => {
  const now = 1_700_000_000_000;

  it("rounds to something a human would say", () => {
    expect(formatRelativeTime(now - 5_000, now)).toBe("just now");
    expect(formatRelativeTime(now - 90_000, now)).toBe("2 min ago");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(formatRelativeTime(now - 50 * 3_600_000, now)).toBe("2 d ago");
  });

  it("never reports the future as a negative age", () => {
    expect(formatRelativeTime(now + 10_000, now)).toBe("just now");
  });
});
