import { App, TFile } from "obsidian";
import { ATTACHMENTS_DIR } from "../constants";
import { headingToAnchor } from "../naming/anchors";
import { decodeFileName, stripMdExtension } from "../naming/pageNameCodec";
import type { PageEntry, PageIndex } from "../pages/pageIndex";
import type { AdoWikiSettings } from "../settings";
import { attachmentLinkTarget, IMAGE_EXTENSIONS, splitFileName } from "./attachmentNames";
import { resolveHref, type LinkResolution } from "./adoLinkResolver";
import type { ConverterHost, ResolvedPage } from "./linkConverter";
import { pullRequestUrl, workItemUrl } from "./inlineAdo";

/**
 * The one place the ADO link world is joined to the Obsidian one (ARCHITECTURE §4.3–4.4).
 *
 * The renderers (reading mode, live preview), the paste handler and the wikilink converter all
 * need the same four answers — where does this destination point, what is its resource URL, how
 * do I open it, and what does this page's heading/subpage list look like — so they ask here
 * instead of each growing their own copy.
 */
export class AdoLinkService {
  constructor(
    private readonly app: App,
    private readonly index: PageIndex,
    private readonly settings: () => AdoWikiSettings,
  ) {}

  // ------------------------------------------------------------------ resolving

  /** Resolve a destination found in the page at `sourcePath`. */
  resolve(href: string, sourcePath: string): LinkResolution {
    return resolveHref(href, {
      fromFolder: folderOf(sourcePath),
      lookup: this.index,
    });
  }

  /**
   * A URL Obsidian can put in `src`. Synchronous, because the renderers cannot await before
   * returning an element — a file that is not there simply shows as a broken image, exactly as
   * it would in the ADO portal.
   */
  resourcePath(vaultPath: string): string {
    return this.app.vault.adapter.getResourcePath(vaultPath);
  }

  isImagePath(vaultPath: string): boolean {
    return IMAGE_EXTENSIONS.has(splitFileName(vaultPath).extension);
  }

  /**
   * Whether an attachment link points at a file that is really in this clone.
   *
   * Azure DevOps commits every attachment into the wiki's own `.attachments` folder — there is no
   * separate URL to fall back to (Microsoft markdown guidance, verified 2026-08-10), so a file
   * that is not here is a file this clone has not pulled yet. Saying that is far more use than a
   * broken-image icon, and the renderers cannot await, so the answer comes from the folder listing
   * the service already keeps. Anything it does not track is reported as present, because "we do
   * not know" must never render as "missing".
   */
  attachmentExists(vaultPath: string): boolean {
    if (!this.attachmentsLoaded) return true;
    const prefix = `${ATTACHMENTS_DIR}/`;
    if (!vaultPath.startsWith(prefix)) return true;

    const name = vaultPath.slice(prefix.length);
    if (name.length === 0 || name.includes("/")) return true;
    // Case-insensitively: the file system this runs on usually is, and a wrongly-cased link
    // that opens fine on Windows must not be reported as a missing file.
    return this.attachmentNamesLower.has(name.toLowerCase());
  }

  // ------------------------------------------------------------------- opening

  /** Open whatever a resolved destination points at. Returns false if there is nothing to open. */
  async open(
    resolution: LinkResolution,
    sourcePath: string,
    options: { newLeaf?: boolean } = {},
  ): Promise<boolean> {
    switch (resolution.kind) {
      case "page": {
        const linkText = this.linkTextFor(resolution.vaultPath, resolution.anchor);
        await this.app.workspace.openLinkText(linkText, sourcePath, options.newLeaf ?? false);
        return true;
      }
      case "anchor": {
        const linkText = this.linkTextFor(sourcePath, resolution.anchor);
        await this.app.workspace.openLinkText(linkText, sourcePath, false);
        return true;
      }
      case "attachment": {
        if (!(await this.app.vault.adapter.exists(resolution.vaultPath))) return false;
        // Attachments are dot-path files, so Obsidian has no TFile for them to open in a leaf.
        await openWithDefaultApp(this.app, resolution.vaultPath);
        return true;
      }
      case "external":
        window.open(resolution.href, "_blank");
        return true;
      case "missing":
        return false;
    }
  }

  /**
   * Obsidian resolves a subpath by *heading text*; ADO stores the slug. Translate back through
   * the page's own headings so `…#seed-data` lands on "Seed data" instead of nowhere.
   */
  linkTextFor(vaultPath: string, anchor: string | null): string {
    if (anchor === null) return vaultPath;
    const heading = this.headingForAnchor(vaultPath, anchor);
    return `${vaultPath}#${heading ?? anchor}`;
  }

  headingForAnchor(vaultPath: string, anchor: string): string | null {
    const wanted = anchor.toLowerCase();
    for (const heading of this.headingsOf(vaultPath)) {
      if (headingToAnchor(heading.text).toLowerCase() === wanted) return heading.text;
    }
    return null;
  }

  // -------------------------------------------------------------- page content

  /** Headings of a page, in document order — the input for `[[_TOC_]]` (FR-4.1). */
  headingsOf(vaultPath: string): Array<{ text: string; level: number }> {
    const file = this.app.vault.getAbstractFileByPath(vaultPath);
    if (!(file instanceof TFile)) return [];
    const headings = this.app.metadataCache.getFileCache(file)?.headings ?? [];
    return headings.map((heading) => ({ text: heading.heading, level: heading.level }));
  }

  /** Subpages of a page in `.order` sequence — the input for `[[_TOSP_]]` (FR-4.2). */
  subpagesOf(vaultPath: string): PageEntry[] {
    const entry = this.index.forPath(vaultPath);
    return entry ? this.index.childrenOf(entry) : [];
  }

  entryFor(vaultPath: string): PageEntry | null {
    return this.index.forPath(vaultPath);
  }

  // ------------------------------------------------------------- work items

  workItemHref(id: string): string | null {
    const { organizationUrl, project } = this.settings();
    return workItemUrl(organizationUrl, project, id);
  }

  pullRequestHref(id: string): string | null {
    const { organizationUrl, project } = this.settings();
    return pullRequestUrl(organizationUrl, project, id);
  }

  // ------------------------------------------------------- wikilink conversion

  /**
   * The converter's view of the vault for a page in `sourcePath`.
   *
   * Targets are tried the way Obsidian produces them (a vault path from autocomplete) and the
   * way a human types them (a page title), and only an attachment that is already in
   * `.attachments` can be embedded — moving files is the user's decision, not ours.
   */
  converterHost(sourcePath: string): ConverterHost {
    const fromFolder = folderOf(sourcePath);
    return {
      resolvePage: (target) => this.resolvePageTarget(target, fromFolder),
      resolveAttachment: (target) => {
        const name = target.split("/").pop() ?? target;
        const inAttachments = this.attachmentNames().find(
          (existing) => existing.toLowerCase() === name.toLowerCase(),
        );
        return inAttachments ? { linkTarget: attachmentLinkTarget(inAttachments) } : null;
      },
    };
  }

  private resolvePageTarget(target: string, fromFolder: string): ResolvedPage | null {
    const asPath = resolveHref(target, { fromFolder, lookup: this.index });
    if (asPath.kind === "page") {
      const entry = this.index.forPath(asPath.vaultPath);
      if (entry) return { wikiPath: entry.wikiPath, title: entry.title };
    }

    const segment = target.split("/").pop() ?? target;
    // A wikilink target can be a title as typed ('3.3.1 Display - Basic'), the last segment of a
    // title path, or an encoded file name. Decoding is tried *last*: applied to a real title it
    // would turn the hyphen in 'Display - Basic' into spaces and find nothing.
    for (const candidate of unique([target, segment, decodeFileName(segment)])) {
      const matches = this.index.forTitle(candidate);
      if (matches.length === 0) continue;
      const match =
        matches.find((entry) => entry.titlePath === target) ??
        // Two pages can share a title in different folders; the nearest one is the better guess.
        matches.find((entry) => entry.folderPath === fromFolder) ??
        matches[0];
      return { wikiPath: match.wikiPath, title: match.title };
    }
    return null;
  }

  /** Attachment file names on disk. `.attachments` is a dot-path, so the Vault API cannot list it. */
  attachmentNames(): string[] {
    return this.cachedAttachmentNames;
  }

  private cachedAttachmentNames: string[] = [];
  private attachmentNamesLower = new Set<string>();
  /** False until the first listing has been read — see `attachmentExists`. */
  private attachmentsLoaded = false;

  /** Refresh the attachment list; called at start-up and after a paste or a refresh. */
  async reloadAttachments(): Promise<void> {
    try {
      if (!(await this.app.vault.adapter.exists(ATTACHMENTS_DIR))) {
        this.setAttachmentNames([]);
        return;
      }
      const listing = await this.app.vault.adapter.list(ATTACHMENTS_DIR);
      this.setAttachmentNames(listing.files.map((path) => path.split("/").pop() ?? path));
    } catch {
      // A folder we cannot list is not a folder we can make claims about (see attachmentExists).
      this.cachedAttachmentNames = [];
      this.attachmentNamesLower = new Set();
      this.attachmentsLoaded = false;
    }
  }

  private setAttachmentNames(names: string[]): void {
    this.cachedAttachmentNames = names;
    this.attachmentNamesLower = new Set(names.map((name) => name.toLowerCase()));
    this.attachmentsLoaded = true;
  }
}

/** Opens a file with the operating system's default application (not in the typings). */
async function openWithDefaultApp(app: App, vaultPath: string): Promise<void> {
  const opener = (app as unknown as { openWithDefaultApp?(path: string): Promise<void> })
    .openWithDefaultApp;
  if (opener) await opener.call(app, vaultPath);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

export function folderOf(vaultPath: string): string {
  const slash = vaultPath.lastIndexOf("/");
  return slash === -1 ? "" : vaultPath.slice(0, slash);
}

/** The folder a page's subpages live in — its own name without '.md'. */
export function pairedFolderOf(vaultPath: string): string {
  return stripMdExtension(vaultPath);
}
