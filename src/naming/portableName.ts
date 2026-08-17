/**
 * Whether a file or folder name is one Azure DevOps can turn back into a page title.  [PURE]
 *
 * Confirmed from a real failure (PLAN note 12): a page created as `7.4 New Test Page.md` — with
 * literal spaces, which is what Obsidian's own "New note" writes — shows in the portal as
 * *"Could not load the page. Either the page's title or any of its ancestor page's title does not
 * conform to Wiki standards."* The wiki's own encoding is a space-free `7.4-New-Test-Page.md`
 * (ADO-WIKI-FORMAT §2).
 *
 * The test is a round trip: decode the name to a title, encode it again, and compare. That way
 * this module has no list of its own to keep in step with the codec — if the codec changes, this
 * changes with it.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */
import { decodeFileName, encodeTitle, stripMdExtension } from "./pageNameCodec";

export type NameKind = "page" | "folder";

/**
 * The Azure DevOps-portable form of a name, or null when it already is one.
 *
 * @param name a single path segment — a file name with its `.md`, or a folder name.
 */
export function portableName(name: string, kind: NameKind): string | null {
  const stem = kind === "page" ? stripMdExtension(name) : name;
  if (stem.length === 0) return null;

  const roundTripped = encodeTitle(decodeFileName(stem));
  if (roundTripped === stem) return null;
  return kind === "page" ? `${roundTripped}.md` : roundTripped;
}

export interface NonPortableSegment {
  /** The segment as it is on disk. */
  name: string;
  /** What it would have to be called for Azure DevOps to load the page. */
  suggestion: string;
  kind: NameKind;
  /** True for the page's own file name; false for a folder along its path. */
  isPage: boolean;
  /**
   * The segment's own vault path, i.e. the path up to and including it.
   *
   * A folder is repaired by renaming the page that owns it (`${path}.md`), never the page that
   * merely sits under it — so the offer attached to the message needs to know which folder,
   * not just which name.
   */
  path: string;
}

/**
 * Every segment of a page's vault path that Azure DevOps cannot decode — the page's own file
 * name *and* the folders above it, because the portal's message names either as the cause.
 */
export function nonPortableSegments(vaultPath: string): NonPortableSegment[] {
  const segments = vaultPath.split("/");
  const problems: NonPortableSegment[] = [];

  segments.forEach((segment, index) => {
    const isPage = index === segments.length - 1;
    const kind: NameKind = isPage ? "page" : "folder";
    const suggestion = portableName(segment, kind);
    if (suggestion === null) return;
    const path = segments.slice(0, index + 1).join("/");
    problems.push({ name: segment, suggestion, kind, isPage, path });
  });

  return problems;
}
