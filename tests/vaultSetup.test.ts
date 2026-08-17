import { describe, expect, it } from "vitest";
import {
  checkVault,
  cloudServiceOf,
  gitignoreAddition,
  ignoresObsidianConfig,
  type VaultFacts,
} from "../src/setup/vaultSetup";

const healthy: VaultFacts = {
  vaultPath: "C:/wikis/Product-Engineering.wiki",
  isRepo: true,
  repoRoot: "C:/wikis/Product-Engineering.wiki",
  gitignore: ".obsidian/\n",
  useWikilinks: false,
  newLinkFormat: "absolute",
  detectAllExtensions: false,
  livePreview: true,
  autocrlf: "input",
};

const idsOf = (facts: Partial<VaultFacts>): string[] =>
  checkVault({ ...healthy, ...facts }).map((issue) => issue.id);

describe("checkVault", () => {
  it("says nothing about a correctly set-up vault", () => {
    expect(checkVault(healthy)).toEqual([]);
  });

  it("reports a vault that is not a git clone", () => {
    expect(idsOf({ isRepo: false, repoRoot: null })).toContain("not-a-repo");
  });

  it("reports a vault opened below the repository root", () => {
    expect(idsOf({ repoRoot: "C:/wikis/Product-Engineering.wiki/.." })).toContain("not-repo-root");
  });

  it("accepts a repo root that differs only in slashes and case", () => {
    expect(idsOf({ repoRoot: "c:\\wikis\\Product-Engineering.wiki\\" })).toEqual([]);
  });

  it("warns about a clone inside a file-syncing folder", () => {
    const issues = checkVault({
      ...healthy,
      vaultPath: "C:/Users/x/OneDrive - STAEDEAN/wikis/Product-Engineering.wiki",
    });
    expect(issues.map((issue) => issue.id)).toContain("cloud-folder");
    // Nothing the plugin can do — moving the clone is the user's job.
    expect(issues.find((issue) => issue.id === "cloud-folder")?.fixLabel).toBeUndefined();
  });

  it("reports the Obsidian options that fight the format", () => {
    expect(
      idsOf({ useWikilinks: true, newLinkFormat: "shortest", detectAllExtensions: true }),
    ).toEqual(["wikilinks", "link-format", "detect-extensions"]);
  });

  it("reports Source mode, where nothing renders while editing", () => {
    const issues = checkVault({ ...healthy, livePreview: false });
    expect(issues.map((issue) => issue.id)).toEqual(["source-mode"]);
    // The plugin can turn Live Preview on, so this one carries a fix.
    expect(issues[0].fixLabel).toBeDefined();
  });

  it("does not ask about .gitignore when the vault is not a repository", () => {
    expect(idsOf({ isRepo: false, repoRoot: null, gitignore: null })).not.toContain("gitignore");
  });

  /**
   * The default Git for Windows setting, and the cause of the "unpublished" marks appearing on
   * pages nobody had edited: git writes CRLF, Obsidian writes LF, git calls the page modified for
   * ever. `input` and `false` leave the bytes alone, and a vault with no git has nothing to say.
   */
  it("reports line-ending conversion, and only when it is actually on", () => {
    const issues = checkVault({ ...healthy, autocrlf: "true" });
    expect(issues.map((issue) => issue.id)).toEqual(["line-endings"]);
    expect(issues[0].fixLabel).toBeDefined();

    for (const autocrlf of ["input", "false", null]) {
      expect(idsOf({ autocrlf })).not.toContain("line-endings");
    }
    expect(idsOf({ isRepo: false, repoRoot: null, autocrlf: "true" })).not.toContain("line-endings");
  });
});

describe("ignoresObsidianConfig", () => {
  it.each([".obsidian/", ".obsidian", "  .obsidian/  ", "/.obsidian/"])("accepts %j", (line) => {
    expect(ignoresObsidianConfig(`# comment\n${line}\nnode_modules/`)).toBe(true);
  });

  it.each([null, "", "node_modules/", ".obsidian/workspace.json"])("rejects %j", (content) => {
    expect(ignoresObsidianConfig(content)).toBe(false);
  });
});

describe("gitignoreAddition", () => {
  it("creates the whole block for a vault with no .gitignore", () => {
    expect(gitignoreAddition(null)).toBe(".obsidian/\n.trash/\n.DS_Store\n");
  });

  it("appends only what is missing, and keeps the existing content intact", () => {
    const addition = gitignoreAddition("node_modules/\n.trash/\n");
    expect(addition).toContain(".obsidian/");
    expect(addition).toContain(".DS_Store");
    expect(addition).not.toContain(".trash/");
  });

  it("adds the newline a file without a trailing one needs", () => {
    expect(gitignoreAddition("node_modules/")).toMatch(/^\n/);
  });

  it("asks for nothing when everything is already there", () => {
    expect(gitignoreAddition(".obsidian/\n.trash/\n.DS_Store\n")).toBe("");
  });
});

describe("cloudServiceOf", () => {
  it.each([
    ["C:/Users/x/OneDrive/wiki", "OneDrive"],
    ["C:\\Users\\x\\OneDrive - STAEDEAN\\wiki", "OneDrive"],
    ["/Users/x/Dropbox/wiki", "Dropbox"],
    ["/Users/x/Google Drive/wiki", "Google Drive"],
  ])("detects %s", (path, service) => {
    expect(cloudServiceOf(path)).toBe(service);
  });

  it("leaves an ordinary folder alone", () => {
    expect(cloudServiceOf("C:/wikis/Product-Engineering.wiki")).toBeNull();
    // 'OneDriveTools' is not OneDrive.
    expect(cloudServiceOf("C:/OneDriveTools/wiki")).toBeNull();
  });
});
