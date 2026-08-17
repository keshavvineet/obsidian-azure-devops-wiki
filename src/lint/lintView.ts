import {
  ItemView,
  MarkdownView,
  Notice,
  setIcon,
  TFile,
  type WorkspaceLeaf,
} from "obsidian";
import { decodePathToTitlePath } from "../naming/pageNameCodec";
import { S } from "../strings";
import type { CompatLinter } from "./compatLinter";
import { countBySeverity } from "./lintEngine";
import type { LintFinding, LintSeverity } from "./types";
import { RowKeyboardNav } from "../util/rowKeyboardNav";

export const LINT_VIEW = "adowiki-lint";

export type LintScope = "file" | "vault";

export interface LintViewDeps {
  linter: CompatLinter;
  /** The page the user is looking at, for the 'This page' scope. */
  activeFile: () => TFile | null;
}

/**
 * "Compatibility" sidebar: what will not survive publication, and a button to repair it (FR-8.2).
 *
 * The pane owns no analysis of its own — it asks the linter, shows what came back, and hands
 * findings back to be fixed. Clicking a finding opens the page at the line it is on, because a
 * list of problems nobody can navigate to is a list nobody acts on.
 */
export class LintView extends ItemView {
  private readonly linter: CompatLinter;
  private readonly activeFile: () => TFile | null;

  /** Named lintScope: ItemView already has a `scope` (Obsidian's keymap scope). */
  private lintScope: LintScope = "file";
  private minimum: LintSeverity | "all" = "all";
  private findings: LintFinding[] = [];
  private pagesScanned = 0;
  private scanned = false;
  private scanning = false;

  private headerEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private keyboard: RowKeyboardNav | null = null;

  constructor(leaf: WorkspaceLeaf, deps: LintViewDeps) {
    super(leaf);
    this.linter = deps.linter;
    this.activeFile = deps.activeFile;
  }

  override getViewType(): string {
    return LINT_VIEW;
  }

  override getDisplayText(): string {
    return S.lint.title;
  }

  override getIcon(): string {
    return "check-circle";
  }

  override async onOpen(): Promise<void> {
    this.ensureMounted();
    this.repaint();
  }

  /**
   * Builds the pane once, from whichever call arrives first.
   *
   * Same reason as `wikiTreeView.ensureMounted`: a sidebar view can be constructed without
   * `onOpen()` ever being called, and here that left `headerEl`/`listEl` undefined — so the pane
   * was not merely empty, `repaint()` threw on `undefined.empty()` and every later scan with it.
   */
  private ensureMounted(): void {
    // Plain non-null, for the reason spelled out in `wikiTreeView.ensureMounted`.
    if (this.listEl) return;

    this.contentEl.empty();
    this.contentEl.addClass("adowiki-lint");
    this.headerEl = this.contentEl.createDiv({ cls: "adowiki-lint__header" });
    this.listEl = this.contentEl.createDiv({ cls: "adowiki-lint__list" });
    this.listEl.setAttribute("role", "list");
    this.keyboard = new RowKeyboardNav(this.listEl);
  }

  override onResize(): void {
    if (this.listEl) return;
    this.repaint();
  }

  /** Draw even if the host called no lifecycle hook — see `wikiTreeView.ensureVisible`. */
  ensureVisible(): void {
    this.repaint();
  }

  /**
   * Show findings somebody else computed — the pre-sync gate has already scanned the pages it
   * is about to publish, and re-running the whole thing here would double the wait.
   */
  show(findings: LintFinding[], pagesScanned: number, scope: LintScope = "vault"): void {
    this.lintScope = scope;
    this.findings = findings;
    this.pagesScanned = pagesScanned;
    this.scanned = true;
    this.scanning = false;
    this.repaint();
  }

  /** Run a scan and show the result. Also the entry point for the two lint commands. */
  async scan(scope: LintScope = this.lintScope): Promise<void> {
    this.lintScope = scope;
    this.scanning = true;
    this.repaint();

    try {
      if (scope === "file") {
        const file = this.activeFile();
        this.findings = file ? await this.linter.lintFile(file) : [];
        this.pagesScanned = file ? 1 : 0;
      } else {
        const report = await this.linter.lintVault();
        this.findings = report.findings;
        this.pagesScanned = report.pagesScanned;
      }
      this.scanned = true;
    } finally {
      this.scanning = false;
      this.repaint();
    }
  }

  /** Both halves always redraw together; nothing here is expensive enough to split. */
  private repaint(): void {
    this.ensureMounted();
    // Also covers a scan finishing after the pane was closed again.
    if (!this.headerEl?.isConnected) return;
    this.renderHeader();
    this.renderList();
  }

  // ------------------------------------------------------------------ header

  private renderHeader(): void {
    const headerEl = this.headerEl;
    if (!headerEl) return;
    headerEl.empty();

    const controls = headerEl.createDiv({ cls: "adowiki-lint__controls" });
    const scopes = controls.createDiv({ cls: "adowiki-lint__scope" });
    for (const [value, label] of [
      ["file", S.lint.scopeFile],
      ["vault", S.lint.scopeVault],
    ] as Array<[LintScope, string]>) {
      const button = scopes.createEl("button", {
        cls: `adowiki-lint__scope-button${this.lintScope === value ? " is-active" : ""}`,
        text: label,
      });
      button.onclick = () => void this.scan(value);
    }

    const rescan = controls.createEl("button", { cls: "adowiki-lint__action" });
    setIcon(rescan.createSpan(), "refresh-cw");
    rescan.createSpan({ text: S.lint.rescan });
    rescan.disabled = this.scanning;
    rescan.onclick = () => void this.scan();

    const visible = this.visibleFindings();
    const fixable = visible.filter((finding) => finding.fix);
    if (fixable.length > 0) {
      const fixAll = controls.createEl("button", {
        cls: "adowiki-lint__action mod-cta",
        text: `${S.lint.fixAll} (${fixable.length})`,
      });
      fixAll.onclick = () => void this.applyFixes(fixable);
    }

    const counts = countBySeverity(this.findings);
    const summary = headerEl.createDiv({ cls: "adowiki-lint__summary" });
    if (this.scanning) {
      summary.setText(S.lint.scanning);
      return;
    }
    if (!this.scanned) {
      summary.setText(S.lint.notScanned);
      return;
    }
    summary.setText(
      `${S.lint.summary(counts.error, counts.warn, counts.info)} · ${S.lint.scanned(this.pagesScanned)}`,
    );

    const filter = headerEl.createDiv({ cls: "adowiki-lint__filter" });
    for (const [value, label] of [
      ["all", S.lint.showAll],
      ["error", S.lint.severityLabel.error],
      ["warn", S.lint.severityLabel.warn],
      ["info", S.lint.severityLabel.info],
    ] as Array<[LintSeverity | "all", string]>) {
      const button = filter.createEl("button", {
        cls: `adowiki-lint__chip${this.minimum === value ? " is-active" : ""}`,
        text: label,
      });
      button.onclick = () => {
        this.minimum = value;
        this.repaint();
      };
    }
  }

  // -------------------------------------------------------------------- list

  private renderList(): void {
    const listEl = this.listEl;
    if (!listEl) return;

    this.keyboard?.beginRender();
    listEl.empty();
    if (this.scanning || !this.scanned) {
      this.keyboard?.endRender();
      return;
    }

    const visible = this.visibleFindings();
    if (visible.length === 0) {
      listEl.createDiv({
        cls: "adowiki-lint__empty",
        text: this.lintScope === "vault" ? S.lint.cleanVault : S.lint.clean,
      });
      this.keyboard?.endRender();
      return;
    }

    let currentPath: string | null = null;
    for (const [position, finding] of visible.entries()) {
      if (finding.path !== currentPath) {
        currentPath = finding.path;
        listEl.createDiv({
          cls: "adowiki-lint__file",
          text: decodePathToTitlePath(finding.path),
        });
      }
      this.renderFinding(listEl, finding, position);
    }
    this.keyboard?.endRender();
  }

  private renderFinding(listEl: HTMLElement, finding: LintFinding, position: number): void {
    const row = listEl.createDiv({
      cls: `adowiki-lint__finding adowiki-lint__finding--${finding.severity}`,
    });

    const main = row.createDiv({ cls: "adowiki-lint__finding-main" });
    main.createSpan({
      cls: `adowiki-lint__severity adowiki-lint__severity--${finding.severity}`,
      text: S.lint.severityLabel[finding.severity],
    });
    main.createSpan({ cls: "adowiki-lint__message", text: finding.message });
    main.createSpan({ cls: "adowiki-lint__where", text: `line ${finding.line + 1}` });
    main.onclick = () => void this.reveal(finding);

    if (finding.advice) {
      row.createDiv({ cls: "adowiki-lint__advice", text: finding.advice });
    }
    if (finding.fix) {
      const fix = row.createEl("button", {
        cls: "adowiki-lint__fix",
        text: `${S.lint.fix}: ${finding.fix.description}`,
      });
      fix.onclick = () => void this.applyFixes([finding]);
    }

    row.setAttribute("role", "listitem");
    // A finding has no id of its own, and rules can report the same line twice, so the key
    // carries its position — enough to hold the tab stop across a filter change or a rescan.
    this.keyboard?.register(row, `${finding.path}:${finding.line}:${finding.rule}:${position}`, {
      activate: () => void this.reveal(finding),
    });
  }

  private visibleFindings(): LintFinding[] {
    return this.minimum === "all"
      ? this.findings
      : this.findings.filter((finding) => finding.severity === this.minimum);
  }

  // ------------------------------------------------------------------ actions

  private async applyFixes(findings: LintFinding[]): Promise<void> {
    const repaired = await this.linter.fix(findings);
    new Notice(S.lint.fixedCount(repaired));
    // The offsets of everything left are stale the moment one fix lands, so re-scan rather
    // than filter: a second pass is also what applies the fixes the first one had to defer.
    await this.scan();
  }

  /** Open the page a finding is in and put the cursor on it. */
  private async reveal(finding: LintFinding): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(finding.path);
    if (!(file instanceof TFile)) return;

    await this.app.workspace.getLeaf(false).openFile(file);
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;

    const position = view.editor.offsetToPos(Math.min(finding.from, view.editor.getValue().length));
    view.editor.setCursor(position);
    view.editor.scrollIntoView({ from: position, to: position }, true);
  }
}
