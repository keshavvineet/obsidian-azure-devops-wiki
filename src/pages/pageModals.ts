import { App, Modal, Setting } from "obsidian";
import { S } from "../strings";
import type { ValidationResult } from "../naming/titleValidator";

/**
 * Title prompt with live validation — the user sees the encoded file name they are about
 * to create and any rule violation before anything touches disk (FR-1.4).
 */
/** One entry of the "Under" dropdown: a folder path and the page title that owns it. */
export interface ParentChoice {
  /** Vault folder the new page goes in; '' is the wiki root. */
  folderPath: string;
  label: string;
}

export class TitlePromptModal extends Modal {
  private value: string;
  private folderPath: string;
  private submitButton: HTMLButtonElement | null = null;
  private feedbackEl: HTMLElement | null = null;
  private submitted = false;

  constructor(
    app: App,
    private readonly options: {
      heading: string;
      cta: string;
      initialValue?: string;
      /** Where the page goes. Fixed when `parents` is omitted (rename never moves a page). */
      folderPath: string;
      /**
       * Offered as a dropdown when present, so "create a page under that one" does not require
       * opening that page first — the reason users reached for *New folder* instead (PLAN §4).
       */
      parents?: ParentChoice[];
      validate: (title: string, folderPath: string) => ValidationResult;
      onSubmit: (result: ValidationResult, folderPath: string) => void;
      /**
       * Called when the modal closes without submitting — Escape, the Cancel button, or clicking
       * away. A caller that Obsidian is awaiting (`createPageByPrompt`) has to hear about that, or
       * its promise never settles and the host command hangs.
       */
      onCancel?: () => void;
    },
  ) {
    super(app);
    this.value = options.initialValue ?? "";
    this.folderPath = options.folderPath;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("adowiki-title-modal");
    contentEl.createEl("h3", { text: this.options.heading });

    let inputEl: HTMLInputElement | null = null;
    new Setting(contentEl).setName(S.modals.titleLabel).addText((text) => {
      inputEl = text.inputEl;
      text
        .setPlaceholder(S.modals.titlePlaceholder)
        .setValue(this.value)
        .onChange((value) => {
          this.value = value;
          this.refresh();
        });
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        this.trySubmit();
      });
    });

    const parents = this.options.parents;
    if (parents && parents.length > 0) {
      new Setting(contentEl).setName(S.modals.parentLabel).addDropdown((dropdown) => {
        for (const choice of parents) dropdown.addOption(choice.folderPath, choice.label);
        // A folder that is not on the list (the active page's, if it holds no page yet) would
        // otherwise silently reset the selection to the first entry.
        if (!parents.some((choice) => choice.folderPath === this.folderPath)) {
          this.folderPath = parents[0].folderPath;
        }
        dropdown.setValue(this.folderPath).onChange((folderPath) => {
          this.folderPath = folderPath;
          this.refresh();
        });
      });
    }

    this.feedbackEl = contentEl.createDiv({ cls: "adowiki-title-modal__feedback" });

    new Setting(contentEl)
      .addButton((button) => {
        this.submitButton = button.buttonEl;
        button
          .setButtonText(this.options.cta)
          .setCta()
          .onClick(() => this.trySubmit());
      })
      .addButton((button) => button.setButtonText(S.modals.cancel).onClick(() => this.close()));

    this.refresh();
    window.setTimeout(() => {
      inputEl?.focus();
      inputEl?.select();
    }, 0);
  }

  override onClose(): void {
    this.contentEl.empty();
    // `submitted` distinguishes "closed because it worked" from every other way a modal ends.
    if (!this.submitted) this.options.onCancel?.();
  }

  private refresh(): void {
    const result = this.options.validate(this.value, this.folderPath);
    if (this.submitButton) this.submitButton.disabled = !result.ok;
    if (!this.feedbackEl) return;

    this.feedbackEl.empty();
    for (const error of result.errors) {
      if (error.code === "empty") continue; // no scolding before they have typed
      this.feedbackEl.createDiv({ cls: "adowiki-feedback--error", text: error.message });
    }
    for (const warning of result.warnings) {
      this.feedbackEl.createDiv({ cls: "adowiki-feedback--warning", text: warning.message });
    }
    if (result.ok) {
      this.feedbackEl.createDiv({
        cls: "adowiki-feedback--info",
        text: S.modals.fileNamePreview(result.fileName),
      });
    }
  }

  private trySubmit(): void {
    if (this.submitted) return;
    const result = this.options.validate(this.value, this.folderPath);
    if (!result.ok) return;
    this.submitted = true;
    this.close();
    this.options.onSubmit(result, this.folderPath);
  }
}

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly options: {
      heading: string;
      body: string;
      cta: string;
      destructive?: boolean;
      onConfirm: () => void;
    },
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.options.heading });
    contentEl.createEl("p", { text: this.options.body });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText(this.options.cta).onClick(() => {
          this.close();
          this.options.onConfirm();
        });
        if (this.options.destructive) button.setWarning();
      })
      .addButton((button) => button.setButtonText(S.modals.cancel).onClick(() => this.close()));
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
