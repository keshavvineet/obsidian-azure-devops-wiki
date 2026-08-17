import { App, Modal, Setting } from "obsidian";
import type { GitService } from "../git/gitService";
import { chooseCloneBranch } from "../git/wikiBranch";
import { S } from "../strings";
import { gitignoreAddition } from "./vaultSetup";
import {
  cloneBlocker,
  parseWikiCloneUrl,
  type CloneBlocker,
  type WikiCloneTarget,
} from "./wikiClone";

/**
 * "Set up your Azure DevOps wiki" — the first-run flow that downloads a wiki into an empty vault
 * (FR-7.8).
 *
 * The audience has been asked, until now, to run `git clone` in a terminal before Obsidian could
 * be useful at all, which is the single biggest barrier for someone who has never used git. This
 * does it from inside the plugin: one pasted address from the portal's *Clone wiki* dialog, and
 * the decisions (which branch, what the organization and project are called) are derived rather
 * than asked for.
 *
 * The decisions live in `wikiClone.ts` and `wikiBranch.chooseCloneBranch`, which are pure and
 * tested; this file is the adapter that gathers facts, drives git and reports progress.
 */

export interface WikiSetupResult {
  branch: string;
  pageCount: number;
  target: WikiCloneTarget;
}

/** What the wizard needs from the plugin, kept narrow so it can be reasoned about. */
export interface WikiSetupHost {
  git: GitService | null;
  /** Persist the connection details recovered from the pasted URL. */
  applySettings(target: WikiCloneTarget, branch: string): Promise<void>;
  /** Re-index the vault and refresh the UI once pages have appeared on disk. */
  afterSetup(): Promise<void>;
  openSetupCheck(): void;
  /** Remember that the user does not want to be asked about this vault again. */
  suppressPrompt(): Promise<void>;
}

export class WikiSetupWizard {
  constructor(
    private readonly app: App,
    private readonly host: WikiSetupHost,
  ) {}

  /**
   * Whether an empty vault should be offered the wizard unprompted. Deliberately narrow: only a
   * vault with nothing in it and no repository, because anything else risks interrupting somebody
   * who knows what they are doing.
   */
  async shouldOfferUnprompted(): Promise<boolean> {
    return (await this.blocker()) === null;
  }

  open(): void {
    new WikiSetupModal(this.app, this).open();
  }

  async blocker(): Promise<CloneBlocker | null> {
    const git = this.host.git;
    return cloneBlocker({
      gitAvailable: git !== null && (await git.version().catch(() => null)) !== null,
      isRepo: git !== null && (await git.isRepo().catch(() => false)),
      atRepoRoot: git !== null && (await git.isAtRepoRoot().catch(() => false)),
      markdownFileCount: this.app.vault.getMarkdownFiles().length,
    });
  }

  /**
   * Do it. Every git step is checked, because a half-set-up folder is worse than none: the user
   * is told which step failed, in terms of what they were trying to do.
   */
  async run(
    target: WikiCloneTarget,
    progress: (message: string) => void,
  ): Promise<{ ok: true; result: WikiSetupResult } | { ok: false; message: string }> {
    const git = this.host.git;
    if (git === null) return { ok: false, message: S.wizard.blocker["no-git"] };

    // Re-checked here and not only before opening: the user may have been sitting on this dialog.
    const blocked = await this.blocker();
    if (blocked !== null) return { ok: false, message: S.wizard.blocker[blocked] };

    progress(S.wizard.stepInit);
    if (!(await git.init()).ok) return { ok: false, message: S.wizard.failedInit };

    progress(S.wizard.stepRemote);
    if (!(await git.addRemote(target.remoteUrl)).ok) {
      return { ok: false, message: S.wizard.failedRemote };
    }

    // First contact with the server, so this is where a wrong address or a missing sign-in shows
    // up — before anything has been downloaded.
    progress(S.wizard.stepBranch);
    const heads = await git.remoteHeads().catch(() => []);
    const symref = await git.remoteDefaultBranch().catch(() => null);
    const branch = chooseCloneBranch(symref, heads);
    if (branch === null) {
      return {
        ok: false,
        message: heads.length === 0 ? S.wizard.failedFetch : S.wizard.ambiguousBranch,
      };
    }

    progress(S.wizard.stepFetch);
    if (!(await git.fetch()).ok) return { ok: false, message: S.wizard.failedFetch };

    progress(S.wizard.stepCheckout);
    if (!(await git.checkoutTracking(branch)).ok) {
      return { ok: false, message: S.wizard.failedCheckout };
    }

    progress(S.wizard.stepFinish);
    await this.ignoreObsidianFolder();
    await this.host.applySettings(target, branch);
    await this.host.afterSetup();

    return {
      ok: true,
      result: { branch, pageCount: this.app.vault.getMarkdownFiles().length, target },
    };
  }

  /**
   * Keep `.obsidian/` out of the wiki from the very first commit, rather than leaving it for the
   * setup check to catch later — by then the user may already have published a workspace file
   * into a wiki their colleagues read.
   */
  private async ignoreObsidianFolder(): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      // .gitignore is a dot-path, so the Vault API cannot see it.
      const existing = (await adapter.exists(".gitignore")) ? await adapter.read(".gitignore") : null;
      const addition = gitignoreAddition(existing);
      if (addition.length > 0) await adapter.write(".gitignore", (existing ?? "") + addition);
    } catch {
      // Not worth failing the whole setup for: the setup check offers the same fix, and the
      // wizard has already done the part the user could not do themselves.
    }
  }

  /** Delegates, so the modal needs to know about the wizard only and not the whole plugin. */
  async suppressPromptForVault(): Promise<void> {
    await this.host.suppressPrompt();
  }

  openSetupCheckNow(): void {
    this.host.openSetupCheck();
  }
}

class WikiSetupModal extends Modal {
  private url = "";
  private busy = false;
  private message: { text: string; kind: "problem" | "progress" } | null = null;
  private result: WikiSetupResult | null = null;
  /** The slot progress and problems are written into, reserved during `render`. */
  private messageEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly wizard: WikiSetupWizard,
  ) {
    super(app);
  }

  override onOpen(): void {
    void this.render();
  }

  private async render(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    // Emptying contentEl detaches the old slot, so any reference to it is now stale.
    this.messageEl = null;
    contentEl.addClass("adowiki-setup");
    contentEl.createEl("h2", { text: S.wizard.title });

    if (this.result !== null) {
      this.renderDone(this.result);
      return;
    }

    const blocked = await this.wizard.blocker();
    if (blocked !== null) {
      contentEl.createDiv({ cls: "adowiki-setup__issue--error", text: S.wizard.blocker[blocked] });
      new Setting(contentEl).addButton((button) =>
        button.setButtonText(S.wizard.done).setCta().onClick(() => this.close()),
      );
      return;
    }

    contentEl.createEl("p", { text: S.wizard.intro });
    contentEl.createEl("p", { cls: "adowiki-setup__hint", text: S.wizard.whereToFind });

    new Setting(contentEl).setName(S.wizard.urlLabel).addText((text) => {
      text
        .setPlaceholder(S.wizard.urlPlaceholder)
        .setValue(this.url)
        .onChange((value) => {
          this.url = value;
          // Clearing a stale complaint as the user types is the whole feedback loop here.
          if (this.message?.kind === "problem") {
            this.message = null;
            this.paintMessage();
          }
        });
      text.inputEl.addClass("adowiki-setup__url");
      text.inputEl.setAttribute("spellcheck", "false");
      window.setTimeout(() => text.inputEl.focus(), 0);
    });

    this.messageEl = contentEl.createDiv({ cls: "adowiki-setup__message" });
    this.paintMessage();

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText(S.wizard.setUp)
          .setCta()
          .setDisabled(this.busy)
          .onClick(() => void this.submit()),
      )
      .addButton((button) =>
        button
          .setButtonText(S.wizard.notNow)
          .setDisabled(this.busy)
          .onClick(() => this.close()),
      )
      .addExtraButton((button) =>
        button
          .setIcon("bell-off")
          .setTooltip(S.wizard.dontAskAgain)
          .onClick(async () => {
            await this.wizard.suppressPromptForVault();
            this.close();
          }),
      );
  }

  /**
   * Writes into the slot `render` reserved between the field and the buttons. Appending to
   * `contentEl` instead would put progress and error text *below* the buttons, because these
   * repaints happen after the dialog is already built.
   */
  private paintMessage(): void {
    const host = this.messageEl;
    if (!host) return;
    host.empty();
    host.removeClass("adowiki-setup__issue--error");
    host.removeClass("adowiki-setup__hint");
    if (this.message === null) return;
    host.addClass(
      this.message.kind === "problem" ? "adowiki-setup__issue--error" : "adowiki-setup__hint",
    );
    host.setText(this.message.text);
  }

  private async submit(): Promise<void> {
    if (this.busy) return;

    const parsed = parseWikiCloneUrl(this.url);
    if (!parsed.ok) {
      this.message = { text: S.wizard.problem[parsed.problem], kind: "problem" };
      this.paintMessage();
      return;
    }

    this.busy = true;
    await this.render();

    const outcome = await this.wizard.run(parsed.target, (text) => {
      this.message = { text, kind: "progress" };
      this.paintMessage();
    });

    this.busy = false;
    if (!outcome.ok) {
      this.message = { text: outcome.message, kind: "problem" };
      await this.render();
      return;
    }

    this.result = outcome.result;
    this.message = null;
    await this.render();
  }

  private renderDone(result: WikiSetupResult): void {
    const { contentEl } = this;
    contentEl.createDiv({
      cls: "adowiki-setup__ok",
      text: S.wizard.success(result.pageCount, result.branch),
    });
    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText(S.wizard.openCheck)
          .onClick(() => {
            this.close();
            this.wizard.openSetupCheckNow();
          }),
      )
      .addButton((button) =>
        button.setButtonText(S.wizard.done).setCta().onClick(() => this.close()),
      );
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
