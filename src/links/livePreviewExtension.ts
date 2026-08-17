import { syntaxTree } from "@codemirror/language";
import {
  Prec,
  RangeSetBuilder,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { headingToAnchor, stripInlineMarkdown } from "../naming/anchors";
import type { AdoWikiSettings } from "../settings";
import { S } from "../strings";
import type { AdoLinkService } from "./adoLinkService";
import { findMarkdownLinkAt, findMarkdownLinks } from "./adoLinkResolver";
import {
  findRenderableBlocks,
  headingsInMarkdown,
  type DocHeading,
  type RenderableBlock,
} from "./documentBlocks";
import { findInlineTokens, mentionLabel } from "./inlineAdo";

/**
 * Live-preview rendering of ADO syntax (ARCHITECTURE §4.4).
 *
 * Live preview never produces the HTML the reading-mode processor rewrites, so everything has to
 * be done with CodeMirror decorations:
 *  - `[[_TOC_]]` / `[[_TOSP_]]` on their own line become the **generated list**, not a chip,
 *  - `::: mermaid` renders through Obsidian's own Mermaid pipeline; `::: video` /
 *    `::: query-table` become placeholder cards,
 *  - a root-absolute image alone on a line renders as the picture,
 *  - `#123` / `!123` get a link style and a mod-click handler; `@<…>` becomes a chip, because the
 *    markdown highlighter reads it as an HTML tag and would split a mark across its tokens,
 *  - mod-clicking a `/Parent/Child` link opens the page instead of the browser.
 *
 * Three rules make this reliable:
 *
 * 1. **Whole-line constructs are replaced by *block* decorations.** Obsidian's own live preview
 *    already puts inline decorations on `[[_TOC_]]` and on `![…](…)`; where two inline
 *    replacements cover the same text, CodeMirror keeps the one from the earlier extension and
 *    ours silently loses — which is exactly why the chip and the image never appeared. A block
 *    decoration sorts far ahead of any inline one, so it always wins.
 * 2. **Block decorations come from a `StateField`, never from the `ViewPlugin`** — see
 *    {@link blockDecorationField}. Getting this wrong does not degrade rendering, it stops the
 *    page opening at all.
 * 3. **The extension is registered at `Prec.highest`,** so where an inline decoration of ours does
 *    compete with Obsidian's, ours is the earlier one.
 *
 * Nothing inside code blocks, inline code, frontmatter or math is touched, and a block whose
 * source the cursor is inside falls back to raw text so it can be edited.
 */
export interface LivePreviewDeps {
  links: AdoLinkService;
  settings: () => AdoWikiSettings;
  /**
   * Path of the file in the editor, used to resolve relative destinations. Taken from the state
   * rather than the view because the block decorations are built without one (rule 2).
   */
  sourcePathOf: (state: EditorState) => string;
  /** Render markdown with Obsidian's own pipeline — how `::: mermaid` becomes a diagram. */
  renderMarkdown?: (markdown: string, el: HTMLElement, sourcePath: string) => Promise<void> | void;
  /** Jump to a heading of the page being edited (the generated table of contents). */
  openHeading?: (sourcePath: string, heading: string) => void;
}

/** Node names whose contents must never be decorated. */
const SKIP_NODES = /codeblock|inline-code|frontmatter|math|comment/i;

/**
 * Sort keys matching CodeMirror's own `startSide` ordering, which `RangeSetBuilder` insists on:
 * a mark opens to the left of an inline replacement. Two decorations starting at the same offset
 * must be added in this order or the builder throws. (Block replacements are built separately —
 * see {@link blockDecorationField} — and are the only decoration in their own range set.)
 */
const LAYER = { mark: 0, inlineReplace: 1 } as const;

interface PendingDecoration {
  from: number;
  to: number;
  layer: number;
  decoration: Decoration;
}

export function adoLivePreview(deps: LivePreviewDeps): Extension {
  const blocks = blockDecorationField(deps);

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = this.build(update.view);
        }
      }

      private build(view: EditorView): DecorationSet {
        try {
          return buildInlineDecorations(view, deps, view.state.field(blocks).ranges);
        } catch (error) {
          // A decoration failure must not take the editor's syntax highlighting with it.
          console.error("[azure-devops-wiki] live preview decorations failed", error);
          return Decoration.none;
        }
      }
    },
    {
      decorations: (value) => value.decorations,
      eventHandlers: {
        // Live preview shows a markdown link as plain text; without this, mod-clicking an ADO
        // destination would hand '/Parent/Child' to the browser.
        mousedown(event: MouseEvent, view: EditorView) {
          if (!isModEvent(event)) return false;
          return followLinkAt(event, view, deps);
        },
      },
    },
  );

  // See rule 3 in the module comment: ours must be the earlier decoration source.
  return Prec.highest([blocks, plugin]);
}

interface BlockLayer {
  decorations: DecorationSet;
  /** Document ranges the block widgets replaced, so the inline passes leave them alone. */
  ranges: Array<[number, number]>;
  /** Parsed once per document version and reused while only the cursor moves. */
  parsed: ParsedDocument;
}

/**
 * The block half of the decorations, held in editor **state**.
 *
 * CodeMirror refuses block decorations from any *dynamic* source, and "dynamic" means exactly
 * "the `EditorView.decorations` facet value is a `(view) => DecorationSet` function" — which is
 * what `ViewPlugin.fromClass(…, { decorations })` installs. Serving these from the view plugin
 * throws `RangeError: Block decorations may not be specified via plugins` from deep inside
 * `ContentBuilder`, *after* our own try/catch has returned, while the editor is building its
 * content — that is, inside `MarkdownView.onLoadFile`. Obsidian catches it there, blanks the
 * view and shows "Failed to open", so every page carrying a `:::` block, a `[[_TOC_]]` or a
 * whole-line image became unopenable (round 4, item 1).
 *
 * A `StateField` provides a plain `DecorationSet`, which is a static source, so block decorations
 * are allowed. The price is that there is no viewport to cull against — but the expensive part
 * (Mermaid, markdown rendering, decoding an image) happens in `toDOM`, which CodeMirror still
 * calls only for widgets it actually draws, using `estimatedHeight` for the rest.
 */
function blockDecorationField(deps: LivePreviewDeps): StateField<BlockLayer> {
  const build = (state: EditorState, previous?: ParsedDocument): BlockLayer => {
    const parsed: ParsedDocument = previous ?? { text: null, blocks: [], headings: [] };
    try {
      return buildBlockDecorations(state, deps, parsed);
    } catch (error) {
      console.error("[azure-devops-wiki] live preview block decorations failed", error);
      return { decorations: Decoration.none, ranges: [], parsed };
    }
  };

  return StateField.define<BlockLayer>({
    create: (state) => build(state),
    update: (value, transaction) => {
      // The cursor moving in or out of a block swaps it between rendered and raw, so selection
      // changes matter as much as edits.
      if (!transaction.docChanged && !transaction.selection) return value;
      return build(transaction.state, value.parsed);
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  });
}

// ------------------------------------------------------------------ decorating

interface ParsedDocument {
  text: string | null;
  blocks: RenderableBlock[];
  headings: DocHeading[];
}

/**
 * Whole-line ADO constructs, rendered in place of their source. State only — no view (rule 2).
 */
function buildBlockDecorations(
  state: EditorState,
  deps: LivePreviewDeps,
  parsed: ParsedDocument,
): BlockLayer {
  const settings = deps.settings();
  const sourcePath = deps.sourcePathOf(state);
  const ranges: Array<[number, number]> = [];
  const builder = new RangeSetBuilder<Decoration>();

  const text = state.doc.toString();
  if (parsed.text !== text) {
    const lines = text.split("\n");
    parsed.text = text;
    parsed.blocks = findRenderableBlocks(lines);
    parsed.headings = headingsInMarkdown(lines);
  }

  const lineCount = state.doc.lines;
  for (const block of parsed.blocks) {
    // The table repair is a display change with its own setting; off means stock rendering.
    if (block.kind === "table" && !settings.repairAdoTables) continue;

    // A document can shrink between the parse and this pass only if something is very wrong,
    // but a stale line number would throw out of `line()` and lose every decoration.
    if (block.startLine >= lineCount || block.endLine >= lineCount) continue;

    const from = state.doc.line(block.startLine + 1).from;
    const to = state.doc.line(block.endLine + 1).to;
    // The cursor inside a block means the user is editing it, not reading it.
    if (touchesSelectionIn(state, from, to)) continue;

    const widget = widgetFor(block, deps, parsed, sourcePath);
    if (!widget) continue;

    // `parsed.blocks` is in document order, which is all `RangeSetBuilder` asks for here: one
    // decoration per block and no two blocks starting at the same offset.
    builder.add(from, to, Decoration.replace({ widget, block: true }));
    ranges.push([from, to]);
  }

  return { decorations: builder.finish(), ranges, parsed };
}

/** Work-item references, mentions and links — everything that stays inside a line. */
function buildInlineDecorations(
  view: EditorView,
  deps: LivePreviewDeps,
  blockRanges: ReadonlyArray<readonly [number, number]>,
): DecorationSet {
  const settings = deps.settings();
  const sourcePath = deps.sourcePathOf(view.state);
  const pending: PendingDecoration[] = [];

  const outsideBlocks = (from: number, to: number): boolean =>
    !blockRanges.some(([start, end]) => from < end && to > start);

  for (const { from, to } of view.visibleRanges) {
    const slice = view.state.sliceDoc(from, to);
    const skip = skipRanges(view, from, to);
    const allowed = (start: number, end: number): boolean =>
      outsideBlocks(start, end) &&
      !skip.some(([skipFrom, skipTo]) => start < skipTo && end > skipFrom);

    collectInlineTokens(slice, from, settings, allowed, pending, view);
    collectLinkDecorations(slice, from, view, deps, sourcePath, allowed, pending);
  }

  pending.sort((a, b) => a.from - b.from || a.layer - b.layer || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, decoration } of pending) builder.add(from, to, decoration);
  return builder.finish();
}

function widgetFor(
  block: RenderableBlock,
  deps: LivePreviewDeps,
  parsed: ParsedDocument,
  sourcePath: string,
): WidgetType | null {
  switch (block.kind) {
    case "macro":
      if (block.ignored) return new NoticeWidget(S.render.tocIgnored);
      return block.name === "TOC"
        ? new TocWidget(parsed.headings, sourcePath, deps)
        : new SubpagesWidget(sourcePath, deps);

    case "colon":
      switch (block.block.kind) {
        case "mermaid":
          // Handed to Obsidian's own ```mermaid pipeline, exactly as reading mode does it.
          return deps.renderMarkdown
            ? new MarkdownBlockWidget(
                `\`\`\`mermaid\n${block.block.content}\n\`\`\``,
                sourcePath,
                deps.renderMarkdown,
                "adowiki-mermaid",
                160,
              )
            : null;
        case "video":
          return new CardWidget(S.render.videoLabel, block.block.content.trim(), true);
        case "query-table":
          return new CardWidget(S.render.queryTableLabel, S.render.queryTableHint, false);
        case "other":
          return null;
      }
      return null;

    case "image": {
      const resolution = deps.links.resolve(block.href, sourcePath);
      if (resolution.kind !== "attachment") return null;
      // A file this clone has not pulled yet: a card that says so beats a broken image.
      if (!deps.links.attachmentExists(resolution.vaultPath)) {
        return new CardWidget(
          S.render.missingAttachmentLabel,
          S.render.missingAttachment(fileNameOf(resolution.vaultPath)),
          false,
        );
      }
      return new ImageWidget(deps.links.resourcePath(resolution.vaultPath), block.alt, true);
    }

    case "table":
      // Rendered through Obsidian's own markdown pipeline, from table markdown that has the
      // blank lines ADO does not need — the file itself is never touched (that is a lint fix).
      return deps.renderMarkdown
        ? new MarkdownBlockWidget(
            block.markdown,
            sourcePath,
            deps.renderMarkdown,
            "adowiki-table-block",
            // Header, separator and one line per row, near enough to keep scrolling steady.
            24 * (block.endLine - block.startLine + 1),
          )
        : null;
  }
}

function collectInlineTokens(
  text: string,
  offset: number,
  settings: AdoWikiSettings,
  allowed: (from: number, to: number) => boolean,
  pending: PendingDecoration[],
  view: EditorView,
): void {
  const options = {
    workItems: settings.renderWorkItemLinks,
    pullRequests: settings.renderWorkItemLinks,
    mentions: settings.renderMentions,
  };
  if (!options.workItems && !options.mentions) return;

  for (const token of findInlineTokens(text, options)) {
    // Here, unlike in rendered HTML, the backslash of an escaped reference is still visible.
    if (token.escaped) continue;

    const from = offset + token.start;
    const to = offset + token.end;
    if (!allowed(from, to)) continue;

    /**
     * A mention is *replaced*, not marked. `@<Alex Green>` is an HTML tag as far as the
     * markdown highlighter is concerned, so it hands back `cm-hmd-html-begin`, `cm-tag`,
     * `cm-attribute` and `cm-bracket` tokens — and CodeMirror splits a mark decoration at every
     * one of them. The chip styling was landing on all twelve fragments, so one mention drew as
     * `@ ‹ Alex Green ›` in a row of little boxes (round 6). One widget cannot be split, and
     * it shows the same friendly label reading mode does.
     */
    if (token.kind === "mention") {
      if (touchesSelection(view, from, to)) continue; // editing it: leave the source alone
      pending.push({
        from,
        to,
        layer: LAYER.inlineReplace,
        decoration: Decoration.replace({ widget: new MentionWidget(token.id) }),
      });
      continue;
    }

    const cls = token.kind === "workItem" ? "adowiki-workitem" : "adowiki-pullrequest";
    pending.push({
      from,
      to,
      layer: LAYER.mark,
      decoration: Decoration.mark({
        class: `${cls} adowiki-cm-ref`,
        attributes: {
          "data-adowiki-kind": token.kind,
          "data-adowiki-id": token.id,
          "aria-label": S.render.openInAdo,
        },
      }),
    });
  }
}

function collectLinkDecorations(
  text: string,
  offset: number,
  view: EditorView,
  deps: LivePreviewDeps,
  sourcePath: string,
  allowed: (from: number, to: number) => boolean,
  pending: PendingDecoration[],
): void {
  for (const link of findMarkdownLinks(text)) {
    const from = offset + link.start;
    const to = offset + link.end;
    if (!allowed(from, to)) continue;

    const resolution = deps.links.resolve(link.href, sourcePath);

    if (link.isImage && resolution.kind === "attachment") {
      // Stock Obsidian cannot preview a root-absolute image; replace the link with the picture,
      // unless the cursor is inside it — then the user is editing the text, not reading it.
      if (touchesSelection(view, from, to)) continue;
      const present = deps.links.attachmentExists(resolution.vaultPath);
      pending.push({
        from,
        to,
        layer: LAYER.inlineReplace,
        decoration: Decoration.replace({
          widget: present
            ? new ImageWidget(deps.links.resourcePath(resolution.vaultPath), link.text, false)
            : new NoticeWidget(S.render.missingAttachment(fileNameOf(resolution.vaultPath)), false),
        }),
      });
      continue;
    }

    if (resolution.kind === "page" || resolution.kind === "attachment") {
      pending.push({
        from: offset + link.hrefStart,
        to: offset + link.hrefEnd,
        layer: LAYER.mark,
        decoration: Decoration.mark({ class: "adowiki-cm-target" }),
      });
    }
  }

  // A macro inside a paragraph cannot become a block, so it keeps the chip treatment.
  for (const macro of findInlineMacros(text)) {
    const from = offset + macro.start;
    const to = offset + macro.end;
    if (!allowed(from, to) || touchesSelection(view, from, to)) continue;
    pending.push({
      from,
      to,
      layer: LAYER.inlineReplace,
      decoration: Decoration.replace({ widget: new MacroChipWidget(macro.name) }),
    });
  }
}

/** `[[_TOC_]]` / `[[_TOSP_]]` occurrences in a piece of text. */
function findInlineMacros(text: string): Array<{ name: "TOC" | "TOSP"; start: number; end: number }> {
  const macros: Array<{ name: "TOC" | "TOSP"; start: number; end: number }> = [];
  for (const match of text.matchAll(/\[\[_(TOC|TOSP)_\]\]/g)) {
    macros.push({
      name: match[1] as "TOC" | "TOSP",
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  }
  return macros;
}

function skipRanges(view: EditorView, from: number, to: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  syntaxTree(view.state).iterate({
    from,
    to,
    enter: (node) => {
      if (SKIP_NODES.test(node.name)) ranges.push([node.from, node.to]);
    },
  });
  return ranges;
}

function touchesSelection(view: EditorView, from: number, to: number): boolean {
  return touchesSelectionIn(view.state, from, to);
}

function touchesSelectionIn(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

// -------------------------------------------------------------------- widgets

/** Generated table of contents — the same list reading mode shows, built from the live document. */
class TocWidget extends WidgetType {
  constructor(
    private readonly headings: DocHeading[],
    private readonly sourcePath: string,
    private readonly deps: LivePreviewDeps,
  ) {
    super();
  }

  override eq(other: TocWidget): boolean {
    return (
      other.sourcePath === this.sourcePath &&
      other.headings.length === this.headings.length &&
      other.headings.every(
        (heading, i) =>
          heading.text === this.headings[i].text && heading.level === this.headings[i].level,
      )
    );
  }

  toDOM(): HTMLElement {
    const host = document.createElement("div");
    host.className = "adowiki-toc adowiki-cm-block";
    label(host, "adowiki-toc__title", S.render.tocTitle);

    if (this.headings.length === 0) {
      label(host, "adowiki-toc__empty", S.render.tocEmpty);
      return host;
    }

    const topLevel = Math.min(...this.headings.map((heading) => heading.level));
    const list = host.appendChild(document.createElement("ul"));
    list.className = "adowiki-toc__list";

    for (const heading of this.headings) {
      const item = list.appendChild(document.createElement("li"));
      item.className = "adowiki-toc__item";
      item.style.setProperty("--adowiki-toc-depth", String(heading.level - topLevel));

      const link = item.appendChild(document.createElement("a"));
      link.className = "adowiki-toc__link";
      // ADO's TOC shows the heading text only — bold, code and links are stripped from it.
      link.textContent = stripInlineMarkdown(heading.text);
      link.href = `#${headingToAnchor(heading.text)}`;
      link.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.deps.openHeading?.(this.sourcePath, heading.text);
      });
    }
    return host;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/** Generated subpage list for `[[_TOSP_]]`. */
class SubpagesWidget extends WidgetType {
  private readonly subpages: Array<{ title: string; path: string }>;

  constructor(
    private readonly sourcePath: string,
    private readonly deps: LivePreviewDeps,
  ) {
    super();
    this.subpages = deps.links
      .subpagesOf(sourcePath)
      .map((entry) => ({ title: entry.title, path: entry.file.path }));
  }

  override eq(other: SubpagesWidget): boolean {
    return (
      other.sourcePath === this.sourcePath &&
      other.subpages.length === this.subpages.length &&
      other.subpages.every((page, i) => page.path === this.subpages[i].path)
    );
  }

  toDOM(): HTMLElement {
    const host = document.createElement("div");
    host.className = "adowiki-tosp adowiki-cm-block";
    label(host, "adowiki-tosp__title", S.render.subpagesTitle);

    if (this.subpages.length === 0) {
      label(host, "adowiki-tosp__empty", S.render.subpagesEmpty);
      return host;
    }

    const list = host.appendChild(document.createElement("ul"));
    list.className = "adowiki-tosp__list";
    for (const subpage of this.subpages) {
      const link = list.appendChild(document.createElement("li")).appendChild(
        document.createElement("a"),
      );
      link.className = "adowiki-tosp__link internal-link";
      link.textContent = subpage.title;
      link.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.deps.links.open(
          { kind: "page", vaultPath: subpage.path, anchor: null },
          this.sourcePath,
          { newLeaf: isModEvent(event) },
        );
      });
    }
    return host;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Markdown rendered by Obsidian's own pipeline in place of the source lines — how `::: mermaid`
 * becomes a diagram and how a table ADO glues to its paragraph becomes a table.
 *
 * Both go through one widget on purpose: Mermaid upgrades and table styling then come from
 * Obsidian, and neither construct needs a renderer of its own.
 */
class MarkdownBlockWidget extends WidgetType {
  constructor(
    private readonly markdown: string,
    private readonly sourcePath: string,
    private readonly render: NonNullable<LivePreviewDeps["renderMarkdown"]>,
    private readonly cls: string,
    /** Rendering is asynchronous; a guess keeps the scroll position from jumping. */
    private readonly height: number,
  ) {
    super();
  }

  override eq(other: MarkdownBlockWidget): boolean {
    return (
      other.markdown === this.markdown &&
      other.sourcePath === this.sourcePath &&
      // Two kinds of block share this class, and their content could in principle coincide.
      other.cls === this.cls
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const host = document.createElement("div");
    host.className = `${this.cls} adowiki-cm-block`;
    const rendered = this.render(this.markdown, host, this.sourcePath);
    // The result arrives after this returns, and it is taller than the placeholder line.
    void Promise.resolve(rendered).then(() => view.requestMeasure());
    return host;
  }

  override get estimatedHeight(): number {
    return this.height;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/** `::: video` and `::: query-table` — only Azure DevOps can render the real thing. */
class CardWidget extends WidgetType {
  constructor(
    private readonly title: string,
    private readonly body: string,
    private readonly bodyIsUrl: boolean,
  ) {
    super();
  }

  override eq(other: CardWidget): boolean {
    return other.title === this.title && other.body === this.body;
  }

  toDOM(): HTMLElement {
    const host = document.createElement("div");
    host.className = "adowiki-card adowiki-cm-block";
    label(host, "adowiki-card__label", this.title);

    if (this.bodyIsUrl && this.body.length > 0) {
      const link = host.appendChild(document.createElement("a"));
      link.className = "adowiki-card__link";
      link.textContent = this.body;
      link.href = this.body;
      link.target = "_blank";
      link.rel = "noopener";
    } else {
      label(host, "adowiki-card__hint", this.body);
    }
    return host;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * A short explanation in place of something that cannot be rendered: the second `[[_TOC_]]` on a
 * page (which Azure DevOps ignores) or an attachment this clone does not have.
 */
class NoticeWidget extends WidgetType {
  constructor(
    private readonly text: string,
    private readonly block = true,
  ) {
    super();
  }

  override eq(other: NoticeWidget): boolean {
    return other.text === this.text && other.block === this.block;
  }

  toDOM(): HTMLElement {
    const chip = document.createElement("span");
    chip.className = this.block ? "adowiki-chip adowiki-cm-block" : "adowiki-chip";
    chip.textContent = this.text;
    return chip;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    private readonly src: string,
    private readonly alt: string,
    private readonly block: boolean,
  ) {
    super();
  }

  override eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt && other.block === this.block;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement(this.block ? "div" : "span");
    wrapper.className = this.block ? "adowiki-cm-image adowiki-cm-block" : "adowiki-cm-image";
    const image = wrapper.appendChild(document.createElement("img"));
    image.src = this.src;
    image.alt = this.alt;
    // The intrinsic size is unknown until the file is decoded, and the line has to grow for it.
    image.addEventListener("load", () => view.requestMeasure(), { once: true });
    return wrapper;
  }

  override get estimatedHeight(): number {
    return this.block ? 180 : -1;
  }
}

/** `@<…>` as one unsplittable chip — see the note in {@link collectInlineTokens}. */
class MentionWidget extends WidgetType {
  constructor(private readonly id: string) {
    super();
  }

  override eq(other: MentionWidget): boolean {
    return other.id === this.id;
  }

  toDOM(): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "adowiki-mention";
    chip.textContent = mentionLabel(this.id);
    chip.setAttribute("aria-label", this.id);
    return chip;
  }
}

class MacroChipWidget extends WidgetType {
  constructor(private readonly name: "TOC" | "TOSP") {
    super();
  }

  override eq(other: MacroChipWidget): boolean {
    return other.name === this.name;
  }

  toDOM(): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "adowiki-chip";
    chip.textContent = this.name === "TOC" ? S.render.tocChip : S.render.subpagesChip;
    chip.setAttribute("aria-label", S.render.macroChipHint);
    return chip;
  }
}

function fileNameOf(vaultPath: string): string {
  return vaultPath.split("/").pop() ?? vaultPath;
}

function label(host: HTMLElement, cls: string, text: string): HTMLElement {
  const el = host.appendChild(document.createElement("div"));
  el.className = cls;
  el.textContent = text;
  return el;
}

// ------------------------------------------------------------------- clicking

function followLinkAt(event: MouseEvent, view: EditorView, deps: LivePreviewDeps): boolean {
  const target = event.target as HTMLElement | null;
  const reference = target?.closest?.(".adowiki-cm-ref") as HTMLElement | null;
  if (reference) {
    const kind = reference.getAttribute("data-adowiki-kind");
    const id = reference.getAttribute("data-adowiki-id") ?? "";
    const href =
      kind === "workItem"
        ? deps.links.workItemHref(id)
        : kind === "pullRequest"
          ? deps.links.pullRequestHref(id)
          : null;
    if (href === null) return false;
    window.open(href, "_blank");
    consume(event);
    return true;
  }

  const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (position === null) return false;

  const line = view.state.doc.lineAt(position);
  const link = findMarkdownLinkAt(line.text, position - line.from);
  if (!link) return false;

  const sourcePath = deps.sourcePathOf(view.state);
  const resolution = deps.links.resolve(link.href, sourcePath);
  // Anything the platform already handles correctly is left to it.
  if (resolution.kind === "external" || resolution.kind === "missing") return false;

  consume(event);
  void deps.links.open(resolution, sourcePath, { newLeaf: event.altKey });
  return true;
}

function consume(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function isModEvent(event: MouseEvent): boolean {
  return event.ctrlKey || event.metaKey;
}
