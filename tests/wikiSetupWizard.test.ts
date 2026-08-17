import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App } from "obsidian";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitService } from "../src/git/gitService";
import { WikiSetupWizard, type WikiSetupHost } from "../src/setup/wikiSetupWizard";
import type { WikiCloneTarget } from "../src/setup/wikiClone";
import { FakeVault } from "./helpers/fakeVault";
import { createWikiFixture, gitAvailable, WIKI_BRANCH, WikiFixture } from "./helpers/tempRepo";

/**
 * The wizard's orchestration against real repositories. The modal is Obsidian UI and follows this
 * codebase's convention of not being unit tested, but `run()` is where the damage would be done —
 * it runs `git init` in the user's folder — so it is exercised end to end.
 */
describe.skipIf(!gitAvailable())("WikiSetupWizard.run", () => {
  let fixture: WikiFixture;
  let vaultDir: string;
  let vault: FakeVault;
  let applied: { branch: string; target: WikiCloneTarget } | null;
  let afterSetupCalls: number;
  let progress: string[];

  /** The wiki the fixture publishes, addressed as a local path rather than over the network. */
  function remoteUrl(): string {
    return fixture.git(fixture.alice, "remote", "get-url", "origin").trim();
  }

  function targetFor(url: string): WikiCloneTarget {
    // Built by hand: `parseWikiCloneUrl` is tested separately and would reject a local path.
    return {
      remoteUrl: url,
      organizationUrl: "https://dev.azure.com/contoso",
      project: "MyProject",
      wikiName: "MyProject.wiki",
    };
  }

  function wizardFor(dir: string): WikiSetupWizard {
    const host: WikiSetupHost = {
      git: new GitService(dir),
      applySettings: async (target, branch) => {
        applied = { branch, target };
      },
      afterSetup: async () => {
        afterSetupCalls += 1;
      },
      openSetupCheck: () => undefined,
      suppressPrompt: async () => undefined,
    };
    return new WikiSetupWizard({ vault } as unknown as App, host);
  }

  beforeEach(() => {
    fixture = createWikiFixture();
    vault = new FakeVault();
    applied = null;
    afterSetupCalls = 0;
    progress = [];
    // What Obsidian leaves in a folder it has opened as a vault, and the reason `git clone` cannot
    // be used here.
    vaultDir = mkdtempSync(join(tmpdir(), "adowiki-wizard-"));
    mkdirSync(join(vaultDir, ".obsidian"), { recursive: true });
    writeFileSync(join(vaultDir, ".obsidian", "app.json"), "{}");
  });

  afterEach(() => {
    fixture.cleanup();
    rmSync(vaultDir, { recursive: true, force: true });
  });

  it("downloads the wiki into the vault and reports what it found", async () => {
    const wizard = wizardFor(vaultDir);
    expect(await wizard.shouldOfferUnprompted()).toBe(true);

    const outcome = await wizard.run(targetFor(remoteUrl()), (text) => progress.push(text));

    if (!outcome.ok) throw new Error(`expected setup to succeed: ${outcome.message}`);
    expect(outcome.result.branch).toBe(WIKI_BRANCH);

    // The pages are on disk, beside the Obsidian folder rather than instead of it.
    expect(existsSync(join(vaultDir, "Home.md"))).toBe(true);
    expect(existsSync(join(vaultDir, ".order"))).toBe(true);
    expect(existsSync(join(vaultDir, ".obsidian", "app.json"))).toBe(true);

    // Connection settings are recovered rather than asked for.
    expect(applied?.branch).toBe(WIKI_BRANCH);
    expect(applied?.target.project).toBe("MyProject");
    // The index has to be rebuilt: these files arrived from git, not through the Vault API.
    expect(afterSetupCalls).toBe(1);
    // Something was said at every step, so a slow fetch does not look like a hang.
    expect(progress.length).toBeGreaterThanOrEqual(5);

    // And the result is a state the sync guard rails accept.
    const git = new GitService(vaultDir);
    expect(await git.isAtRepoRoot()).toBe(true);
    expect((await git.status()).upstream).toBe(`origin/${WIKI_BRANCH}`);
  });

  it("writes .gitignore so the first publish cannot leak the Obsidian folder", async () => {
    await wizardFor(vaultDir).run(targetFor(remoteUrl()), () => undefined);

    // FakeVault's adapter is in memory; what matters is that the wizard asked for the write
    // rather than leaving it to the setup check the user may never run.
    expect(vault.disk.get(".gitignore")).toContain(".obsidian");
  });

  it("explains a wrong address without leaving a half-set-up folder behind", async () => {
    const outcome = await wizardFor(vaultDir).run(
      targetFor(join(fixture.root, "no-such-wiki.git")),
      (text) => progress.push(text),
    );

    if (outcome.ok) throw new Error("expected setup to fail against a missing remote");
    expect(outcome.message).toContain("Could not download");
    // It stopped before any pages were written.
    expect(existsSync(join(vaultDir, "Home.md"))).toBe(false);
  });

  it("refuses a vault that already has notes in it", async () => {
    vault.addPage("My own note.md");
    const wizard = wizardFor(vaultDir);

    expect(await wizard.shouldOfferUnprompted()).toBe(false);
    const outcome = await wizard.run(targetFor(remoteUrl()), () => undefined);

    if (outcome.ok) throw new Error("expected setup to refuse a non-empty vault");
    expect(outcome.message).toContain("already has notes");
    // Nothing was initialised, so the folder is exactly as the user left it.
    expect(existsSync(join(vaultDir, ".git"))).toBe(false);
  });

  it("refuses a folder inside another repository, where git init would nest one", async () => {
    // The failure measured in testing: git searches upwards, so this looks like a healthy repo.
    const inside = join(fixture.alice, "Vault");
    mkdirSync(inside, { recursive: true });
    const wizard = wizardFor(inside);

    expect(await wizard.shouldOfferUnprompted()).toBe(false);
    const outcome = await wizard.run(targetFor(remoteUrl()), () => undefined);

    if (outcome.ok) throw new Error("expected setup to refuse a nested repository");
    expect(outcome.message).toContain("inside another git repository");
    expect(existsSync(join(inside, ".git"))).toBe(false);
  });

  it("leaves an existing clone alone", async () => {
    const wizard = wizardFor(fixture.alice);

    expect(await wizard.shouldOfferUnprompted()).toBe(false);
    const outcome = await wizard.run(targetFor(remoteUrl()), () => undefined);

    if (outcome.ok) throw new Error("expected setup to refuse an existing clone");
    expect(outcome.message).toContain("already a git clone");
  });
});
