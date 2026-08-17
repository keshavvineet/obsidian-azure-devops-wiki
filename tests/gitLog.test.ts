import { describe, expect, it } from "vitest";
import { LOG_FORMAT, pagesOf, parseLog } from "../src/git/gitLog";

/** Builds the exact bytes `git log --name-only --pretty=format:LOG_FORMAT` produces. */
const record = (
  sha: string,
  author: string,
  date: string,
  subject: string,
  files: string[],
): string => `\x1e${sha}\x1f${author}\x1f${date}\x1f${subject}\n${files.join("\n")}\n`;

const SHA_A = "3fa85f6457174562b3fc2c963f66afa6b5e0e1c2";
const SHA_B = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

describe("parseLog", () => {
  it("reads a commit and the files it touched", () => {
    const commits = parseLog(
      record(SHA_A, "Ada Lovelace", "2026-08-10T09:15:00+02:00", "Update the EDI group page", [
        "Product-Documentation/7.2.1-EDI-group%3A-party.md",
        ".attachments/image-1.png",
      ]),
    );

    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      sha: SHA_A,
      shortSha: "3fa85f64",
      author: "Ada Lovelace",
      subject: "Update the EDI group page",
    });
    expect(commits[0].timestamp).toBe(Date.parse("2026-08-10T09:15:00+02:00"));
    expect(commits[0].files).toHaveLength(2);
  });

  it("reads several commits in the order git printed them", () => {
    const commits = parseLog(
      record(SHA_A, "Ada", "2026-08-10T09:00:00Z", "Newest", ["A.md"]) +
        record(SHA_B, "Grace", "2026-08-09T09:00:00Z", "Older", ["B.md"]),
    );
    expect(commits.map((commit) => commit.subject)).toEqual(["Newest", "Older"]);
  });

  it("keeps a page name that contains every kind of punctuation intact", () => {
    const name = "7.2.1-EDI-group%3A-party-defaults,-member-list-and-generate.md";
    const commits = parseLog(record(SHA_A, "Ada", "2026-08-10T09:00:00Z", "Edit", [name]));
    expect(commits[0].files).toEqual([name]);
  });

  it("survives a commit subject containing pipes, tabs and quotes", () => {
    const subject = 'fix | the "table" \t rows';
    const commits = parseLog(record(SHA_A, "Ada", "2026-08-10T09:00:00Z", subject, ["A.md"]));
    expect(commits[0].subject).toBe(subject.trim());
  });

  it("handles a merge commit, which lists no files", () => {
    const commits = parseLog(`\x1e${SHA_A}\x1fAda\x1f2026-08-10T09:00:00Z\x1fMerge branch\n`);
    expect(commits[0].files).toEqual([]);
  });

  it("returns nothing for empty output", () => {
    expect(parseLog("")).toEqual([]);
    expect(parseLog("\n\n")).toEqual([]);
  });

  it("skips a record that is not shaped like a commit", () => {
    expect(parseLog("\x1enot-a-sha\x1fAda\x1f2026-08-10T09:00:00Z\x1fSubject\n")).toEqual([]);
    expect(parseLog(`\x1e${SHA_A}\x1fAda\n`)).toEqual([]);
  });

  it("reports an unparseable date as null rather than as NaN", () => {
    const commits = parseLog(record(SHA_A, "Ada", "not a date", "Edit", ["A.md"]));
    expect(commits[0].timestamp).toBeNull();
  });

  it("declares the format string it parses", () => {
    expect(LOG_FORMAT).toBe("%x1e%H%x1f%an%x1f%aI%x1f%s");
  });
});

describe("pagesOf", () => {
  it("keeps pages and drops attachments and .order files", () => {
    const commits = parseLog(
      record(SHA_A, "Ada", "2026-08-10T09:00:00Z", "Edit", [
        "Home.md",
        "Product-Documentation/.order",
        ".attachments/image-1.png",
        "Deep/Page.MD",
      ]),
    );
    expect(pagesOf(commits[0])).toEqual(["Home.md", "Deep/Page.MD"]);
  });
});
