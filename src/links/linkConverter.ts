/**
 * Obsidian wikilink → Azure DevOps link (FR-3.4, FR-3.5).
 *
 * ADO renders `[[Page]]` as literal text, so a wikilink must become a real markdown link before
 * it reaches the wiki. The conversion happens the moment the link is written (insert-time) and
 * in bulk on demand — never as a background sweep, and never for anything it cannot resolve:
 * a wikilink left standing is visible to the user and to the Phase 6 linter, whereas a link
 * pointed at a guessed path is a silent lie.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */
import { withAnchor } from "../naming/anchors";
import { findCodeRanges } from "./linkTargets";

export interface ParsedWikilink {
  /** Offset of the '[[' (or the '!' of an embed). */
  start: number;
  /** Offset just past the ']]'. */
  end: number;
  raw: string;
  isEmbed: boolean;
  /** Link target as written, e.g. 'Product-Documentation/Overview'. */
  target: string;
  /** Heading part of `[[Page#Heading]]`, or null. */
  heading: string | null;
  /** Block reference of `[[Page#^id]]` — no ADO equivalent. */
  blockRef: string | null;
  /** Display text after the pipe, or null. */
  alias: string | null;
}

export interface ResolvedPage {
  /** ADO link target, e.g. '/Product-Documentation/Overview'. */
  wikiPath: string;
  /** Decoded page title, used as the link text when the wikilink has no alias. */
  title: string;
}

export interface ConverterHost {
  /** Resolve a wikilink target to a page, or null when the vault has no such page. */
  resolvePage(target: string): ResolvedPage | null;
  /**
   * Resolve an embed target to an attachment already in `.attachments`, or null.
   * SYNTAX-MAPPING §1: an embed of a file elsewhere in the vault is *not* converted, because
   * making the link correct would mean moving the file.
   */
  resolveAttachment(target: string): { linkTarget: string } | null;
}

export type ConversionReason =
  | "unresolved-page"
  | "unresolved-attachment"
  /** `![[Some Page]]` — ADO has no page transclusion, so only a human can decide. */
  | "note-embed";

export interface ConversionSkip {
  link: ParsedWikilink;
  reason: ConversionReason;
}

export interface ConversionResult {
  content: string;
  /** Wikilinks converted. */
  count: number;
  /** Wikilinks deliberately left as they were, with the reason. */
  skipped: ConversionSkip[];
  /** Converted links whose block reference had to be dropped (no ADO equivalent). */
  droppedBlockRefs: number;
}

/** `[[target#heading|alias]]`, optionally preceded by '!' for an embed. */
const WIKILINK = /(!?)\[\[([^\][\n|]*)(?:\|([^\]\n]*))?\]\]/g;

export function findWikilinks(text: string): ParsedWikilink[] {
  const codeRanges = findCodeRanges(text);
  const links: ParsedWikilink[] = [];

  for (const match of text.matchAll(WIKILINK)) {
    const [raw, bang, rawTarget, alias] = match;
    const start = match.index ?? 0;
    if (isInRanges(start, codeRanges)) continue;

    const { target, heading, blockRef } = splitTarget(rawTarget);
    links.push({
      start,
      end: start + raw.length,
      raw,
      isEmbed: bang === "!",
      target,
      heading,
      blockRef,
      alias: alias ?? null,
    });
  }
  return links;
}

/** The wikilink that ends exactly at `offset` — how insert-time conversion is triggered. */
export function wikilinkEndingAt(text: string, offset: number): ParsedWikilink | null {
  return findWikilinks(text).find((link) => link.end === offset) ?? null;
}

/**
 * The ADO markdown for one wikilink, or null when it must be left alone.
 * `[[_TOC_]]` and `[[_TOSP_]]` are ADO's own syntax and are never touched.
 */
export function convertWikilink(
  link: ParsedWikilink,
  host: ConverterHost,
): { text: string; droppedBlockRef: boolean } | { skip: ConversionReason } | null {
  if (isAdoMacro(link.target)) return null;

  if (link.isEmbed) {
    const attachment = host.resolveAttachment(link.target);
    if (attachment) {
      const label = link.alias ?? link.target;
      return { text: `![${label}](${attachment.linkTarget})`, droppedBlockRef: false };
    }
    // A page embed is not an attachment we can point at — leave it for the user/linter.
    return { skip: host.resolvePage(link.target) ? "note-embed" : "unresolved-attachment" };
  }

  // `[[#Heading]]` links inside the current page — an anchor is all ADO needs.
  if (link.target.length === 0 && link.heading !== null) {
    return {
      text: `[${link.alias ?? link.heading}](${withAnchor("", link.heading)})`,
      droppedBlockRef: false,
    };
  }

  const page = host.resolvePage(link.target);
  if (!page) return { skip: "unresolved-page" };

  const target = withAnchor(page.wikiPath, link.heading);
  const label = link.alias ?? defaultLabel(page.title, link.heading);
  return { text: `[${label}](${target})`, droppedBlockRef: link.blockRef !== null };
}

/** Convert every convertible wikilink in a document, leaving the rest untouched. */
export function convertWikilinks(content: string, host: ConverterHost): ConversionResult {
  const links = findWikilinks(content);
  if (links.length === 0) {
    return { content, count: 0, skipped: [], droppedBlockRefs: 0 };
  }

  let out = "";
  let cursor = 0;
  let count = 0;
  let droppedBlockRefs = 0;
  const skipped: ConversionSkip[] = [];

  for (const link of links) {
    const converted = convertWikilink(link, host);
    if (converted === null) continue;
    if ("skip" in converted) {
      skipped.push({ link, reason: converted.skip });
      continue;
    }
    out += content.slice(cursor, link.start) + converted.text;
    cursor = link.end;
    count++;
    if (converted.droppedBlockRef) droppedBlockRefs++;
  }

  return { content: out + content.slice(cursor), count, skipped, droppedBlockRefs };
}

/** `[[_TOC_]]` / `[[_TOSP_]]` — ADO macros that only look like wikilinks. */
export function isAdoMacro(target: string): boolean {
  return /^_(TOC|TOSP)_$/.test(target.trim());
}

/** 'Page › Heading' when a heading was linked, so the reader keeps the context ADO drops. */
function defaultLabel(title: string, heading: string | null): string {
  return heading === null ? title : `${title} › ${heading}`;
}

function splitTarget(rawTarget: string): {
  target: string;
  heading: string | null;
  blockRef: string | null;
} {
  const hash = rawTarget.indexOf("#");
  if (hash === -1) return { target: rawTarget.trim(), heading: null, blockRef: null };

  const target = rawTarget.slice(0, hash).trim();
  const fragment = rawTarget.slice(hash + 1).trim();
  return fragment.startsWith("^")
    ? { target, heading: null, blockRef: fragment.slice(1) }
    : { target, heading: fragment.length > 0 ? fragment : null, blockRef: null };
}

function isInRanges(index: number, ranges: ReadonlyArray<[number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}
