/**
 * Naming files that land in `/.attachments/` (FR-3.2).
 *
 * ADO's own editor stores `<original-stem>-<guid>.<ext>` in one flat folder at the repo root,
 * so two people pasting `image.png` never collide. We copy that exactly — the file has to look
 * as if the portal wrote it (REQUIREMENTS §9.3).
 *
 * PURE MODULE — must not import from 'obsidian'.
 */
import { ATTACHMENTS_DIR } from "../constants";

/** Characters that are illegal on NTFS, plus the ones that would break a markdown link. */
const UNSAFE_STEM_CHARS = /[\\/:*?"<>|#()\s]+/g;
const FALLBACK_STEM = "image";

export interface SplitName {
  stem: string;
  /** Extension without the dot, lowercased; '' when the original had none. */
  extension: string;
}

export function splitFileName(fileName: string): SplitName {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return { stem: base, extension: "" };
  return { stem: base.slice(0, dot), extension: base.slice(dot + 1).toLowerCase() };
}

/**
 * The ADO-style attachment file name for a pasted or dropped file.
 *
 * The stem keeps the characters ADO keeps (production has `==image_0==-<guid>.png`) and loses
 * only what NTFS or a markdown destination cannot carry.
 */
export function attachmentFileName(originalName: string, uuid: string): string {
  const { stem, extension } = splitFileName(originalName);
  const safeStem = sanitizeStem(stem);
  const suffix = extension.length > 0 ? `.${extension}` : "";
  return `${safeStem}-${uuid}${suffix}`;
}

/** The vault path an attachment name lives at. */
export function attachmentPath(fileName: string): string {
  return `${ATTACHMENTS_DIR}/${fileName}`;
}

/** The ADO link destination for an attachment — root-absolute, as the portal writes it. */
export function attachmentLinkTarget(fileName: string): string {
  return `/${ATTACHMENTS_DIR}/${fileName}`;
}

/** `![name](/.attachments/name-<guid>.png)`, the markdown ADO itself would have inserted. */
export function attachmentMarkdown(originalName: string, fileName: string): string {
  const isImage = IMAGE_EXTENSIONS.has(splitFileName(fileName).extension);
  const label = splitFileName(originalName).stem.length > 0 ? originalName : fileName;
  return `${isImage ? "!" : ""}[${label}](${attachmentLinkTarget(fileName)})`;
}

export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico",
]);

/**
 * A name that is not taken yet. The guid makes a collision essentially impossible, but a
 * second paste of the same buffer in the same millisecond must still not overwrite a file.
 */
export function uniqueAttachmentName(fileName: string, taken: (name: string) => boolean): string {
  if (!taken(fileName)) return fileName;
  const { stem, extension } = splitFileName(fileName);
  const suffix = extension.length > 0 ? `.${extension}` : "";
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem}-${n}${suffix}`;
    if (!taken(candidate)) return candidate;
  }
  throw new Error(`Could not find a free attachment name for "${fileName}".`);
}

function sanitizeStem(stem: string): string {
  const safe = stem.replace(UNSAFE_STEM_CHARS, "-").replace(/^[.\-]+|[.\-]+$/g, "");
  return safe.length > 0 ? safe : FALLBACK_STEM;
}
