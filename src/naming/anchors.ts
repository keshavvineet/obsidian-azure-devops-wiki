/**
 * Azure DevOps heading → anchor algorithm (SYNTAX-MAPPING §4).
 *
 * Needed whenever a heading has to become a link fragment: converting
 * `[[Page#Heading]]`, building `[[_TOC_]]`, and resolving `#anchor` links to a heading.
 *
 * The algorithm is GitHub's (`github-slugger`), in this order: trim, lowercase, drop
 * punctuation, then turn *each* remaining whitespace character into a hyphen. Both details
 * matter for the one verified example, `#### Team #1 : Release Wiki!` → `#team-1--release-wiki`:
 * punctuation is *removed* rather than replaced (or `#` and `:` would add hyphens of their
 * own), and the two spaces left around the dropped `:` each become a hyphen (so consecutive
 * hyphens survive).
 *
 * Unverified corner: a heading that *starts or ends* with punctuation followed by a space
 * ("!!! Careful !!!") yields a leading/trailing hyphen under this algorithm. Confirm against a
 * live wiki in Phase 5 (SYNTAX-MAPPING §4) before relying on it.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */

/** Characters kept in an anchor: letters and digits in any script, plus '-' and '_'. */
const KEPT_CHARS = /[\p{L}\p{N}\-_]/u;

/** `[label](target)` → `label`, so anchors are built from what the heading displays. */
const MD_LINK = /\[([^\]]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g;
/** Obsidian wikilinks inside a heading, `[[target|label]]` → the label. */
const WIKILINK = /\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g;
/** Emphasis and code markers, which the reader never sees. */
const INLINE_MARKERS = /[*`~]/g;

/**
 * The anchor for a heading, without the leading '#'.
 *
 * Accepts either the heading text or the whole markdown line (`## Heading`).
 */
export function headingToAnchor(heading: string): string {
  const text = stripInlineMarkdown(stripHeadingMarkers(heading)).trim().toLowerCase();

  let out = "";
  for (const ch of text) {
    if (/\s/u.test(ch)) out += "-";
    else if (KEPT_CHARS.test(ch)) out += ch;
  }
  return out;
}

/** The same anchor with the leading '#', ready to append to a link target. */
export function headingToFragment(heading: string): string {
  return `#${headingToAnchor(heading)}`;
}

/** Append an anchor to a wiki path, e.g. ('/A/B', 'my heading') → '/A/B#my-heading'. */
export function withAnchor(wikiPath: string, heading: string | null | undefined): string {
  if (heading === null || heading === undefined || heading.trim().length === 0) return wikiPath;
  const anchor = headingToAnchor(heading);
  return anchor.length === 0 ? wikiPath : `${wikiPath}#${anchor}`;
}

/** '## Heading  ' → 'Heading'. Closed ATX headings ('## H ##') lose their trailing run too. */
export function stripHeadingMarkers(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/\s+#+\s*$/, "")
    .trim();
}

/** Remove the markup a reader never sees, keeping link and wikilink labels. */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(MD_LINK, (_match, label: string) => label)
    .replace(WIKILINK, (_match, target: string, label?: string) => label ?? target)
    .replace(INLINE_MARKERS, "");
}
