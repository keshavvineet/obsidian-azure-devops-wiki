import { describe, expect, it } from "vitest";
import {
  countPages,
  DEFAULT_COMMIT_TEMPLATE,
  formatCommitMessage,
  formatTimestamp,
  summarizeChanges,
} from "../src/git/commitMessage";

const DATE = new Date(2026, 7, 7, 14, 3); // local time on purpose — history is read locally

describe("summarizeChanges", () => {
  it("names pages by their decoded title, not their file name", () => {
    expect(summarizeChanges(["Pre%2DRelease-RCA-Categories.md"])).toBe(
      "Pre-Release RCA Categories",
    );
  });

  it("uses the page's own name, not its whole path", () => {
    expect(summarizeChanges(["Product-Documentation/1.-Setup.md"])).toBe("1. Setup");
  });

  it("lists up to three pages and counts the rest", () => {
    expect(summarizeChanges(["A.md", "B.md", "C.md"])).toBe("A, B, C");
    expect(summarizeChanges(["A.md", "B.md", "C.md", "D.md", "E.md"])).toBe(
      "A, B, C and 2 more pages",
    );
  });

  it("counts attachments and other files separately", () => {
    expect(summarizeChanges([".attachments/image.png", ".attachments/b.png"])).toBe(
      "2 attachments",
    );
    expect(summarizeChanges(["Home.md", ".attachments/image.png", ".order"])).toBe(
      "Home, 1 attachment and 1 file",
    );
  });
});

describe("formatCommitMessage", () => {
  it("fills every placeholder", () => {
    const message = formatCommitMessage("{user} edited {files} on {date}", {
      paths: ["Home.md"],
      user: "Alex Green",
      date: DATE,
    });

    expect(message).toBe("Alex Green edited Home on 2026-08-07 14:03");
  });

  it("reads well when git has no configured user name", () => {
    const message = formatCommitMessage("wiki: {files} edited by {user} ({date})", {
      paths: ["Home.md"],
      user: "",
      date: DATE,
    });

    expect(message).toBe("wiki: Home edited (2026-08-07 14:03)");
  });

  it("falls back to the default template when the setting is blank", () => {
    const message = formatCommitMessage("   ", { paths: ["Home.md"], user: "x", date: DATE });

    expect(message).toBe("wiki: edited Home (2026-08-07 14:03)");
    expect(DEFAULT_COMMIT_TEMPLATE).toContain("{files}");
  });

  it("leaves unknown placeholders alone rather than guessing", () => {
    const message = formatCommitMessage("wiki: {branch} {files}", {
      paths: ["Home.md"],
      user: "",
      date: DATE,
    });

    expect(message).toBe("wiki: {branch} Home");
  });

  it("never produces an empty commit message", () => {
    expect(formatCommitMessage("{user}", { paths: ["Home.md"], user: "", date: DATE })).toBe(
      "Home",
    );
  });
});

describe("formatTimestamp", () => {
  it("pads to a sortable local timestamp", () => {
    expect(formatTimestamp(new Date(2026, 0, 5, 9, 7))).toBe("2026-01-05 09:07");
  });
});

describe("countPages", () => {
  it("counts markdown pages only", () => {
    expect(countPages(["Home.md", ".attachments/x.png", "Docs/Setup.md", ".order"])).toBe(2);
  });
});
