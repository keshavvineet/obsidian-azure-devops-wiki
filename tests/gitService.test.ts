import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitService } from "../src/git/gitService";
import { createWikiFixture, gitAvailable, WIKI_BRANCH, WikiFixture } from "./helpers/tempRepo";

/**
 * gitService against real repositories (ARCHITECTURE §8). Nothing here is mocked: the value
 * of these tests is that they would catch a wrong flag or a misread of git's own behaviour.
 */
describe.skipIf(!gitAvailable())("GitService", () => {
  let fixture: WikiFixture;
  let git: GitService;

  beforeEach(() => {
    fixture = createWikiFixture();
    git = new GitService(fixture.alice);
  });

  afterEach(() => fixture.cleanup());

  it("recognises a repository, and a folder that is not one", async () => {
    expect(await git.isRepo()).toBe(true);
    expect(await git.currentBranch()).toBe(WIKI_BRANCH);
    expect(await git.version()).toMatch(/^git version/);

    const empty = mkdtempSync(join(tmpdir(), "adowiki-plain-"));
    try {
      expect(await new GitService(empty).isRepo()).toBe(false);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("reports local edits, and what the server is ahead by", async () => {
    fixture.write(fixture.alice, "Home.md", "# Home\n\nEdited locally.\n");
    fixture.publish(fixture.bob, "Release-Notes.md", "# Release Notes\n", "add release notes");

    const before = await git.status();
    expect(before.branch).toBe(WIKI_BRANCH);
    expect(before.upstream).toBe(`origin/${WIKI_BRANCH}`);
    expect(before.files.map((file) => file.path)).toEqual(["Home.md"]);
    // Ahead/behind is only as fresh as the last fetch — before it, we know nothing.
    expect(before.behind).toBe(0);

    expect((await git.fetch()).ok).toBe(true);
    expect((await git.status()).behind).toBe(1);
  });

  it("reports every page inside a brand-new folder, not the folder", async () => {
    // git collapses an untracked directory into one `dir/` entry unless `-uall` is passed. That
    // entry matches no page's vault path, so the explorer marked none of them as unpublished and
    // — worse — the publish gate, which filters status entries by `.md` before checking their
    // names, never saw them: a folder and page full of literal spaces reached the portal, where
    // they cannot be opened or repaired. Reproduced against a real wiki before this was fixed.
    fixture.write(fixture.alice, "This is a new page/This is a sample page 2.md", "# Sample\n");
    fixture.write(fixture.alice, "This is a new page/.order", "This is a sample page 2\n");

    const paths = (await git.status()).files.map((file) => file.path);
    expect(paths).toContain("This is a new page/This is a sample page 2.md");
    expect(paths).not.toContain("This is a new page/");
  });

  it("stages everything below the vault, including deletions, except Obsidian's config", async () => {
    fixture.write(fixture.alice, "Product-Documentation/New-Page.md", "# New\n");
    fixture.write(fixture.alice, ".attachments/screenshot.png", "not really a png");
    fixture.write(fixture.alice, ".obsidian/workspace.json", '{"main":{}}');
    rmSync(join(fixture.alice, "Home.md"));

    expect((await git.stageAll()).ok).toBe(true);
    expect((await git.stagedFiles()).sort()).toEqual([
      ".attachments/screenshot.png",
      "Home.md",
      "Product-Documentation/New-Page.md",
    ]);
  });

  it("commits and pushes what the user wrote", async () => {
    fixture.write(fixture.alice, "Home.md", "# Home\n\nMine.\n");
    await git.stageAll();

    expect((await git.commit("wiki: edited Home")).ok).toBe(true);
    expect((await git.push()).ok).toBe(true);
    expect(fixture.originContent("Home.md")).toContain("Mine.");
  });

  it("sees no operation in progress on a healthy repo, and a rebase on a stuck one", async () => {
    expect(await git.inProgressState()).toBeNull();

    await startConflictingRebase(fixture, git);

    expect(await git.inProgressState()).toBe("rebase");
    expect((await git.status()).files.filter((f) => f.kind === "conflicted")).toHaveLength(1);

    expect((await git.rebaseAbort()).ok).toBe(true);
    expect(await git.inProgressState()).toBeNull();
  });

  /**
   * The inversion that makes or breaks the conflict modal: inside a rebase, git's `--ours`
   * is the *server's* branch. These two tests are the proof that "keep my version" keeps the
   * user's text and "take server version" keeps the server's.
   */
  it("resolves a conflict to the user's own version", async () => {
    await startConflictingRebase(fixture, git);

    expect(await git.resolveConflict("Home.md", "mine")).toBe(true);
    expect(fixture.read(fixture.alice, "Home.md")).toContain("Alice's line");
    expect(fixture.read(fixture.alice, "Home.md")).not.toContain("Bob's line");

    expect((await git.rebaseContinue()).ok).toBe(true);
    expect(await git.inProgressState()).toBeNull();
  });

  it("resolves a conflict to the server's version", async () => {
    await startConflictingRebase(fixture, git);

    expect(await git.resolveConflict("Home.md", "server")).toBe(true);
    expect(fixture.read(fixture.alice, "Home.md")).toContain("Bob's line");
    expect(fixture.read(fixture.alice, "Home.md")).not.toContain("Alice's line");
  });

  it("accepts a deletion when the chosen side removed the page", async () => {
    // Bob deletes the page; Alice edits it. Taking the server version means it goes.
    fixture.git(fixture.bob, "rm", "-q", "Home.md");
    fixture.commitAll(fixture.bob, "remove Home");
    fixture.git(fixture.bob, "push", "-q");

    fixture.write(fixture.alice, "Home.md", "# Home\n\nAlice's line\n");
    fixture.commitAll(fixture.alice, "edit Home");
    await git.fetch();
    await git.pullRebaseAutostash();

    expect(await git.resolveConflict("Home.md", "server")).toBe(true);
    expect((await git.status()).files.filter((f) => f.kind === "conflicted")).toHaveLength(0);
  });

  it("answers whether the remote can be reached", async () => {
    expect(await git.remoteReachable()).toBe(true);

    fixture.git(fixture.alice, "remote", "set-url", "origin", join(fixture.root, "gone.git"));
    expect(await git.remoteReachable()).toBe(false);
  });

  it("reads the recent history and the pages each commit touched", async () => {
    // A page name with the punctuation a wiki really uses, to prove the log format survives it.
    fixture.publish(
      fixture.bob,
      "Pre%2DRelease-RCA-Categories.md",
      "# Pre-Release RCA Categories\n",
      "add the RCA categories page",
    );
    fixture.write(fixture.alice, ".attachments/shot.png", "not really a png");
    fixture.commitAll(fixture.alice, "attach a screenshot");
    await git.fetch();
    await git.pullRebaseAutostash();

    const commits = await git.recentCommits(5);

    expect(commits.length).toBeGreaterThanOrEqual(3);
    expect(commits.map((commit) => commit.subject)).toEqual([
      "attach a screenshot",
      "add the RCA categories page",
      "initial wiki",
    ]);
    expect(commits[0].files).toEqual([".attachments/shot.png"]);
    expect(commits[1].files).toEqual(["Pre%2DRelease-RCA-Categories.md"]);
    expect(commits[0].author).not.toBe("");
    expect(commits[0].timestamp).not.toBeNull();
  });

  it("honours the commit limit and reports nothing for a repository with no history", async () => {
    expect(await git.recentCommits(1)).toHaveLength(1);

    const empty = mkdtempSync(join(tmpdir(), "adowiki-empty-"));
    try {
      const bare = new GitService(empty);
      await bare.run(["init", "--quiet"]);
      expect(await bare.recentCommits(5)).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("returns a failed result instead of throwing when git says no", async () => {
    const result = await git.run(["checkout", "no-such-branch"]);

    expect(result.ok).toBe(false);
    expect(result.code).toBeGreaterThan(0);
    expect(result.stderr).not.toBe("");
  });

  it("sets a wiki up inside a folder Obsidian is already using as a vault", async () => {
    // The whole point of init + fetch + checkout over `git clone`: the vault is not empty, so
    // clone refuses it outright. Asserted below, so the workaround never becomes cargo cult.
    const vault = mkdtempSync(join(tmpdir(), "adowiki-vault-"));
    mkdirSync(join(vault, ".obsidian", "plugins"), { recursive: true });
    writeFileSync(join(vault, ".obsidian", "app.json"), "{}");
    const remote = fixture.git(fixture.alice, "remote", "get-url", "origin").trim();

    try {
      const clone = await new GitService(vault).run(["clone", remote, "."]);
      expect(clone.ok).toBe(false);

      const setup = new GitService(vault);
      expect((await setup.init()).ok).toBe(true);
      expect((await setup.addRemote(remote)).ok).toBe(true);
      expect(await setup.remoteHeads()).toContain(WIKI_BRANCH);
      expect((await setup.fetch()).ok).toBe(true);
      expect((await setup.checkoutTracking(WIKI_BRANCH)).ok).toBe(true);

      // The wiki arrived...
      expect(existsSync(join(vault, "Home.md"))).toBe(true);
      expect(existsSync(join(vault, ".order"))).toBe(true);
      // ...without disturbing what Obsidian had already put there.
      expect(existsSync(join(vault, ".obsidian", "app.json"))).toBe(true);

      // And it is a state the sync guard rails accept: at the root, on a tracked branch.
      const status = await setup.status();
      expect(status.branch).toBe(WIKI_BRANCH);
      expect(status.upstream).toBe(`origin/${WIKI_BRANCH}`);
      expect(await setup.isAtRepoRoot()).toBe(true);
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });

  it("refuses to check out over a file that is already there", async () => {
    // The protection that makes setting up in an existing folder safe: git will not clobber an
    // untracked file, so a vault with notes in it fails loudly instead of losing them.
    const vault = mkdtempSync(join(tmpdir(), "adowiki-vault-"));
    writeFileSync(join(vault, "Home.md"), "# My own notes\n");
    const remote = fixture.git(fixture.alice, "remote", "get-url", "origin").trim();

    try {
      const setup = new GitService(vault);
      await setup.init();
      await setup.addRemote(remote);
      await setup.fetch();

      const checkout = await setup.checkoutTracking(WIKI_BRANCH);

      expect(checkout.ok).toBe(false);
      expect(readFileSync(join(vault, "Home.md"), "utf8")).toBe("# My own notes\n");
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });
});

/** Alice and Bob edit the same line; Alice's rebase then stops on the conflict. */
async function startConflictingRebase(fixture: WikiFixture, git: GitService): Promise<void> {
  fixture.publish(fixture.bob, "Home.md", "# Home\n\nBob's line\n", "bob edits Home");

  fixture.write(fixture.alice, "Home.md", "# Home\n\nAlice's line\n");
  fixture.commitAll(fixture.alice, "alice edits Home");

  await git.fetch();
  const pull = await git.pullRebaseAutostash();
  if (pull.ok) throw new Error("expected the rebase to stop on a conflict");
}
