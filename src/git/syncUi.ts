import { App, Modal, Notice, Setting } from "obsidian";
import { S } from "../strings";
import type { ConflictChoice } from "./gitService";
import type { ConflictAnswer, ConflictFile, SyncUi } from "./syncOrchestrator";

/**
 * The Obsidian side of the sync flows: notices and the conflict dialog (FR-7.4).
 *
 * Kept apart from the orchestrator so the flows themselves stay free of Obsidian imports and
 * can be tested against real repositories with a scripted UI.
 */
export class ObsidianSyncUi implements SyncUi {
  constructor(private readonly app: App) {}

  info(message: string): void {
    new Notice(message, 4000);
  }

  success(message: string): void {
    new Notice(message, 5000);
  }

  error(message: string, detail?: string): void {
    // The message is the actionable half; the detail is git's own words, kept for the log.
    if (detail) console.error(`[azure-devops-wiki] ${message}`, detail);
    new Notice(detail && detail.length <= 120 ? `${message}\n\n${detail}` : message, 12000);
  }

  askConflicts(files: ConflictFile[]): Promise<ConflictAnswer> {
    return new Promise((resolve) => new ConflictModal(this.app, files, resolve).open());
  }
}

/**
 * "Someone else changed the same pages" — one choice per file, or one button to walk away.
 *
 * Deliberately not a diff view: the audience cannot read a three-way merge, and the safety
 * net is that whichever version they do not pick is still in the page's history.
 */
export class ConflictModal extends Modal {
  private readonly choices = new Map<string, ConflictChoice>();
  private answered = false;

  constructor(
    app: App,
    private readonly files: ConflictFile[],
    private readonly resolve: (answer: ConflictAnswer) => void,
  ) {
    super(app);
    for (const file of files) this.choices.set(file.path, "mine");
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("adowiki-conflict");
    contentEl.createEl("h3", { text: S.git.conflict.heading });
    contentEl.createEl("p", { text: S.git.conflict.intro });

    if (this.files.length > 1) {
      new Setting(contentEl)
        .setClass("adowiki-conflict__bulk")
        .addButton((button) =>
          button.setButtonText(S.git.conflict.allMine).onClick(() => this.setAll("mine")),
        )
        .addButton((button) =>
          button.setButtonText(S.git.conflict.allServer).onClick(() => this.setAll("server")),
        );
    }

    const listEl = contentEl.createDiv({ cls: "adowiki-conflict__list" });
    for (const file of this.files) {
      new Setting(listEl)
        .setName(file.title)
        .setDesc(file.path)
        .addDropdown((dropdown) =>
          dropdown
            .addOption("mine", S.git.conflict.keepMine)
            .addOption("server", S.git.conflict.takeServer)
            .setValue(this.choices.get(file.path) ?? "mine")
            .onChange((value) => this.choices.set(file.path, value as ConflictChoice)),
        );
    }

    contentEl.createDiv({ cls: "adowiki-conflict__hint", text: S.git.conflict.abortHint });

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText(S.git.conflict.apply)
          .setCta()
          .onClick(() => this.answer({ action: "resolve", choices: new Map(this.choices) })),
      )
      .addButton((button) =>
        button
          .setButtonText(S.git.conflict.abort)
          .setWarning()
          .onClick(() => this.answer({ action: "abort" })),
      );
  }

  override onClose(): void {
    // Closing with Escape must still settle the flow — never leave the repository mid-rebase
    // with the plugin waiting on a dialog that no longer exists.
    this.answer({ action: "abort" });
    this.contentEl.empty();
  }

  private setAll(choice: ConflictChoice): void {
    for (const file of this.files) this.choices.set(file.path, choice);
    // Re-render so the dropdowns show what the bulk button just did.
    this.contentEl.empty();
    this.onOpen();
  }

  private answer(answer: ConflictAnswer): void {
    if (this.answered) return;
    this.answered = true;
    this.resolve(answer);
    this.close();
  }
}
