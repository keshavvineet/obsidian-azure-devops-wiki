import { App, FileSystemAdapter, Modal, Notice, Setting } from "obsidian";
import type { GitService } from "../git/gitService";
import { S } from "../strings";
import { checkVault, gitignoreAddition, type SetupIssue, type VaultFacts } from "./vaultSetup";

/**
 * "Check vault setup" — the adapter around `vaultSetup.ts` (ARCHITECTURE §7).
 *
 * Gathers the facts (paths, .gitignore, Obsidian's own options), shows what is wrong, and
 * applies only the fixes the user clicks. Nothing is changed just by running the check: this
 * touches a git repository other people share, and a command that silently rewrote settings
 * would be the last thing a nervous first-time user needs.
 */
export class SetupCheck {
  constructor(
    private readonly app: App,
    private readonly git: GitService | null,
  ) {}

  async run(): Promise<void> {
    const facts = await this.gather();
    new SetupCheckModal(this.app, checkVault(facts), (issue) => this.applyFix(issue, facts)).open();
  }

  private async gather(): Promise<VaultFacts> {
    const adapter = this.app.vault.adapter;
    const vaultPath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";

    return {
      vaultPath,
      isRepo: this.git ? await this.git.isRepo().catch(() => false) : false,
      repoRoot: this.git ? await this.git.repoRoot().catch(() => null) : null,
      gitignore: await this.readGitignore(),
      useWikilinks: this.vaultConfig("useMarkdownLinks") === false,
      newLinkFormat: String(this.vaultConfig("newLinkFormat") ?? "shortest"),
      detectAllExtensions: this.vaultConfig("showUnsupportedFiles") === true,
      // Obsidian stores this as 'livePreview'; an Obsidian that does not know the key returns
      // undefined, which must read as "nothing to report" rather than as Source mode.
      livePreview: this.vaultConfig("livePreview") !== false,
      autocrlf:
        (await this.git?.configValue("core.autocrlf").catch(() => null))?.toLowerCase() ?? null,
    };
  }

  private async readGitignore(): Promise<string | null> {
    try {
      // .gitignore is a dot-path: invisible to the Vault API, like .order and .attachments.
      if (!(await this.app.vault.adapter.exists(".gitignore"))) return null;
      return await this.app.vault.adapter.read(".gitignore");
    } catch {
      return null;
    }
  }

  /**
   * Obsidian's per-vault options. `vault.getConfig` is not in the public typings, but it is the
   * only way to read (and set) settings the format depends on; an unknown key returns undefined,
   * so a future Obsidian that renames one degrades to "nothing to report".
   */
  private vaultConfig(key: string): unknown {
    const vault = this.app.vault as unknown as { getConfig?(key: string): unknown };
    return vault.getConfig?.(key);
  }

  private setVaultConfig(key: string, value: unknown): boolean {
    const vault = this.app.vault as unknown as { setConfig?(key: string, value: unknown): void };
    if (!vault.setConfig) return false;
    vault.setConfig(key, value);
    return true;
  }

  private async applyFix(issue: SetupIssue, facts: VaultFacts): Promise<boolean> {
    switch (issue.id) {
      case "gitignore": {
        const addition = gitignoreAddition(facts.gitignore);
        if (addition.length === 0) return true;
        await this.app.vault.adapter.write(".gitignore", (facts.gitignore ?? "") + addition);
        facts.gitignore = (facts.gitignore ?? "") + addition;
        return true;
      }
      case "wikilinks":
        return this.setVaultConfig("useMarkdownLinks", true);
      case "link-format":
        return this.setVaultConfig("newLinkFormat", "absolute");
      case "detect-extensions":
        return this.setVaultConfig("showUnsupportedFiles", false);
      case "source-mode":
        return this.setVaultConfig("livePreview", true);
      case "line-endings": {
        // --local, so only this wiki changes; 'input' keeps commits Unix (what Azure DevOps
        // stores) while leaving the files on disk exactly as they are.
        if (!this.git || !(await this.git.setLocalConfig("core.autocrlf", "input"))) return false;
        // Clears the pages git was already calling modified, so the marks go away immediately.
        await this.git.refreshIndex();
        facts.autocrlf = "input";
        return true;
      }
      default:
        return false;
    }
  }
}

class SetupCheckModal extends Modal {
  constructor(
    app: App,
    private issues: SetupIssue[],
    private readonly fix: (issue: SetupIssue) => Promise<boolean>,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("adowiki-setup");
    contentEl.createEl("h2", { text: S.setup.title });

    if (this.issues.length === 0) {
      contentEl.createDiv({ cls: "adowiki-setup__ok", text: S.setup.allGood });
      new Setting(contentEl).addButton((button) =>
        button.setButtonText(S.modals.cancel).onClick(() => this.close()),
      );
      return;
    }

    for (const issue of this.issues) {
      const setting = new Setting(contentEl)
        .setName(issue.name)
        .setDesc(issue.advice ? `${issue.description} ${issue.advice}` : issue.description);
      setting.settingEl.addClass(`adowiki-setup__issue--${issue.severity}`);

      if (issue.fixLabel) {
        setting.addButton((button) =>
          button
            .setButtonText(S.setup.apply)
            .setCta()
            .setTooltip(issue.fixLabel ?? "")
            .onClick(async () => {
              const applied = await this.fix(issue);
              if (!applied) {
                new Notice(S.notices.failed("apply that fix", "this Obsidian version"));
                return;
              }
              this.issues = this.issues.filter((candidate) => candidate.id !== issue.id);
              this.render();
            }),
        );
      }
    }

    const fixable = this.issues.filter((issue) => issue.fixLabel);
    new Setting(contentEl)
      .addButton((button) => {
        button
          .setButtonText(S.setup.applyAll)
          .setDisabled(fixable.length === 0)
          .onClick(async () => {
            for (const issue of fixable) await this.fix(issue);
            this.issues = this.issues.filter((issue) => !issue.fixLabel);
            this.render();
          });
      })
      .addButton((button) => button.setButtonText(S.modals.cancel).onClick(() => this.close()));
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
