/**
 * Page title ⇄ file name codec — the foundation of the whole plugin.
 *
 * Rules (docs/ADO-WIKI-FORMAT.md §2), verified against a production wiki:
 *   space → '-'   |   '-' → '%2D'   |   : * ? | " < >  →  %3A %2A %3F %7C %22 %3C %3E
 *   everything else (including & ( ) . , ' ! and unicode) is stored literally.
 *
 * Both directions are single-pass so that '-' → space and '%2D' → '-' cannot interfere.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */
import { TITLE_CHAR_TO_ESCAPE } from "../constants";

const ESCAPE_TO_TITLE_CHAR: ReadonlyMap<string, string> = new Map(
  [...TITLE_CHAR_TO_ESCAPE].map(([char, escape]) => [escape.toUpperCase(), char]),
);

const MD_EXTENSION = ".md";

/** Encode a human page title into its ADO wiki file name (without the .md extension). */
export function encodeTitle(title: string): string {
  let out = "";
  for (const ch of title) {
    if (ch === " ") {
      out += "-";
      continue;
    }
    out += TITLE_CHAR_TO_ESCAPE.get(ch) ?? ch;
  }
  return out;
}

/** Encode a title into a file name including the .md extension. */
export function encodeTitleToFileName(title: string): string {
  return encodeTitle(title) + MD_EXTENSION;
}

/**
 * Decode an ADO wiki file name (with or without .md) into its display title.
 * Unknown percent sequences are left untouched — ADO stores '%' literally.
 */
export function decodeFileName(fileName: string): string {
  const name = stripMdExtension(fileName);
  let out = "";
  for (let i = 0; i < name.length; i++) {
    const ch = name[i];
    if (ch === "%" && i + 2 < name.length) {
      const seq = ("%" + name.slice(i + 1, i + 3)).toUpperCase();
      const decoded = ESCAPE_TO_TITLE_CHAR.get(seq);
      if (decoded !== undefined) {
        out += decoded;
        i += 2;
        continue;
      }
    }
    out += ch === "-" ? " " : ch;
  }
  return out;
}

export function stripMdExtension(fileName: string): string {
  return fileName.toLowerCase().endsWith(MD_EXTENSION)
    ? fileName.slice(0, -MD_EXTENSION.length)
    : fileName;
}

/**
 * True when a title contains a '%' followed by one of our escape codes (e.g. "100%2Db").
 * ADO does not escape '%', so such a title cannot survive a round trip — callers warn.
 */
export function hasAmbiguousEscape(title: string): boolean {
  for (let i = 0; i < title.length - 2; i++) {
    if (title[i] !== "%") continue;
    if (ESCAPE_TO_TITLE_CHAR.has(("%" + title.slice(i + 1, i + 3)).toUpperCase())) return true;
  }
  return false;
}

/** 'Product-Documentation/4.-Design-%2D-Connectors.md' → 'Product Documentation/4. Design - Connectors' */
export function decodePathToTitlePath(vaultPath: string): string {
  return splitPath(vaultPath).map(decodeFileName).join("/");
}

/**
 * Vault path of a page → ADO wiki link target.
 * 'Product-Documentation/4.-Design-%2D-Connectors.md' → '/Product-Documentation/4.-Design-%2D-Connectors'
 */
export function wikiPathFromVaultPath(vaultPath: string): string {
  return "/" + splitPath(vaultPath).map(stripMdExtension).join("/");
}

/**
 * ADO wiki link target → vault path of the backing markdown file.
 * '/Product-Documentation/4.-Design-%2D-Connectors' → 'Product-Documentation/4.-Design-%2D-Connectors.md'
 */
export function vaultPathFromWikiPath(wikiPath: string): string {
  const segments = splitPath(wikiPath);
  return segments.length === 0 ? "" : segments.join("/") + MD_EXTENSION;
}

function splitPath(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}
