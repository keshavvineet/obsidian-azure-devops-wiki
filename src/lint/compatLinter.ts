import { App, Notice, TFile } from "obsidian";
import { ATTACHMENTS_DIR, MAX_ATTACHMENT_BYTES } from "../constants";
import { attachmentVaultPath, findMarkdownLinks, isExternalHref } from "../links/adoLinkResolver";
import type { AdoLinkService } from "../links/adoLinkService";
import type { PageIndex } from "../pages/pageIndex";
import type { AdoWikiSettings } from "../settings";
import { S } from "../strings";
import { applyFixes, lintDocumentOf, lintPage, sortFindings } from "./lintEngine";
import type { LintFinding, LintHost } from "./types";

/**
 * The compatibility linter's vault side (FR-8.1–8.3) — ARCHITECTURE §7.
 *
 * Everything about *what* is wrong lives in `lintEngine`/`rules`; this reads pages out of the
 * vault, adds the checks that need more than one file (attachment sizes, attachments nothing
 * references) and writes fixes back through the Vault API.
 */
export interface LintReport {
  findings: LintFinding[];
  /** Pages actually examined. */
  pagesScanned: number;
}

export class CompatLinter {
  constructor(
    private readonly app: App,
    private readonly index: PageIndex,
    private readonly links: AdoLinkService,
    private readonly settings: () => AdoWikiSettings,
  ) {}

  private get host(): LintHost {
    return {
      resolves: (href, fromPath) => {
        const resolution = this.links.resolve(href, fromPath);
        if (resolution.kind === "missing") return false;
        // An attachment resolves to a path; whether the file is there is the question.
        if (resolution.kind === "attachment") {
          return this.attachmentExists(resolution.vaultPath);
        }
        return true;
      },
      converterHost: (fromPath) => this.links.converterHost(fromPath),
    };
  }

  /** Every finding in one page. */
  async lintFile(file: TFile): Promise<LintFinding[]> {
    const text = await this.app.vault.cachedRead(file);
    const doc = lintDocumentOf(file.path, text, file.stat.size);
    return lintPage(doc, this.host, { disabled: this.settings().disabledLintRules });
  }

  /** Every finding in the whole wiki, including the checks that span files. */
  async lintVault(paths?: readonly string[]): Promise<LintReport> {
    const wanted = paths ? new Set(paths) : null;
    const pages = this.index
      .all()
      .map((entry) => entry.file)
      .filter((file) => wanted === null || wanted.has(file.path));

    const findings: LintFinding[] = [];
    for (const file of pages) {
      findings.push(...(await this.lintFile(file)));
    }

    // Attachment checks need every page's links, so they only make sense on a full scan.
    if (wanted === null) findings.push(...(await this.lintAttachments()));

    return { findings: sortFindings(findings), pagesScanned: pages.length };
  }

  /**
   * Apply the fixes of a set of findings, one file at a time.
   *
   * @returns how many findings were repaired.
   */
  async fix(findings: readonly LintFinding[]): Promise<number> {
    const byFile = new Map<string, LintFinding[]>();
    for (const finding of findings) {
      if (!finding.fix) continue;
      const list = byFile.get(finding.path);
      if (list) list.push(finding);
      else byFile.set(finding.path, [finding]);
    }

    let repaired = 0;
    for (const [path, fileFindings] of byFile) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;

      // Read fresh: a finding may have been collected before the user edited the page, and the
      // offsets in it are only meaningful against the text it was computed from.
      const current = await this.app.vault.read(file);
      const stale = fileFindings.some((finding) => !stillMatches(current, finding));
      if (stale) {
        new Notice(S.lint.staleFindings(path));
        continue;
      }

      const outcome = applyFixes(current, fileFindings);
      if (outcome.text === current) continue;
      await this.app.vault.modify(file, outcome.text);
      repaired += outcome.applied.length;
    }
    return repaired;
  }

  // ----------------------------------------------------------- attachments

  /** Attachments that are too large for Azure DevOps, and ones no page refers to. */
  private async lintAttachments(): Promise<LintFinding[]> {
    const findings: LintFinding[] = [];
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(ATTACHMENTS_DIR))) return findings;

    const listing = await adapter.list(ATTACHMENTS_DIR);
    const referenced = await this.referencedAttachments();

    for (const path of listing.files) {
      const name = path.split("/").pop() ?? path;
      const stat = await adapter.stat(path);

      if (stat && stat.size > MAX_ATTACHMENT_BYTES) {
        findings.push({
          rule: "attachment-too-large",
          severity: "error",
          message: S.lint.attachmentTooLarge(name, stat.size, MAX_ATTACHMENT_BYTES),
          path,
          from: 0,
          to: 0,
          line: 0,
          advice: S.lint.attachmentTooLargeAdvice,
        });
      }

      if (!referenced.has(path.toLowerCase())) {
        findings.push({
          rule: "orphan-attachment",
          severity: "info",
          message: S.lint.orphanAttachment(name),
          path,
          from: 0,
          to: 0,
          line: 0,
          advice: S.lint.orphanAttachmentAdvice,
        });
      }
    }

    return findings;
  }

  /** Vault paths of every attachment some page links to. */
  private async referencedAttachments(): Promise<Set<string>> {
    const referenced = new Set<string>();
    for (const entry of this.index.all()) {
      const text = await this.app.vault.cachedRead(entry.file);
      for (const link of findMarkdownLinks(text)) {
        const href = link.href.trim();
        if (href.length === 0 || isExternalHref(href) || href.startsWith("#")) continue;
        const resolution = this.links.resolve(href, entry.file.path);
        if (resolution.kind === "attachment") referenced.add(resolution.vaultPath.toLowerCase());
      }
    }
    return referenced;
  }

  private attachmentCache: Set<string> | null = null;

  private attachmentExists(vaultPath: string): boolean {
    if (this.attachmentCache === null) {
      this.attachmentCache = new Set(
        this.links.attachmentNames().map((name) => `${ATTACHMENTS_DIR}/${name}`.toLowerCase()),
      );
    }
    return this.attachmentCache.has(attachmentVaultPath(vaultPath).toLowerCase());
  }

  /** The attachment list changes on paste and on refresh; drop the cached copy. */
  invalidate(): void {
    this.attachmentCache = null;
  }
}

/** Whether a finding still describes exactly the characters it was computed from. */
function stillMatches(text: string, finding: LintFinding): boolean {
  if (finding.to > text.length) return false;
  return finding.excerpt === undefined || text.slice(finding.from, finding.to) === finding.excerpt;
}
