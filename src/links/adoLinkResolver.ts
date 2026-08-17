/**
 * Resolving Azure DevOps link destinations to something Obsidian can open (FR-3.1, FR-3.3).
 *
 * ADO stores links root-absolute against the repository root — `/Parent-Page/Child-Page` for a
 * page, `/.attachments/image-<guid>.png` for an attachment — and the vault root *is* that
 * repository root, so resolution is a path calculation plus one index lookup.
 *
 * Page lookup goes through a `PageLookup` (structurally satisfied by `PageIndex`), which keeps
 * this module pure and testable. Case-exact wins; a case-insensitive match is the fallback,
 * because a hand-written link often gets the casing wrong while the file name is authoritative.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */
import { ATTACHMENTS_DIR } from "../constants";
import { stripMdExtension } from "../naming/pageNameCodec";

export interface PageLookup {
  /** Resolve an ADO page target such as '/Parent/Child'. */
  forWikiPath(wikiPath: string): { file: { path: string } } | null;
}

export interface ParsedHref {
  /** Destination without the fragment, e.g. '/Parent/Child'. */
  path: string;
  /** Fragment without the '#', or null when the link has none. */
  anchor: string | null;
}

export type LinkResolution =
  /** http(s), mailto:, obsidian: … — left to the platform. */
  | { kind: "external"; href: string }
  /** '#some-heading' — a jump inside the current page. */
  | { kind: "anchor"; anchor: string }
  /** A file under '/.attachments/'. */
  | { kind: "attachment"; vaultPath: string }
  /** A wiki page that exists in the vault. */
  | { kind: "page"; vaultPath: string; anchor: string | null }
  /** Shaped like a wiki target, but nothing in the vault matches it. */
  | { kind: "missing"; target: string; anchor: string | null };

const EXTERNAL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Split a markdown destination into its path and fragment. */
export function parseHref(href: string): ParsedHref {
  const trimmed = unwrapAngles(href.trim());
  const hash = trimmed.indexOf("#");
  if (hash === -1) return { path: trimmed, anchor: null };
  return {
    path: trimmed.slice(0, hash),
    anchor: trimmed.slice(hash + 1).length > 0 ? trimmed.slice(hash + 1) : null,
  };
}

export function isExternalHref(href: string): boolean {
  const trimmed = unwrapAngles(href.trim());
  return EXTERNAL_SCHEME.test(trimmed) || trimmed.startsWith("//");
}

/** True for '/.attachments/x.png' and the relative form '.attachments/x.png'. */
export function isAttachmentHref(href: string): boolean {
  const path = attachmentVaultPath(href);
  return path === ATTACHMENTS_DIR || path.startsWith(`${ATTACHMENTS_DIR}/`);
}

/**
 * Resolve a destination found in a page.
 *
 * @param href the raw destination text, exactly as stored in the file.
 * @param context the folder the *linking* page sits in (for relative links) and the index.
 */
export function resolveHref(
  href: string,
  context: { fromFolder: string; lookup: PageLookup },
): LinkResolution {
  const raw = unwrapAngles(href.trim());
  if (raw.length === 0) return { kind: "missing", target: href, anchor: null };
  if (isExternalHref(raw)) return { kind: "external", href: raw };

  const { path, anchor } = parseHref(raw);
  if (path.length === 0) {
    return anchor === null
      ? { kind: "missing", target: raw, anchor: null }
      : { kind: "anchor", anchor };
  }

  if (isAttachmentHref(path)) {
    return { kind: "attachment", vaultPath: attachmentVaultPath(path) };
  }

  for (const candidate of pageCandidates(path, context.fromFolder)) {
    const entry = context.lookup.forWikiPath(candidate);
    if (entry) return { kind: "page", vaultPath: entry.file.path, anchor };
  }
  return { kind: "missing", target: path, anchor };
}

/** '/.attachments/image-<guid>.png' → '.attachments/image-<guid>.png' (a vault-relative path). */
export function attachmentVaultPath(href: string): string {
  return decodeHrefPath(parseHref(href).path).replace(/^\/+/, "");
}

/**
 * Wiki paths worth trying for a destination, best first.
 *
 * Percent-escapes in an ADO file name are part of the name (`%2D` *is* two characters on disk),
 * so the raw form is always tried first; the decoded form is only a fallback for links that
 * were written by a tool which URL-encoded them (`%20` for a literal space, seen in the wild).
 */
export function pageCandidates(path: string, fromFolder: string): string[] {
  const candidates: string[] = [];
  for (const variant of [path, decodeHrefPath(path)]) {
    const absolute = variant.startsWith("/")
      ? normalizeSegments(variant)
      : normalizeSegments(`${fromFolder}/${variant}`);
    if (absolute !== null && !candidates.includes(absolute)) candidates.push(absolute);
  }
  return candidates;
}

/** Resolve '.', '..' and a trailing '.md' into a clean '/A/B' wiki path; null if it escapes the root. */
function normalizeSegments(path: string): string | null {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      // A link that climbs above the wiki root cannot be resolved inside the vault.
      if (out.pop() === undefined) return null;
      continue;
    }
    out.push(segment);
  }
  if (out.length === 0) return null;
  out[out.length - 1] = stripMdExtension(out[out.length - 1]);
  return `/${out.join("/")}`;
}

function unwrapAngles(href: string): string {
  return href.startsWith("<") && href.endsWith(">") ? href.slice(1, -1) : href;
}

/** Percent-decode a destination, tolerating the stray '%' that ADO stores literally. */
function decodeHrefPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** Matches a markdown link/image so a click can be traced back to its destination. */
const LINK_PATTERN = /(!?)\[([^\]\n]*)\]\(\s*(<[^>\n]*>|[^()\s]*)((?:\s+(?:"[^"]*"|'[^']*'))?\s*)\)/g;

export interface MarkdownLinkMatch {
  /** Offset of the '[' (or '!' for an image) in the searched text. */
  start: number;
  /** Offset just past the closing ')'. */
  end: number;
  isImage: boolean;
  text: string;
  href: string;
  /** Offsets of the destination itself, for decorating just that part. */
  hrefStart: number;
  hrefEnd: number;
}

/** Every markdown link/image in a piece of text, in order. */
export function findMarkdownLinks(text: string): MarkdownLinkMatch[] {
  const matches: MarkdownLinkMatch[] = [];
  for (const match of text.matchAll(LINK_PATTERN)) {
    const [whole, bang, label, rawHref] = match;
    const start = match.index ?? 0;
    const hrefStart = start + whole.indexOf(`](`, bang.length + label.length) + 2;
    matches.push({
      start,
      end: start + whole.length,
      isImage: bang === "!",
      text: label,
      href: unwrapAngles(rawHref),
      hrefStart,
      hrefEnd: hrefStart + rawHref.length,
    });
  }
  return matches;
}

/** The markdown link containing an offset, if any — how a click finds its destination. */
export function findMarkdownLinkAt(text: string, offset: number): MarkdownLinkMatch | null {
  return findMarkdownLinks(text).find((m) => offset >= m.start && offset <= m.end) ?? null;
}
