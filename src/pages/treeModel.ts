/**
 * Shape and reordering arithmetic for the wiki tree (FR-2.3).
 *
 * Kept generic over the item type so it holds no Obsidian or index knowledge: `wikiTreeView`
 * supplies pages from `pageIndex`, tests supply plain objects. The reorder helpers work on
 * sequences of page names — exactly what a `.order` file holds — so what the user arranges in
 * the tree is what gets written, with no index arithmetic in between.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */

export interface WikiTreeNode<T> {
  item: T;
  /** 0 for a root page; each level of subpages adds one. */
  depth: number;
  hasChildren: boolean;
  /** Subpages — populated only while the node is expanded. */
  children: WikiTreeNode<T>[];
}

export interface TreeShape<T> {
  /** Pages directly inside a folder, in display sequence. `''` is the wiki root. */
  pagesIn(folderPath: string): readonly T[];
  /** The paired folder that holds a page's subpages. */
  subfolderOf(item: T): string;
  isExpanded(item: T): boolean;
}

/** Build the visible tree: every root page, and the subpages of expanded pages. */
export function buildWikiTree<T>(shape: TreeShape<T>): WikiTreeNode<T>[] {
  const build = (items: readonly T[], depth: number): WikiTreeNode<T>[] =>
    items.map((item) => {
      const children = shape.pagesIn(shape.subfolderOf(item));
      return {
        item,
        depth,
        hasChildren: children.length > 0,
        children: shape.isExpanded(item) ? build(children, depth + 1) : [],
      };
    });

  return build(shape.pagesIn(""), 0);
}

/** Depth-first walk of a built tree, in the order the rows appear on screen. */
export function flattenTree<T>(nodes: readonly WikiTreeNode<T>[]): WikiTreeNode<T>[] {
  const flat: WikiTreeNode<T>[] = [];
  for (const node of nodes) {
    flat.push(node);
    flat.push(...flattenTree(node.children));
  }
  return flat;
}

export type DropPlace = "before" | "after";

/**
 * The sequence after dropping `name` before or after `target`.
 * `null` when the drop changes nothing — the caller then writes no file at all.
 */
export function namesWithDrop(
  names: readonly string[],
  name: string,
  target: string,
  place: DropPlace,
): string[] | null {
  if (name === target) return null;
  const from = names.indexOf(name);
  const over = names.indexOf(target);
  if (from === -1 || over === -1) return null;

  const rest = names.filter((entry) => entry !== name);
  const at = rest.indexOf(target) + (place === "after" ? 1 : 0);
  const moved = [...rest.slice(0, at), name, ...rest.slice(at)];

  return sameSequence(names, moved) ? null : moved;
}

/**
 * The sequence after nudging `name` by `delta` positions (the keyboard path to reordering).
 * `null` when it is already at that end of the list.
 */
export function namesWithOffset(
  names: readonly string[],
  name: string,
  delta: number,
): string[] | null {
  const from = names.indexOf(name);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= names.length) return null;

  const moved = names.filter((entry) => entry !== name);
  moved.splice(to, 0, name);
  return moved;
}

function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}
