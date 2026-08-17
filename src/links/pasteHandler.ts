import { App, Editor, MarkdownFileInfo, Notice } from "obsidian";
import { ATTACHMENTS_DIR, MAX_ATTACHMENT_BYTES } from "../constants";
import { S } from "../strings";
import type { AdoLinkService } from "./adoLinkService";
import {
  attachmentFileName,
  attachmentMarkdown,
  attachmentPath,
  uniqueAttachmentName,
} from "./attachmentNames";

/**
 * Pasting and dropping files into a page (FR-3.2, FR-3.6).
 *
 * Obsidian's own attachment handling would put the file in the vault's attachment folder and
 * write a wikilink — neither of which exists on Azure DevOps. Every file therefore goes to the
 * flat `/.attachments/` folder under an ADO-style `<stem>-<guid>.<ext>` name, and the inserted
 * markdown is exactly what the portal would have written.
 *
 * `.attachments` starts with a dot, so the Vault API cannot see it: the writes go through
 * `vault.adapter`, the same exception `.order` already uses.
 */
export class AttachmentPasteHandler {
  constructor(
    private readonly app: App,
    private readonly links: AdoLinkService,
  ) {}

  handlePaste = (event: ClipboardEvent, editor: Editor, info: MarkdownFileInfo): void => {
    this.handleFiles(event, filesOf(event.clipboardData), editor, info);
  };

  handleDrop = (event: DragEvent, editor: Editor, info: MarkdownFileInfo): void => {
    this.handleFiles(event, filesOf(event.dataTransfer), editor, info);
  };

  /** Same attachment pipeline, for a file picked through the toolbar's image button. */
  insertFiles(files: File[], editor: Editor): Promise<void> {
    return this.storeFiles(files, editor);
  }

  private handleFiles(
    event: Event,
    files: File[],
    editor: Editor,
    info: MarkdownFileInfo,
  ): void {
    if (files.length === 0) return;
    // A paste that carries files but has no file behind the editor is none of our business.
    if (info.file === null) return;

    event.preventDefault();
    void this.storeFiles(files, editor);
  }

  private async storeFiles(files: File[], editor: Editor): Promise<void> {
    // Captured before the first await: writing files takes long enough for the cursor to move.
    const from = editor.getCursor("from");
    const snippets: string[] = [];

    for (const file of files) {
      try {
        const snippet = await this.storeFile(file);
        if (snippet !== null) snippets.push(snippet);
      } catch (error) {
        new Notice(S.notices.failed(`attach "${file.name}"`, messageOf(error)));
      }
    }
    if (snippets.length === 0) return;

    const markdown = snippets.join("\n");
    editor.replaceRange(markdown, from, editor.getCursor("to"));
    editor.setCursor(editor.offsetToPos(editor.posToOffset(from) + markdown.length));
    await this.links.reloadAttachments();
  }

  /** @returns the markdown to insert, or null when the file was rejected. */
  private async storeFile(file: File): Promise<string | null> {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      new Notice(S.notices.attachmentTooLarge(file.name, MAX_ATTACHMENT_BYTES));
      return null;
    }

    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(ATTACHMENTS_DIR))) await adapter.mkdir(ATTACHMENTS_DIR);

    // Read the folder rather than trusting the cache: the guid makes a collision practically
    // impossible, but overwriting somebody's attachment is not a risk worth carrying.
    const listing = await adapter.list(ATTACHMENTS_DIR);
    const existing = new Set(listing.files.map((path) => path.split("/").pop() ?? path));

    const proposed = attachmentFileName(file.name.length > 0 ? file.name : "image", newUuid());
    const name = uniqueAttachmentName(proposed, (candidate) => existing.has(candidate));

    await adapter.writeBinary(attachmentPath(name), await file.arrayBuffer());
    return attachmentMarkdown(file.name, name);
  }
}

/**
 * The files a paste or a drop carries.
 *
 * `DataTransfer.files` is the usual answer, but a screenshot pasted from some applications
 * arrives only as a `DataTransferItem` of kind 'file' — and when we miss it, Obsidian's own
 * handler stores it as "Pasted image ….png" in the vault root, which is not a wiki attachment
 * (one such file was found in the reference wiki clone). Both sources are read, and the same
 * file appearing in both is only counted once.
 */
function filesOf(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const files = Array.from(data.files ?? []);
  const seen = new Set(files.map(identityOf));

  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file === null || seen.has(identityOf(file))) continue;
    seen.add(identityOf(file));
    files.push(file);
  }
  return files;
}

function identityOf(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/** Full 36-character lowercase UUID, matching what the ADO editor puts in attachment names. */
function newUuid(): string {
  return crypto.randomUUID();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
