/**
 * Minimal method wrapper with an undo handle — the `monkey-around` pattern, inlined.
 *
 * Obsidian offers no API for tab-header titles, so `WorkspaceLeaf.getDisplayText` has to be
 * wrapped (ARCHITECTURE §4.1). This is the only place the plugin patches Obsidian, and every
 * patch must be reversible: the returned function puts the original method back, and it is
 * safe to call even if something else wrapped the same method in the meantime (in that case
 * the wrapper is left alone rather than clobbering the other plugin's patch).
 *
 * PURE MODULE — must not import from 'obsidian'.
 */

/**
 * `any` is deliberate and unavoidable: the helper wraps arbitrary host methods and must not
 * constrain their signatures. The wrapper factory receives the original, correctly typed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Patchable = (...args: any[]) => any;

export function around<K extends string, T extends Record<K, Patchable>>(
  target: T,
  method: K,
  factory: (original: T[K]) => T[K],
): () => void {
  const original = target[method];
  const patched = factory(original);
  target[method] = patched;

  return () => {
    if (target[method] === patched) target[method] = original;
  };
}
