import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitService } from "../src/git/gitService";
import {
  ConflictAnswer,
  ConflictFile,
  SyncOrchestrator,
  SyncUi,
} from "../src/git/syncOrchestrator";
import { createWikiFixture, gitAvailable, WIKI_BRANCH, WikiFixture } from "./helpers/tempRepo";

/**
 * The Refresh and Sync flows end to end, against real repositories with a scripted user.
 *
 * These are the acceptance criteria of PLAN Phase 3 in executable form: edit → Sync lands in
 * "Azure DevOps"; a concurrent edit to the same line produces a conflict whose three exits
 * (keep mine / take server / abort) all leave the repository clean and nothing lost.
 */

class ScriptedUi implements SyncUi {
  readonly infos: string[] = [];
  readonly successes: string[] = [];
  readonly errors: string[] = [];
  readonly asked: ConflictFile[][] = [];
  answer: ConflictAnswer = { action: "abort" };

  info(message: string): void {
    this.infos.push(message);
  }
  success(message: string): void {
    this.successes.push(message);
  }
  error(message: string): void {
    this.errors.push(message);
  }
  async askConflicts(files: ConflictFile[]): Promise<ConflictAnswer> {
    this.asked.push(files);
    return this.answer;
  }

  keep(choice: "mine" | "server", ...paths: string[]): void {
    this.answer = { action: "resolve", choices: new Map(paths.map((path) => [path, choice])) };
  }
}

describe.skipIf(!gitAvailable())("SyncOrchestrator", () => {
  let fixture: WikiFixture;
  let git: GitService;
  let ui: ScriptedUi;
  let orchestrator: SyncOrchestrator;
  let branch: string;

  beforeEach(() => {
    fixture = createWikiFixture();
    git = new GitService(fixture.alice);
    ui = new ScriptedUi();
    branch = WIKI_BRANCH;
    orchestrator = new SyncOrchestrator({
      git,
      ui,
      settings: () => ({ wikiBranch: branch, commitMessageTemplate: "wiki: edited {files}" }),
      now: () => new Date(2026, 7, 7, 14, 3),
    });
  });

  afterEach(() => fixture.cleanup());

  const statusOf = async (): Promise<string> =>
    (await git.run(["status", "--porcelain=v2", "--branch"])).stdout;

  // ------------------------------------------------------------------- sync

  it("publishes an edited page to Azure DevOps with a readable commit message", async () => {
    fixture.write(fixture.alice, "Pre%2DRelease-RCA-Categories.md", "# RCA\n");

    const result = await orchestrator.sync();

    expect(result.outcome).toBe("ok");
    expect(result.pages).toBe(1);
    expect(fixture.originContent("Pre%2DRelease-RCA-Categories.md")).toContain("# RCA");
    expect(fixture.git(fixture.alice, "log", "-1", "--pretty=%s").trim()).toBe(
      "wiki: edited Pre-Release RCA Categories",
    );
    expect(ui.errors).toEqual([]);
  });

  it("does nothing, loudly, when there is nothing to publish", async () => {
    const result = await orchestrator.sync();

    expect(result.outcome).toBe("nothing-to-do");
    expect(ui.infos).toHaveLength(1);
    expect(fixture.git(fixture.alice, "log", "-1", "--pretty=%s").trim()).toBe("initial wiki");
  });

  it("commits queued .order writes before staging", async () => {
    let flushed = false;
    orchestrator = new SyncOrchestrator({
      git,
      ui,
      settings: () => ({ wikiBranch: branch, commitMessageTemplate: "wiki: {files}" }),
      beforeStage: async () => {
        fixture.write(fixture.alice, ".order", "Home\nLate-Page\n");
        flushed = true;
      },
    });
    fixture.write(fixture.alice, "Late-Page.md", "# Late\n");

    await orchestrator.sync();

    expect(flushed).toBe(true);
    expect(fixture.originContent(".order")).toBe("Home\nLate-Page\n");
  });

  // ---------------------------------------------------------------- refresh

  it("brings server changes down and counts the pages that moved", async () => {
    fixture.publish(fixture.bob, "Release-Notes.md", "# Release Notes\n", "bob adds notes");

    const result = await orchestrator.refresh();

    expect(result.outcome).toBe("ok");
    expect(result.pages).toBe(1);
    expect(fixture.read(fixture.alice, "Release-Notes.md")).toContain("# Release Notes");
    expect(ui.successes).toEqual(["Refreshed: 1 page updated."]);
  });

  it("says so when there is nothing new", async () => {
    const result = await orchestrator.refresh();

    expect(result.outcome).toBe("up-to-date");
    expect(ui.infos).toEqual(["Your wiki is up to date."]);
  });

  // -------------------------------------------------------------- conflicts

  it("keeps the user's version when they choose theirs, then publishes it", async () => {
    await bothEdited(fixture);
    ui.keep("mine", "Home.md");

    const result = await orchestrator.sync();

    expect(ui.asked).toEqual([[{ path: "Home.md", title: "Home" }]]);
    expect(result.outcome).toBe("ok");
    expect(fixture.read(fixture.alice, "Home.md")).toContain("Alice's line");
    expect(fixture.originContent("Home.md")).toContain("Alice's line");
    expect(await git.inProgressState()).toBeNull();
    expect((await git.status()).files).toEqual([]);
  });

  it("takes the server version when they choose it, and drops their own empty change", async () => {
    await bothEdited(fixture);
    ui.keep("server", "Home.md");

    const result = await orchestrator.sync();

    expect(result.outcome).toBe("ok");
    expect(fixture.read(fixture.alice, "Home.md")).toContain("Bob's line");
    expect(await git.inProgressState()).toBeNull();
    expect((await git.status()).files).toEqual([]);
  });

  it("leaves the repository clean when the user asks for an engineer", async () => {
    await bothEdited(fixture);
    ui.answer = { action: "abort" };

    const result = await orchestrator.sync();

    expect(result.outcome).toBe("conflict-aborted");
    // Nothing lost: Alice's edit is still committed locally, just not published.
    expect(fixture.read(fixture.alice, "Home.md")).toContain("Alice's line");
    expect(fixture.originContent("Home.md")).toContain("Bob's line");
    expect(await git.inProgressState()).toBeNull();
    expect(await statusOf()).not.toContain("\nu ");
  });

  it("never waits on a dialog during an unattended sync", async () => {
    await bothEdited(fixture);

    const result = await orchestrator.sync({ unattended: true });

    expect(ui.asked).toEqual([]);
    expect(result.outcome).toBe("conflict-aborted");
    expect(await git.inProgressState()).toBeNull();
    expect(fixture.read(fixture.alice, "Home.md")).toContain("Alice's line");
  });

  it("picks up a rebase left behind by a previous session", async () => {
    // Simulate Obsidian being closed mid-conflict: the repo is parked in a rebase.
    fixture.publish(fixture.bob, "Home.md", "# Home\n\nBob's line\n", "bob edits Home");
    fixture.write(fixture.alice, "Home.md", "# Home\n\nAlice's line\n");
    fixture.commitAll(fixture.alice, "alice edits Home");
    await git.fetch();
    await git.pullRebaseAutostash();
    expect(await git.inProgressState()).toBe("rebase");

    ui.keep("mine", "Home.md");
    const result = await orchestrator.refresh();

    expect(ui.asked).toHaveLength(1);
    expect(result.outcome).toBe("up-to-date");
    expect(await git.inProgressState()).toBeNull();
    expect(fixture.read(fixture.alice, "Home.md")).toContain("Alice's line");
  });

  // ------------------------------------------------------------ guard rails

  it("refuses to sync from the wrong branch, and says which one it wants", async () => {
    fixture.git(fixture.alice, "checkout", "-q", "-b", "draft");
    fixture.write(fixture.alice, "Home.md", "# Home\n\nOn a side branch\n");

    const result = await orchestrator.sync();

    expect(result.outcome).toBe("blocked");
    expect(ui.errors[0]).toContain('"draft"');
    expect(ui.errors[0]).toContain(`"${WIKI_BRANCH}"`);
    // Refused means refused: nothing was staged or committed.
    expect(await statusOf()).toContain("Home.md");
  });

  it("refuses when the vault is not a git clone at all", async () => {
    const outside = new SyncOrchestrator({
      git: new GitService(fixture.root),
      ui,
      settings: () => ({ wikiBranch: branch, commitMessageTemplate: "" }),
    });

    expect((await outside.refresh()).outcome).toBe("blocked");
    expect(ui.errors[0]).toContain("not a git clone");
  });

  it("refuses when the vault is a folder inside someone else's repository", async () => {
    // `git` searches upwards, so a vault one level down passes every other guard rail: it is a
    // repository, on a branch, with an upstream. Reported from testing as "Get updates says it
    // updated but nothing is pulled" — it had fetched the enclosing project instead.
    fixture.write(fixture.alice, "Notes/Scratch.md", "# Not a wiki\n");
    const inside = new SyncOrchestrator({
      git: new GitService(`${fixture.alice}/Notes`),
      ui,
      settings: () => ({ wikiBranch: branch, commitMessageTemplate: "" }),
    });

    expect((await inside.refresh()).outcome).toBe("blocked");
    expect(ui.errors[0]).toContain("inside a different git repository");
    // Publish is the direction that would have done damage, so it must refuse too.
    expect((await inside.sync()).outcome).toBe("blocked");
  });

  it("keeps the work locally when Azure DevOps cannot be reached", async () => {
    fixture.write(fixture.alice, "Home.md", "# Home\n\nWritten on a train\n");
    fixture.git(fixture.alice, "remote", "set-url", "origin", `${fixture.root}/gone.git`);

    const result = await orchestrator.sync();

    expect(result.outcome).toBe("offline");
    expect(result.message).toContain("could not be reached");
    expect(fixture.git(fixture.alice, "log", "-1", "--pretty=%s").trim()).toBe(
      "wiki: edited Home",
    );
  });

  it("runs one flow at a time", async () => {
    fixture.write(fixture.alice, "Home.md", "# Home\n\nEdited\n");

    const [first, second] = await Promise.all([orchestrator.sync(), orchestrator.refresh()]);

    expect(first.outcome).toBe("ok");
    expect(second.outcome).toBe("busy");
  });

  // Round 4, item 4: both toolbar buttons span, so both spun. The spinner has to name the
  // action the user pressed, and a publish fetches on the way — 'syncing' must not read as
  // 'refreshing' just because git happens to be fetching at that instant.
  it("reports which action is in flight, not which git operation", async () => {
    fixture.write(fixture.alice, "Home.md", "# Home\n\nEdited\n");
    expect(orchestrator.flow).toBeNull();

    const publishing = orchestrator.sync();
    expect(orchestrator.flow).toBe("sync");
    await publishing;
    expect(orchestrator.flow).toBeNull();

    const refreshing = orchestrator.refresh();
    expect(orchestrator.flow).toBe("refresh");
    await refreshing;
    expect(orchestrator.flow).toBeNull();
  });
});

/** Alice has an unsaved edit; Bob has already published a different edit to the same line. */
async function bothEdited(fixture: WikiFixture): Promise<void> {
  fixture.publish(fixture.bob, "Home.md", "# Home\n\nBob's line\n", "bob edits Home");
  fixture.write(fixture.alice, "Home.md", "# Home\n\nAlice's line\n");
}
