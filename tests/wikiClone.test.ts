import { describe, expect, it } from "vitest";
import { chooseCloneBranch } from "../src/git/wikiBranch";
import { cloneBlocker, parseWikiCloneUrl, type CloneEligibilityFacts } from "../src/setup/wikiClone";

/** Unwraps a parse that is expected to succeed, so a failure reports usefully. */
function target(input: string) {
  const result = parseWikiCloneUrl(input);
  if (!result.ok) throw new Error(`expected ${input} to parse, got problem "${result.problem}"`);
  return result.target;
}

function problem(input: string) {
  const result = parseWikiCloneUrl(input);
  if (result.ok) throw new Error(`expected ${input} to be rejected, got ${result.target.remoteUrl}`);
  return result.problem;
}

describe("parseWikiCloneUrl", () => {
  it("reads the exact URL the portal's Clone wiki button gives", () => {
    // Azure DevOps puts the organization in the user-info position; that is not a mistake to fix.
    const t = target("https://contoso@dev.azure.com/contoso/MyProject/_git/MyProject.wiki");

    expect(t.organizationUrl).toBe("https://dev.azure.com/contoso");
    expect(t.project).toBe("MyProject");
    expect(t.wikiName).toBe("MyProject.wiki");
    // The user name is kept so Git Credential Manager can pick the right account.
    expect(t.remoteUrl).toBe("https://contoso@dev.azure.com/contoso/MyProject/_git/MyProject.wiki");
  });

  it("works without the user-info prefix", () => {
    const t = target("https://dev.azure.com/contoso/MyProject/_git/MyProject.wiki");
    expect(t.organizationUrl).toBe("https://dev.azure.com/contoso");
    expect(t.project).toBe("MyProject");
  });

  it("decodes a project name with a space, but keeps the URL encoded for git", () => {
    // 'AX BIS' is the shape that breaks hand-assembled URLs, which is why the user pastes one.
    const t = target("https://dev.azure.com/contoso/AX%20BIS/_git/AX%20BIS.wiki");

    expect(t.project).toBe("AX BIS");
    expect(t.wikiName).toBe("AX BIS.wiki");
    expect(t.remoteUrl).toContain("AX%20BIS.wiki");
    expect(t.remoteUrl).not.toContain("AX BIS");
  });

  it("tolerates literal spaces, because that is what a careless copy produces", () => {
    const t = target("https://dev.azure.com/contoso/AX BIS/_git/AX BIS.wiki");
    expect(t.project).toBe("AX BIS");
    expect(t.remoteUrl).toContain("AX%20BIS");
  });

  it("handles a legacy visualstudio.com URL, where the organization is the host", () => {
    const t = target("https://contoso.visualstudio.com/MyProject/_git/MyProject.wiki");
    expect(t.organizationUrl).toBe("https://contoso.visualstudio.com");
    expect(t.project).toBe("MyProject");
  });

  it("handles an on-premises collection path", () => {
    // Keeping every segment above the project, rather than assuming two, is what makes this work.
    const t = target("https://tfs.example.local/tfs/DefaultCollection/MyProject/_git/MyProject.wiki");
    expect(t.organizationUrl).toBe("https://tfs.example.local/tfs/DefaultCollection");
    expect(t.project).toBe("MyProject");
  });

  it("strips a password, which is how a personal access token arrives", () => {
    // `git remote add` would write this into .git/config in clear text, for as long as the folder
    // exists and for anyone who copies it.
    const t = target("https://anything:abc123token@dev.azure.com/contoso/MyProject/_git/MyProject.wiki");

    expect(t.remoteUrl).not.toContain("abc123token");
    expect(t.remoteUrl).toBe("https://anything@dev.azure.com/contoso/MyProject/_git/MyProject.wiki");
  });

  it("drops a query string and fragment", () => {
    const t = target("https://dev.azure.com/contoso/MyProject/_git/MyProject.wiki?version=GBwikiMain");
    expect(t.remoteUrl).toBe("https://dev.azure.com/contoso/MyProject/_git/MyProject.wiki");
  });

  it("tolerates a .git suffix on the repository name", () => {
    expect(target("https://dev.azure.com/contoso/P/_git/P.wiki.git").wikiName).toBe("P.wiki");
  });

  it("names the likeliest mistake: the wiki's own address bar", () => {
    // Reading a wiki and copying the URL gives this, and it cannot be cloned.
    expect(problem("https://dev.azure.com/contoso/MyProject/_wiki/wikis/MyProject.wiki")).toBe(
      "portal-page-url",
    );
    expect(
      problem("https://dev.azure.com/contoso/MyProject/_wiki/wikis/MyProject.wiki/12/Home"),
    ).toBe("portal-page-url");
  });

  it("names the SSH form rather than calling it malformed", () => {
    // Offered right beside HTTPS in the same dialog, but needs a key pair this audience lacks.
    expect(problem("git@ssh.dev.azure.com:v3/contoso/MyProject/MyProject.wiki")).toBe("ssh");
    expect(problem("ssh://contoso@vs-ssh.visualstudio.com:22/MyProject/_ssh/MyProject.wiki")).toBe("ssh");
  });

  it("rejects what is not a clone URL", () => {
    expect(problem("")).toBe("empty");
    expect(problem("   ")).toBe("empty");
    expect(problem("MyProject.wiki")).toBe("not-a-url");
    expect(problem("file:///C:/wikis/MyProject.wiki")).toBe("not-a-url");
    // A repository URL with no _git segment is some other page of the portal.
    expect(problem("https://dev.azure.com/contoso/MyProject")).toBe("not-a-git-url");
    // _git present but nothing after it.
    expect(problem("https://dev.azure.com/contoso/MyProject/_git/")).toBe("missing-parts");
  });
});

describe("chooseCloneBranch", () => {
  it("prefers what the server says HEAD points at", () => {
    expect(chooseCloneBranch("wikiMaster", ["wikiMain", "wikiMaster"])).toBe("wikiMaster");
  });

  it("trusts a symref even when no head list came back", () => {
    expect(chooseCloneBranch("wikiMain", [])).toBe("wikiMain");
  });

  it("takes the only branch there is", () => {
    // Measured: `ls-remote --symref` can answer nothing, so this is the common fallback.
    expect(chooseCloneBranch(null, ["wikiMaster"])).toBe("wikiMaster");
  });

  it("falls back to the names Azure DevOps gives a provisioned wiki", () => {
    expect(chooseCloneBranch(null, ["main", "wikiMain"])).toBe("wikiMain");
    expect(chooseCloneBranch(null, ["develop", "wikiMaster"])).toBe("wikiMaster");
    expect(chooseCloneBranch(null, ["wikiMain", "wikiMaster"])).toBe("wikiMain");
  });

  it("refuses to guess between unrelated branches", () => {
    // A "publish code as wiki" repository can look like any repository; picking one at random
    // would check out the wrong content and publish to it later.
    expect(chooseCloneBranch(null, ["main", "develop", "docs"])).toBeNull();
    expect(chooseCloneBranch(null, [])).toBeNull();
  });

  it("ignores a symref naming a branch the server did not offer", () => {
    expect(chooseCloneBranch("gone", ["wikiMain"])).toBe("wikiMain");
  });
});

describe("cloneBlocker", () => {
  const empty: CloneEligibilityFacts = {
    gitAvailable: true,
    isRepo: false,
    atRepoRoot: false,
    markdownFileCount: 0,
  };

  it("allows a fresh, empty vault", () => {
    expect(cloneBlocker(empty)).toBeNull();
  });

  it("needs git", () => {
    expect(cloneBlocker({ ...empty, gitAvailable: false })).toBe("no-git");
  });

  it("leaves an existing clone alone", () => {
    expect(cloneBlocker({ ...empty, isRepo: true, atRepoRoot: true })).toBe("already-a-clone");
  });

  it("refuses a vault sitting inside another repository", () => {
    // `git init` here would nest a repository, which the outer one commits as a gitlink.
    expect(cloneBlocker({ ...empty, isRepo: true, atRepoRoot: false })).toBe("inside-another-repo");
  });

  it("refuses to check out over someone's notes", () => {
    expect(cloneBlocker({ ...empty, markdownFileCount: 3 })).toBe("vault-not-empty");
  });

  it("reports the missing tool before anything else", () => {
    // Nothing else can be established without git, so its absence must win.
    expect(cloneBlocker({ gitAvailable: false, isRepo: true, atRepoRoot: false, markdownFileCount: 9 })).toBe(
      "no-git",
    );
  });
});
