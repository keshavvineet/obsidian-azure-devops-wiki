/**
 * Markdown link-destination rewriting, used when a page is renamed (FR-1.3).
 *
 * Only the destination inside `](...)` is touched, and never inside fenced or inline code —
 * a rename must not silently edit a code sample that happens to contain a wiki path.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */

export interface LinkReplacement {
  /** Destination to match, e.g. '/Product-Documentation' or 'Old-Page.md'. */
  from: string;
  /** Replacement destination, e.g. '/Product-Docs'. */
  to: string;
}

export interface RewriteResult {
  content: string;
  /** Number of destinations rewritten. */
  count: number;
}

/** Matches the `](destination "optional title")` tail of a markdown link or image. */
const LINK_TAIL = /\]\(\s*(<[^>\n]*>|[^()\s]+)((?:\s+(?:"[^"]*"|'[^']*'))?\s*)\)/g;

export function rewriteLinkTargets(
  content: string,
  replacements: readonly LinkReplacement[],
): RewriteResult {
  if (replacements.length === 0) return { content, count: 0 };

  const codeRanges = findCodeRanges(content);
  let count = 0;

  const rewritten = content.replace(
    LINK_TAIL,
    (match, rawDestination: string, titlePart: string, offset: number) => {
      if (isInRanges(offset, codeRanges)) return match;

      const angled = rawDestination.startsWith("<") && rawDestination.endsWith(">");
      const destination = angled ? rawDestination.slice(1, -1) : rawDestination;

      const next = applyReplacements(destination, replacements);
      if (next === null) return match;

      count++;
      return `](${angled ? `<${next}>` : next}${titlePart})`;
    },
  );

  return { content: rewritten, count };
}

/** Returns the rewritten destination, or null when nothing matched. */
function applyReplacements(
  destination: string,
  replacements: readonly LinkReplacement[],
): string | null {
  for (const { from, to } of replacements) {
    if (destination === from) return to;
    // A renamed parent page moves its subpages too: /Old/Child → /New/Child.
    if (destination.startsWith(`${from}/`)) return to + destination.slice(from.length);
    // Preserve anchors: /Old#section → /New#section.
    if (destination.startsWith(`${from}#`)) return to + destination.slice(from.length);
  }
  return null;
}

/** Character ranges occupied by fenced code blocks and inline code spans. */
export function findCodeRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  // Fenced blocks first — an inline-looking backtick run inside one must not be re-detected.
  let position = 0;
  let openFence: { marker: string; length: number; start: number } | null = null;
  for (const line of content.split(/(?<=\n)/)) {
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const length = fence[1].length;
      if (openFence === null) {
        openFence = { marker, length, start: position };
      } else if (marker === openFence.marker && length >= openFence.length) {
        ranges.push([openFence.start, position + line.length]);
        openFence = null;
      }
    }
    position += line.length;
  }
  if (openFence !== null) ranges.push([openFence.start, content.length]);

  // Inline code spans outside those blocks.
  const inline = /(`+)(?:[\s\S]*?)\1/g;
  let match: RegExpExecArray | null;
  while ((match = inline.exec(content)) !== null) {
    if (isInRanges(match.index, ranges)) continue;
    ranges.push([match.index, match.index + match[0].length]);
  }

  return ranges.sort((a, b) => a[0] - b[0]);
}

function isInRanges(index: number, ranges: ReadonlyArray<[number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

/**
 * Replacements needed when a page moves from one wiki path to another. Subpage paths are
 * handled by prefix matching, so only the page's own path is listed here.
 */
export function buildRenameReplacements(
  oldWikiPath: string,
  newWikiPath: string,
  options: { oldFileName?: string; newFileName?: string } = {},
): LinkReplacement[] {
  const replacements: LinkReplacement[] = [{ from: oldWikiPath, to: newWikiPath }];

  // Relative links used by pages in the same folder, e.g. [x](Old-Page.md).
  if (options.oldFileName && options.newFileName) {
    replacements.push({ from: options.oldFileName, to: options.newFileName });
    replacements.push({ from: `./${options.oldFileName}`, to: `./${options.newFileName}` });
  }

  return replacements;
}
