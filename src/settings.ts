import { App, debounce, Notice, PluginSettingTab, Setting } from "obsidian";
import type AdoWikiPlugin from "./main";
import { DEFAULT_WIKI_BRANCH } from "./constants";
import { DEFAULT_COMMIT_TEMPLATE } from "./git/commitMessage";
import { ALL_RULES } from "./lint/rules";
import { S } from "./strings";

export interface AdoWikiSettings {
  // connection
  organizationUrl: string;
  project: string;
  wikiName: string;
  pat: string;
  // git
  gitEnabled: boolean;
  wikiBranch: string;
  /**
   * Set once the user has been offered the first-run wizard and said no. Only suppresses the
   * *unprompted* offer — the command stays available — so a vault that is deliberately empty
   * stops nagging without hiding the feature.
   */
  setupPromptDismissed: boolean;
  autoRefreshOnOpen: boolean;
  autoRefreshIntervalMin: number;
  /** Publish pending edits when Obsidian quits. Off by default: it runs without supervision. */
  autoSyncOnClose: boolean;
  commitMessageTemplate: string;
  preSyncLint: "off" | "warn" | "block";
  // lint
  /** Rule ids the user has switched off (src/lint/rules/index.ts holds the full set). */
  disabledLintRules: string[];
  // pages
  /**
   * .order files are always kept in step as pages are created, renamed and deleted.
   * This additionally scans the whole vault at start-up, which can produce a large first
   * commit on a wiki whose .order files have drifted — hence opt-in.
   */
  repairOrderOnStartup: boolean;
  // editing
  wikilinkConversion: "insert" | "save" | "off";
  showToolbar: boolean;
  decorateFileExplorer: boolean;
  /**
   * One explorer row per page. A page with subpages is a `.md` file *and* a folder, so
   * Obsidian's own explorer lists it twice; Azure DevOps shows one node. Reversible, and it
   * degrades to stock rows if Obsidian's explorer DOM changes.
   */
  singleRowPerPage: boolean;
  /**
   * Mark pages that differ from Azure DevOps in the explorer and the wiki tree, the way an
   * editor marks modified files. Needs the git integration; display-only either way.
   */
  markChangedPages: boolean;
  /**
   * Ask for the page title when Obsidian's own **New note** / **New folder** is used, instead of
   * creating `Untitled` and repairing the name afterwards. Off gives Obsidian's dialogs back — the
   * name guards still catch anything Azure DevOps could not open.
   */
  promptForPageName: boolean;
  // rendering
  renderWorkItemLinks: boolean;
  renderMentions: boolean;
  /**
   * Re-render a paragraph whose pipe table lacks the blank line Obsidian's parser needs.
   * Display only — the file is never rewritten. Off restores stock Obsidian rendering.
   */
  repairAdoTables: boolean;
}

export const DEFAULT_SETTINGS: AdoWikiSettings = {
  organizationUrl: "",
  project: "",
  wikiName: "",
  pat: "",
  gitEnabled: true,
  wikiBranch: DEFAULT_WIKI_BRANCH,
  setupPromptDismissed: false,
  autoRefreshOnOpen: true,
  autoRefreshIntervalMin: 0,
  autoSyncOnClose: false,
  commitMessageTemplate: DEFAULT_COMMIT_TEMPLATE,
  preSyncLint: "warn",
  disabledLintRules: [],
  repairOrderOnStartup: false,
  wikilinkConversion: "insert",
  showToolbar: true,
  decorateFileExplorer: true,
  singleRowPerPage: true,
  markChangedPages: true,
  promptForPageName: true,
  renderWorkItemLinks: true,
  renderMentions: true,
  repairAdoTables: true,
};

/** Long enough that a typed name is one `git config` call, short enough to feel immediate. */
const IDENTITY_WRITE_DELAY_MS = 800;

export class AdoWikiSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: AdoWikiPlugin,
  ) {
    super(app, plugin);
  }

  /**
   * Persist a text field's value once the user stops typing, not once per keystroke.
   *
   * `saveSettings()` rewrites `data.json`, and a wiki clone very often lives in a synced folder
   * (OneDrive, in the reference wikis) where every write wakes the sync client and can leave it
   * holding the file. Typing an organisation URL used to mean ~30 of those writes. The setting
   * itself is still applied to memory immediately, so the live toggles keep working — only the
   * write to disk waits.
   */
  private readonly saveSoon = debounce(() => void this.plugin.saveSettings(), 500, true);

  /** Obsidian closes the tab without warning, so anything still pending is written now. */
  override hide(): void {
    this.saveSoon.run();
    super.hide();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName(S.settings.connectionHeading).setHeading();

    new Setting(containerEl)
      .setName(S.settings.organizationUrlName)
      .setDesc(S.settings.organizationUrlDesc)
      .addText((t) =>
        t.setValue(this.plugin.settings.organizationUrl).onChange((v) => {
          this.plugin.settings.organizationUrl = v.trim().replace(/\/+$/, "");
          this.plugin.workItems.invalidate();
          this.saveSoon();
        }),
      );

    new Setting(containerEl).setName(S.settings.projectName).addText((t) =>
      t.setValue(this.plugin.settings.project).onChange((v) => {
        this.plugin.settings.project = v.trim();
        this.plugin.workItems.invalidate();
        this.saveSoon();
      }),
    );

    new Setting(containerEl)
      .setName(S.settings.wikiNameName)
      .setDesc(S.settings.wikiNameDesc)
      .addText((t) =>
        t.setValue(this.plugin.settings.wikiName).onChange((v) => {
          this.plugin.settings.wikiName = v.trim();
          this.saveSoon();
        }),
      );

    new Setting(containerEl)
      .setName(S.settings.patName)
      .setDesc(S.settings.patDesc)
      .addText((t) => {
        t.inputEl.type = "password";
        t.setValue(this.plugin.settings.pat).onChange((v) => {
          this.plugin.settings.pat = v.trim();
          this.plugin.workItems.invalidate();
          this.saveSoon();
        });
      });

    this.displayIdentitySection(containerEl);

    new Setting(containerEl).setName(S.settings.displayHeading).setHeading();

    new Setting(containerEl)
      .setName(S.settings.decorateName)
      .setDesc(S.settings.decorateDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.decorateFileExplorer).onChange(async (value) => {
          this.plugin.settings.decorateFileExplorer = value;
          await this.plugin.saveSettings();
          // Applied immediately: the decoration is reversible, so no reload is needed.
          this.plugin.applyTitleDecoration();
        }),
      );

    new Setting(containerEl)
      .setName(S.settings.singleRowName)
      .setDesc(S.settings.singleRowDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.singleRowPerPage).onChange(async (value) => {
          this.plugin.settings.singleRowPerPage = value;
          await this.plugin.saveSettings();
          this.plugin.applyTitleDecoration();
        }),
      );

    new Setting(containerEl)
      .setName(S.settings.markChangedName)
      .setDesc(S.settings.markChangedDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.markChangedPages).onChange(async (value) => {
          this.plugin.settings.markChangedPages = value;
          await this.plugin.saveSettings();
          this.plugin.applyTitleDecoration();
        }),
      );

    new Setting(containerEl)
      .setName(S.settings.promptForNameName)
      .setDesc(S.settings.promptForNameDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.promptForPageName).onChange(async (value) => {
          this.plugin.settings.promptForPageName = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName(S.settings.gitHeading).setHeading();

    new Setting(containerEl)
      .setName(S.settings.gitEnabledName)
      .setDesc(S.settings.gitEnabledDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.gitEnabled).onChange(async (value) => {
          this.plugin.settings.gitEnabled = value;
          await this.plugin.saveSettings();
          this.plugin.applyGitIntegration();
        }),
      );

    new Setting(containerEl)
      .setName(S.settings.wikiBranchName)
      .setDesc(S.settings.wikiBranchDesc)
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_WIKI_BRANCH)
          .setValue(this.plugin.settings.wikiBranch)
          .onChange((value) => {
            const branch = value.trim();
            this.plugin.settings.wikiBranch = branch.length === 0 ? DEFAULT_WIKI_BRANCH : branch;
            this.saveSoon();
          }),
      );

    new Setting(containerEl)
      .setName(S.settings.autoRefreshOnOpenName)
      .setDesc(S.settings.autoRefreshOnOpenDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoRefreshOnOpen).onChange(async (value) => {
          this.plugin.settings.autoRefreshOnOpen = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(S.settings.autoRefreshIntervalName)
      .setDesc(S.settings.autoRefreshIntervalDesc)
      .addText((text) =>
        text
          .setPlaceholder("0")
          .setValue(String(this.plugin.settings.autoRefreshIntervalMin))
          .onChange((value) => {
            const minutes = Number.parseInt(value, 10);
            this.plugin.settings.autoRefreshIntervalMin =
              Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
            this.plugin.applyGitIntegration();
            this.saveSoon();
          }),
      );

    new Setting(containerEl)
      .setName(S.settings.autoSyncOnCloseName)
      .setDesc(S.settings.autoSyncOnCloseDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoSyncOnClose).onChange(async (value) => {
          this.plugin.settings.autoSyncOnClose = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(S.settings.commitTemplateName)
      .setDesc(S.settings.commitTemplateDesc)
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_COMMIT_TEMPLATE)
          .setValue(this.plugin.settings.commitMessageTemplate)
          .onChange((value) => {
            this.plugin.settings.commitMessageTemplate = value;
            this.saveSoon();
          }),
      );

    new Setting(containerEl).setName("Pages").setHeading();

    new Setting(containerEl)
      .setName("Repair .order files on start-up")
      .setDesc(
        "Check every folder's page sequence when the vault opens. Page creation, renaming " +
          "and deletion always keep .order in step regardless of this setting.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.repairOrderOnStartup).onChange(async (value) => {
          this.plugin.settings.repairOrderOnStartup = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName(S.settings.editingHeading).setHeading();

    new Setting(containerEl)
      .setName(S.settings.toolbarName)
      .setDesc(S.settings.toolbarDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showToolbar).onChange(async (value) => {
          this.plugin.settings.showToolbar = value;
          await this.plugin.saveSettings();
          this.plugin.applyToolbar();
        }),
      );

    new Setting(containerEl)
      .setName(S.settings.wikilinkConversionName)
      .setDesc(S.settings.wikilinkConversionDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            insert: S.settings.wikilinkConversionInsert,
            save: S.settings.wikilinkConversionSave,
            off: S.settings.wikilinkConversionOff,
          })
          .setValue(this.plugin.settings.wikilinkConversion)
          .onChange(async (value) => {
            this.plugin.settings.wikilinkConversion = value as AdoWikiSettings["wikilinkConversion"];
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName(S.settings.renderingHeading).setHeading();

    new Setting(containerEl)
      .setName(S.settings.renderWorkItemsName)
      .setDesc(S.settings.renderWorkItemsDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.renderWorkItemLinks).onChange(async (value) => {
          this.plugin.settings.renderWorkItemLinks = value;
          await this.plugin.saveSettings();
          this.plugin.refreshRenderedPages();
        }),
      );

    new Setting(containerEl)
      .setName(S.settings.renderMentionsName)
      .setDesc(S.settings.renderMentionsDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.renderMentions).onChange(async (value) => {
          this.plugin.settings.renderMentions = value;
          await this.plugin.saveSettings();
          this.plugin.refreshRenderedPages();
        }),
      );

    new Setting(containerEl)
      .setName(S.settings.repairTablesName)
      .setDesc(S.settings.repairTablesDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.repairAdoTables).onChange(async (value) => {
          this.plugin.settings.repairAdoTables = value;
          await this.plugin.saveSettings();
          this.plugin.refreshRenderedPages();
        }),
      );

    this.displayLintSection(containerEl);
  }

  /** The compatibility linter: when it runs during a sync, and which checks are on (FR-8.3). */
  private displayLintSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(S.lint.title).setHeading();

    new Setting(containerEl)
      .setName(S.settings.preSyncLintName)
      .setDesc(S.settings.preSyncLintDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            off: S.settings.preSyncLintOff,
            warn: S.settings.preSyncLintWarn,
            block: S.settings.preSyncLintBlock,
          })
          .setValue(this.plugin.settings.preSyncLint)
          .onChange(async (value) => {
            this.plugin.settings.preSyncLint = value as AdoWikiSettings["preSyncLint"];
            await this.plugin.saveSettings();
          }),
      );

    const disabled = new Set(this.plugin.settings.disabledLintRules);
    for (const rule of ALL_RULES) {
      new Setting(containerEl)
        .setName(rule.description)
        .setClass("adowiki-settings__rule")
        .addToggle((toggle) =>
          toggle.setValue(!disabled.has(rule.id)).onChange(async (value) => {
            const next = new Set(this.plugin.settings.disabledLintRules);
            if (value) next.delete(rule.id);
            else next.add(rule.id);
            this.plugin.settings.disabledLintRules = [...next];
            await this.plugin.saveSettings();
          }),
        );
    }
  }

  /**
   * Only shown when the vault is a git clone *and* the git integration is on — with git off,
   * nothing here has any effect, and rendering it would still run git to fill the fields.
   *
   * These two fields write to `.git/config` rather than to plugin settings, so they get the same
   * treatment as the text fields above and for a stronger reason: each write is a `git config`
   * **process**. Typing a name used to spawn one per character, all of them racing for the same
   * config file. The write waits until typing stops, and is skipped when the value has not
   * actually changed — which also makes filling the field from git a no-op instead of a write.
   */
  private displayIdentitySection(containerEl: HTMLElement): void {
    const git = this.plugin.git;
    if (!git || !this.plugin.settings.gitEnabled) return;

    new Setting(containerEl).setName(S.settings.identityHeading).setHeading();

    new Setting(containerEl)
      .setName(S.settings.userNameName)
      .setDesc(S.settings.userNameDesc)
      .addText((t) => {
        let stored = "";
        const write = debounce((value: string) => {
          if (value === stored) return;
          stored = value;
          void git.setUserName(value);
        }, IDENTITY_WRITE_DELAY_MS, true);

        t.onChange((v) => write(v.trim()));
        void git.userName().then((name) => {
          stored = name;
          t.setValue(name);
        });
      });

    new Setting(containerEl)
      .setName(S.settings.userEmailName)
      .setDesc(S.settings.userEmailDesc)
      .addText((t) => {
        let stored = "";
        const write = debounce((value: string) => {
          if (value === stored) return;
          stored = value;
          void git.setUserEmail(value);
        }, IDENTITY_WRITE_DELAY_MS, true);

        t.onChange((v) => write(v.trim()));
        void git.userEmail().then((email) => {
          stored = email;
          t.setValue(email);
        });
      });

    new Setting(containerEl)
      .setName(S.settings.forgetCredentialName)
      .setDesc(S.settings.forgetCredentialDesc)
      .addButton((button) =>
        button.setButtonText(S.settings.forgetCredentialButton).onClick(async () => {
          const ok = await git.forgetStoredCredential();
          new Notice(ok ? S.settings.forgetCredentialDone : S.settings.forgetCredentialFailed);
        }),
      );
  }
}
