import { App, Editor, MarkdownFileInfo, Notice, TFile } from "obsidian";
import type { AdoWikiSettings } from "../settings";
import { S } from "../strings";
import type { AdoLinkService } from "./adoLinkService";
import { convertWikilinks, wikilinkEndingAt, type ConversionResult } from "./linkConverter";

/**
 * Keeping Obsidian's wikilinks out of the wiki (FR-3.4, FR-3.5).
 *
 * `[[Page]]` is literal text on Azure DevOps, so the moment Obsidian's autocomplete completes
 * one it is rewritten to `[Page](/Path/To/Page)`. A wikilink we cannot resolve is left exactly
 * as the user typed it: converting it would mean inventing a path, and a wrong link that renders
 * is worse than a wikilink the Phase 6 linter can point at.
 *
 * `wikilinkConversion` chooses when this happens:
 *   'insert' — as the link is completed (default)
 *   'save'   — when the page stops being the active one
 *   'off'    — never; the commands below still work on demand
 */
export class WikilinkInterceptor {
  /** The file a 'save'-mode conversion applies to when the user switches away from it. */
  private lastActiveFile: TFile | null = null;

  constructor(
    private readonly app: App,
    private readonly links: AdoLinkService,
    private readonly settings: () => AdoWikiSettings,
  ) {}

  // ------------------------------------------------------------ insert-time

  handleEditorChange = (editor: Editor, info: MarkdownFileInfo): void => {
    if (this.settings().wikilinkConversion !== "insert") return;
    const file = info.file;
    if (file === null) return;

    const cursor = editor.getCursor();
    const upToCursor = editor.getLine(cursor.line).slice(0, cursor.ch);
    if (!upToCursor.endsWith("]]")) return;
    if (this.isInCodeBlock(file, cursor.line)) return;

    const link = wikilinkEndingAt(upToCursor, upToCursor.length);
    if (!link) return;

    const result = convertWikilinks(link.raw, this.links.converterHost(file.path));
    if (result.count === 0) return;

    editor.replaceRange(
      result.content,
      { line: cursor.line, ch: link.start },
      { line: cursor.line, ch: link.end },
    );
  };

  /**
   * Obsidian has no "file saved" event, so 'save' mode converts when the page stops being the
   * active one — which is also when the user has stopped typing in it.
   */
  handleActiveLeafChange = (): void => {
    const previous = this.lastActiveFile;
    this.lastActiveFile = this.app.workspace.getActiveFile();
    if (this.settings().wikilinkConversion !== "save") return;
    if (previous === null || previous === this.lastActiveFile) return;

    void this.convertFile(previous, { silent: true });
  };

  // --------------------------------------------------------------- commands

  /** FR-3.5, current page. */
  async convertActivePage(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (file === null || file.extension !== "md") {
      new Notice(S.notices.noActivePage);
      return;
    }
    const result = await this.convertFile(file, { silent: false });
    if (result === null) return;
    new Notice(
      summaryOf({
        converted: result.count,
        skipped: result.skipped.length,
        droppedBlockRefs: result.droppedBlockRefs,
        files: result.count > 0 ? 1 : 0,
      }),
    );
  }

  /** FR-3.5, whole vault. */
  async convertVault(): Promise<void> {
    const totals = { converted: 0, skipped: 0, droppedBlockRefs: 0, files: 0 };

    for (const file of this.app.vault.getMarkdownFiles()) {
      const result = await this.convertFile(file, { silent: true });
      if (result === null) continue;
      totals.skipped += result.skipped.length;
      if (result.count === 0) continue;
      totals.converted += result.count;
      totals.droppedBlockRefs += result.droppedBlockRefs;
      totals.files++;
    }

    new Notice(summaryOf(totals));
  }

  private async convertFile(
    file: TFile,
    options: { silent: boolean },
  ): Promise<ConversionResult | null> {
    try {
      const content = await this.app.vault.read(file);
      const result = convertWikilinks(content, this.links.converterHost(file.path));
      if (result.count > 0) await this.app.vault.modify(file, result.content);
      return result;
    } catch (error) {
      if (!options.silent) {
        new Notice(S.notices.failed("convert the links", messageOf(error)));
      }
      return null;
    }
  }

  // ---------------------------------------------------------------- helpers

  /**
   * A wikilink inside a fenced code block is a code sample. The metadata cache's section list is
   * what CLAUDE.md prescribes for this, and it is accurate for fences that already existed when
   * the user started typing inside them.
   */
  private isInCodeBlock(file: TFile, line: number): boolean {
    const sections = this.app.metadataCache.getFileCache(file)?.sections ?? [];
    return sections.some(
      (section) =>
        section.type === "code" &&
        line >= section.position.start.line &&
        line <= section.position.end.line,
    );
  }
}

interface ConversionTotals {
  converted: number;
  skipped: number;
  droppedBlockRefs: number;
  files: number;
}

function summaryOf(totals: ConversionTotals): string {
  if (totals.converted === 0) {
    return totals.skipped === 0
      ? S.notices.noWikilinks
      : S.notices.wikilinksUnresolved(totals.skipped);
  }
  const parts = [S.notices.wikilinksConverted(totals.converted, totals.files)];
  if (totals.skipped > 0) parts.push(S.notices.wikilinksUnresolved(totals.skipped));
  if (totals.droppedBlockRefs > 0) {
    parts.push(S.notices.blockRefsDropped(totals.droppedBlockRefs));
  }
  return parts.join(" ");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
