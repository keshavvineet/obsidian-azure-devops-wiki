/**
 * What a file-explorer row should say (FR-1.1).
 *
 * Obsidian labels rows with the raw file name; the wiki stores titles encoded, so
 * `Pre%2DRelease-RCA-Categories` has to read "Pre-Release RCA Categories". This module owns
 * the decision of *whether* a row is ours to relabel and *what* the two labels are — the raw
 * one so `titleDecorator` can put it back on unload, and the decoded one to display.
 *
 * Only markdown pages and folders are relabelled. Attachments live in `.attachments`, which
 * Obsidian hides anyway, and any other file the user drops in the repo keeps its real name so
 * that what they see matches what git will commit.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */
import { decodeFileName, stripMdExtension } from "./pageNameCodec";

export type ExplorerRowKind = "file" | "folder";

/** The label Obsidian puts on the row itself: file name without the `.md` extension. */
export function rawExplorerLabel(path: string, kind: ExplorerRowKind): string {
  const name = baseNameOf(path);
  return kind === "file" ? stripMdExtension(name) : name;
}

/**
 * The decoded label for a row, or `null` when the row must keep Obsidian's own label —
 * because it is hidden, is not a page or folder, or its name needs no decoding at all.
 */
export function explorerLabel(path: string, kind: ExplorerRowKind): string | null {
  if (isHidden(path)) return null;

  const name = baseNameOf(path);
  if (kind === "file" && !name.toLowerCase().endsWith(".md")) return null;

  const raw = rawExplorerLabel(path, kind);
  const decoded = decodeFileName(raw);
  return decoded === raw ? null : decoded;
}

function baseNameOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function isHidden(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}
