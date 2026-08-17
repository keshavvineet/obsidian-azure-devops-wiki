import {
  App,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownRenderer,
} from "obsidian";
import { headingToAnchor, stripInlineMarkdown } from "../naming/anchors";
import type { AdoWikiSettings } from "../settings";
import { S } from "../strings";
import type { AdoLinkService } from "./adoLinkService";
import { normalizeAdoParagraph, parseColonBlockAt, type ColonBlock } from "./adoBlocks";
import { escapedIds, findInlineTokens, mentionLabel, type InlineToken } from "./inlineAdo";

/**
 * Reading-mode rendering of everything ADO writes and Obsidian does not understand
 * (FR-3.1, FR-3.3, FR-4.1–4.6) — ARCHITECTURE §4.3.
 *
 * All of it is display-only: not one of these transformations touches the file. The order
 * matters — `:::` blocks and broken tables replace whole elements, so they run before the
 * passes that decorate what is left.
 */
export class AdoReadingProcessor {
  /**
   * Line ranges already consumed by a `:::` block, per render pass. A block containing a blank
   * line arrives as several sections; the first one renders the whole block and the rest have to
   * be dropped instead of showing their raw text.
   */
  private readonly consumedLines = new Map<string, Array<[number, number]>>();

  constructor(
    private readonly app: App,
    private readonly links: AdoLinkService,
    private readonly settings: () => AdoWikiSettings,
  ) {}

  /**
   * Registered with `registerMarkdownPostProcessor`.
   *
   * Each pass is guarded on its own. A post-processor that throws leaves Obsidian rendering the
   * section as **nothing** — the page comes up blank with no error a user could act on — so one
   * bad transformation must never take the page, or the passes after it, down with it.
   */
  process = (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
    this.attempt("colon blocks", () => this.renderColonBlocks(el, ctx));
    this.attempt("tables", () => this.repairTables(el, ctx));
    // Before the inline pass, which can only see what is left in the DOM.
    this.attempt("mentions", () => this.repairSwallowedMentions(el, ctx));
    this.attempt("macros", () => this.renderMacros(el, ctx));
    this.attempt("images", () => this.rewriteImages(el));
    this.attempt("links", () => this.rewriteLinks(el, ctx));
    this.attempt("inline references", () => this.decorateInlineReferences(el, ctx));
  };

  private attempt(pass: string, run: () => void): void {
    try {
      run();
    } catch (error) {
      console.error(`[azure-devops-wiki] reading-mode ${pass} pass failed`, error);
    }
  }

  // ------------------------------------------------------------- ::: blocks

  private renderColonBlocks(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    for (const paragraph of paragraphsOf(el)) {
      const source = this.sourceOf(paragraph, ctx, el);
      if (!source) continue;

      if (this.isConsumed(ctx, source.lineStart)) {
        paragraph.remove();
        continue;
      }

      const block = parseColonBlockAt(source.lines, source.lineStart);
      // An unterminated block is a typo in the page; showing it raw is the honest thing to do.
      if (!block || !block.closed) continue;

      this.renderColonBlock(block, paragraph, ctx);
      if (block.endLine > source.lineEnd) {
        this.markConsumed(ctx, [source.lineEnd + 1, block.endLine]);
      }
    }
  }

  private renderColonBlock(
    block: ColonBlock,
    target: HTMLElement,
    ctx: MarkdownPostProcessorContext,
  ): void {
    switch (block.kind) {
      case "mermaid": {
        // Hand the source to Obsidian's own Mermaid pipeline via the fence it does understand.
        const host = replaceWith(target, "div", "adowiki-mermaid");
        const child = new MarkdownRenderChild(host);
        ctx.addChild(child);
        void MarkdownRenderer.render(
          this.app,
          `\`\`\`mermaid\n${block.content}\n\`\`\``,
          host,
          ctx.sourcePath,
          child,
        );
        return;
      }
      case "video": {
        const card = replaceWith(target, "div", "adowiki-card adowiki-card--video");
        card.createEl("div", { cls: "adowiki-card__label", text: S.render.videoLabel });
        const url = block.content.trim();
        const link = card.createEl("a", { cls: "adowiki-card__link", text: url, href: url });
        link.setAttr("target", "_blank");
        link.setAttr("rel", "noopener");
        return;
      }
      case "query-table": {
        const card = replaceWith(target, "div", "adowiki-card adowiki-card--query");
        card.createEl("div", { cls: "adowiki-card__label", text: S.render.queryTableLabel });
        card.createEl("div", { cls: "adowiki-card__hint", text: S.render.queryTableHint });
        return;
      }
      case "other":
        return;
    }
  }

  // ----------------------------------------------------------------- tables

  /**
   * ADO renders a pipe table that starts on the line after a paragraph; Obsidian needs a blank
   * line first and otherwise shows the rows as text (reported from a production page). The
   * paragraph is re-rendered with the blank lines put back — on screen only.
   */
  private repairTables(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    if (!this.settings().repairAdoTables) return;

    for (const paragraph of paragraphsOf(el)) {
      const source = this.sourceOf(paragraph, ctx, el);
      if (!source) continue;

      const raw = source.lines.slice(source.lineStart, source.lineEnd + 1).join("\n");
      const normalized = normalizeAdoParagraph(raw);
      if (normalized === null) continue;

      const host = replaceWith(paragraph, "div", "adowiki-table-block");
      const child = new MarkdownRenderChild(host);
      ctx.addChild(child);
      // The nested render runs the post-processors again, so links, images and references
      // inside the repaired paragraph are decorated by that pass — with one caveat: its context
      // carries no section info, so an escaped `\#123` in a repaired paragraph is linked anyway.
      void MarkdownRenderer.render(this.app, normalized, host, ctx.sourcePath, child);
    }
  }

  // ------------------------------------------------------------- @<mentions>

  /**
   * `@<Alex Green>` is a mention to Azure DevOps and an **HTML tag to every markdown
   * renderer**: `<Alex Green>` parses as an element named `alex` with an attribute
   * `khurana`, so by the time a post-processor runs, the name is not in the DOM at all — the
   * paragraph reads `@ @ : Unlike the attribute condition…` and no amount of text-node scanning
   * can get the name back (reported round 6).
   *
   * Only *some* mentions are affected, which is why this went unnoticed: HTML tag names must
   * start with a letter, so ADO's usual `@<7a4b-…-guid>` survives as plain text and only the
   * human-readable alias form is eaten.
   *
   * The repair is to re-render the paragraph from source with the delimiters escaped, so the name
   * comes back as text and {@link decorateInlineReferences} can chip it. Same approach, and the
   * same caveat, as the table repair above.
   */
  private repairSwallowedMentions(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    if (!this.settings().renderMentions) return;

    for (const paragraph of paragraphsOf(el)) {
      const source = this.sourceOf(paragraph, ctx, el);
      if (!source) continue;

      const raw = source.lines.slice(source.lineStart, source.lineEnd + 1).join("\n");
      const escaped = escapeTagLikeMentions(raw);
      if (escaped === null) continue;
      // The name is still on screen, so the renderer did not treat it as a tag — leave it be.
      if (!hasLostMentionText(paragraph, raw)) continue;

      const host = replaceWith(paragraph, "div", "adowiki-mention-block");
      const child = new MarkdownRenderChild(host);
      ctx.addChild(child);
      void MarkdownRenderer.render(this.app, escaped, host, ctx.sourcePath, child);
    }
  }

  // ---------------------------------------------------- [[_TOC_]] / [[_TOSP_]]

  /**
   * `[[_TOC_]]` and `[[_TOSP_]]` are ADO macros that Obsidian renders as unresolved wikilinks.
   * They are generated on every render, so a page always shows its current headings and
   * subpages without anyone pressing anything.
   */
  private renderMacros(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    for (const anchor of Array.from(el.querySelectorAll("a"))) {
      // The tag is case-sensitive on Azure DevOps: '[[_toc_]]' does not render a TOC there,
      // so it must not render one here either (Microsoft markdown-guidance, verified 2026-08-10).
      const macro = macroNameOf(anchor.getAttribute("data-href") ?? anchor.textContent ?? "");
      if (macro === null) continue;

      const target = onlyChildOfParagraph(anchor) ?? anchor;
      if (macro === "TOSP") {
        this.renderSubpages(target, ctx);
        continue;
      }
      // "The publishing system renders the TOC for the first instance of the [[_TOC_]] tag …
      // It ignores other instances" — same source. A later tag becomes a plain chip.
      if (this.isFirstTocOnPage(anchor, el, ctx)) this.renderToc(target, ctx);
      else replaceWith(target, "span", "adowiki-chip").setText(S.render.tocIgnored);
    }
  }

  /**
   * Whether this is the page's first `[[_TOC_]]`. Answered from the source above the current
   * section rather than from render state, so re-rendering a single section stays correct.
   */
  private isFirstTocOnPage(
    anchor: HTMLElement,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
  ): boolean {
    const source = this.sourceOf(anchor.closest("p") ?? el, ctx, el);
    if (!source) return true;
    return !source.lines.slice(0, source.lineStart).some((line) => line.includes("[[_TOC_]]"));
  }

  private renderToc(target: Element, ctx: MarkdownPostProcessorContext): void {
    const headings = this.links.headingsOf(ctx.sourcePath);
    const host = replaceWith(target, "div", "adowiki-toc");
    host.createEl("div", { cls: "adowiki-toc__title", text: S.render.tocTitle });

    if (headings.length === 0) {
      host.createEl("div", { cls: "adowiki-toc__empty", text: S.render.tocEmpty });
      return;
    }

    const topLevel = Math.min(...headings.map((heading) => heading.level));
    const list = host.createEl("ul", { cls: "adowiki-toc__list" });
    for (const heading of headings) {
      const item = list.createEl("li", { cls: "adowiki-toc__item" });
      item.style.setProperty("--adowiki-toc-depth", String(heading.level - topLevel));
      const link = item.createEl("a", {
        cls: "adowiki-toc__link",
        // ADO's TOC shows the heading text only — bold, code and links are stripped from it.
        text: stripInlineMarkdown(heading.text),
        href: `#${headingToAnchor(heading.text)}`,
      });
      link.addEventListener("click", (event) => {
        event.preventDefault();
        void this.app.workspace.openLinkText(
          `${ctx.sourcePath}#${heading.text}`,
          ctx.sourcePath,
          false,
        );
      });
    }
  }

  private renderSubpages(target: Element, ctx: MarkdownPostProcessorContext): void {
    const subpages = this.links.subpagesOf(ctx.sourcePath);
    const host = replaceWith(target, "div", "adowiki-tosp");
    host.createEl("div", { cls: "adowiki-tosp__title", text: S.render.subpagesTitle });

    if (subpages.length === 0) {
      host.createEl("div", { cls: "adowiki-tosp__empty", text: S.render.subpagesEmpty });
      return;
    }

    const list = host.createEl("ul", { cls: "adowiki-tosp__list" });
    for (const subpage of subpages) {
      const link = list.createEl("li").createEl("a", {
        cls: "adowiki-tosp__link internal-link",
        text: subpage.title,
        href: subpage.wikiPath,
      });
      link.addEventListener("click", (event) => {
        event.preventDefault();
        void this.app.workspace.openLinkText(
          subpage.file.path,
          ctx.sourcePath,
          isModEvent(event),
        );
      });
    }
  }

  // ---------------------------------------------------------------- images

  /**
   * `![x](/.attachments/f.png)` — root-absolute, so Obsidian cannot resolve it.
   *
   * There are two shapes to catch, and the second is the one that matters. Obsidian only emits an
   * `<img>` when the target looks like a URL; a markdown image pointing anywhere else is turned
   * into an **internal embed** and handed to the link resolver, which cannot see a root-absolute
   * path into a dot-folder. The result is
   * `<span class="internal-embed file-embed mod-empty-attachment" src="/.attachments/…">“…” could
   * not be found.</span>` — a span, no `<img>` anywhere, which is why matching only on `img` left
   * reading mode showing that sentence while live preview (which never gets this far, because the
   * CM6 widget replaces the source text first) showed the picture.
   */
  private rewriteImages(el: HTMLElement): void {
    for (const image of Array.from(el.querySelectorAll("img"))) {
      const src = originalSrc(image.getAttribute("src"));
      if (src === null) continue;

      const resolution = this.links.resolve(src, "");
      if (resolution.kind !== "attachment") continue;

      // A file this clone has not pulled yet: say so, instead of a broken-image icon that
      // reads as "the plugin cannot show images".
      if (!this.links.attachmentExists(resolution.vaultPath)) {
        renderMissingAttachment(image, resolution.vaultPath);
        continue;
      }

      image.src = this.links.resourcePath(resolution.vaultPath);
      image.addClass("adowiki-image");
    }

    for (const embed of Array.from(el.querySelectorAll<HTMLElement>(".internal-embed[src]"))) {
      const src = originalSrc(embed.getAttribute("src"));
      if (src === null) continue;

      const resolution = this.links.resolve(src, "");
      if (resolution.kind !== "attachment") continue;

      if (!this.links.attachmentExists(resolution.vaultPath)) {
        renderMissingAttachment(embed, resolution.vaultPath);
        continue;
      }

      // Rebuilt rather than patched: the embed carries Obsidian's "could not be found" text and
      // its `mod-empty-attachment` styling, and both have to go.
      //
      // Our own classes only — emphatically *not* `internal-embed`. Obsidian keeps processing
      // elements with that class, so a replacement wearing it gets reclaimed by the embed handler,
      // which finds no `src` it can resolve and empties the span again: the picture appeared for a
      // moment and then vanished, with nothing in the console (round 6).
      const host = replaceWith(embed, "span", "adowiki-embed");
      const image = host.createEl("img", { cls: "adowiki-image" });
      image.src = this.links.resourcePath(resolution.vaultPath);
      image.alt = embed.getAttribute("alt") ?? fileNameOf(resolution.vaultPath);
      // Obsidian sizes an embed from `|500` in the alt text; keep that working.
      const width = widthFromAlt(image.alt);
      if (width !== null) image.setAttribute("width", String(width));
    }
  }

  // ----------------------------------------------------------------- links

  /** Root-absolute page links, attachment links and ADO anchors, made clickable (FR-3.3). */
  private rewriteLinks(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    for (const anchor of Array.from(el.querySelectorAll("a"))) {
      const href = anchor.getAttribute("href");
      if (href === null || anchor.hasAttribute("data-adowiki-link")) continue;
      // Only ADO's own forms need help; Obsidian handles its links and real URLs itself.
      if (!href.startsWith("/") && !href.startsWith("#")) continue;
      if (href.startsWith("//")) continue;

      const resolution = this.links.resolve(href, ctx.sourcePath);
      if (resolution.kind === "external") continue;

      anchor.setAttr("data-adowiki-link", resolution.kind);
      // Obsidian marks these as external links; clicking one would open a browser.
      anchor.removeAttribute("target");
      anchor.removeAttribute("rel");
      anchor.removeClass("external-link");
      anchor.addClass("adowiki-link");

      if (resolution.kind === "missing") {
        anchor.addClass("is-unresolved");
        anchor.setAttr("aria-label", S.render.brokenLink(resolution.target));
      } else {
        anchor.addClass("internal-link");
      }

      anchor.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.links.open(resolution, ctx.sourcePath, { newLeaf: isModEvent(event) });
      });
    }
  }

  // ------------------------------------------------- #123, !123, @<mention>

  private decorateInlineReferences(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    const { renderWorkItemLinks, renderMentions } = this.settings();
    if (!renderWorkItemLinks && !renderMentions) return;

    const options = {
      workItems: renderWorkItemLinks,
      pullRequests: renderWorkItemLinks,
      mentions: renderMentions,
    };
    // The rendered DOM has already eaten the backslash of an escaped `\#123`, so which ids are
    // escaped can only be learnt from the source (SYNTAX-MAPPING §2).
    const source = this.sourceOf(el, ctx);
    const escaped = source
      ? escapedIds(source.lines.slice(source.lineStart, source.lineEnd + 1).join("\n"), options)
      : new Set<string>();

    for (const node of textNodesOf(el)) {
      const text = node.nodeValue ?? "";
      const tokens = findInlineTokens(text, options).filter(
        (token) => !token.escaped && !escaped.has(`${token.kind}:${token.id}`),
      );
      if (tokens.length === 0) continue;

      const fragment = document.createDocumentFragment();
      let cursor = 0;
      for (const token of tokens) {
        if (token.start > cursor) {
          fragment.appendChild(document.createTextNode(text.slice(cursor, token.start)));
        }
        fragment.appendChild(this.inlineElement(token));
        cursor = token.end;
      }
      if (cursor < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(cursor)));
      }
      node.parentNode?.replaceChild(fragment, node);
    }
  }

  private inlineElement(token: InlineToken): HTMLElement {
    if (token.kind === "mention") {
      const chip = document.createElement("span");
      chip.className = "adowiki-mention";
      chip.textContent = mentionLabel(token.id);
      chip.setAttribute("aria-label", token.id);
      return chip;
    }

    const href =
      token.kind === "workItem"
        ? this.links.workItemHref(token.id)
        : this.links.pullRequestHref(token.id);
    const cls = token.kind === "workItem" ? "adowiki-workitem" : "adowiki-pullrequest";

    if (href === null) {
      // Without an organization and project there is nowhere to link to; say so on hover
      // rather than producing a link that goes nowhere.
      const span = document.createElement("span");
      span.className = `${cls} ${cls}--unlinked`;
      span.textContent = token.text;
      span.setAttribute("aria-label", S.render.connectionMissing);
      return span;
    }

    const link = document.createElement("a");
    link.className = `${cls} external-link`;
    link.textContent = token.text;
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener";
    return link;
  }

  // --------------------------------------------------------------- plumbing

  /**
   * The markdown behind a rendered element, which is the only reliable source for block syntax
   * and escapes. Obsidian cannot always supply it (embeds, hover popovers); callers then fall
   * back to what the DOM shows, or skip.
   */
  private sourceOf(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    fallback?: HTMLElement,
  ): { lines: string[]; lineStart: number; lineEnd: number } | null {
    // Section info is keyed by the element Obsidian rendered the section into, which is
    // sometimes the container we were handed and sometimes the paragraph inside it.
    const info =
      ctx.getSectionInfo(el) ?? (fallback && fallback !== el ? ctx.getSectionInfo(fallback) : null);
    if (!info) return null;
    return { lines: this.linesOf(info.text), lineStart: info.lineStart, lineEnd: info.lineEnd };
  }

  /**
   * Section info hands back the *whole document* each time it is asked, and this runs once per
   * paragraph per pass. Splitting it every time would make rendering a long page quadratic
   * (NFR-2), so the last split is kept — consecutive calls always concern the same document.
   */
  private lastSplit: { text: string; lines: string[] } | null = null;

  private linesOf(text: string): string[] {
    if (this.lastSplit?.text !== text) this.lastSplit = { text, lines: text.split("\n") };
    return this.lastSplit.lines;
  }

  private isConsumed(ctx: MarkdownPostProcessorContext, line: number): boolean {
    const ranges = this.consumedLines.get(ctx.docId) ?? [];
    return ranges.some(([start, end]) => line >= start && line <= end);
  }

  private markConsumed(ctx: MarkdownPostProcessorContext, range: [number, number]): void {
    const ranges = this.consumedLines.get(ctx.docId) ?? [];
    ranges.push(range);
    this.consumedLines.set(ctx.docId, ranges);
    // Bounded: one entry per render pass, and old passes can never be revisited.
    if (this.consumedLines.size > 16) {
      const oldest = this.consumedLines.keys().next().value;
      if (oldest !== undefined) this.consumedLines.delete(oldest);
    }
  }
}

/** Replaces an image whose file is not in this clone with a card that explains why. */
function renderMissingAttachment(image: Element, vaultPath: string): void {
  const card = replaceWith(image, "div", "adowiki-card adowiki-card--missing");
  card.createEl("div", { cls: "adowiki-card__label", text: S.render.missingAttachmentLabel });
  card.createEl("div", {
    cls: "adowiki-card__hint",
    text: S.render.missingAttachment(fileNameOf(vaultPath)),
  });
}

function fileNameOf(vaultPath: string): string {
  return vaultPath.split("/").pop() ?? vaultPath;
}

/** `[[_TOC_]]` → 'TOC'. Accepts the rendered link form and the literal text form. */
function macroNameOf(raw: string): "TOC" | "TOSP" | null {
  const match = /^\s*(?:\[\[)?_(TOC|TOSP)_(?:\]\])?\s*$/.exec(raw);
  return match ? (match[1] as "TOC" | "TOSP") : null;
}

/** Paragraph elements of a rendered block, including the block itself when it is one. */
function paragraphsOf(el: HTMLElement): HTMLElement[] {
  const paragraphs = Array.from(el.querySelectorAll("p")) as HTMLElement[];
  if (el.tagName === "P") paragraphs.unshift(el);
  return paragraphs;
}

/** The element to replace: the whole paragraph when the macro is all it contains. */
function onlyChildOfParagraph(anchor: HTMLElement): HTMLElement | null {
  const parent = anchor.parentElement;
  if (!parent || parent.tagName !== "P") return null;
  return (parent.textContent ?? "").trim() === (anchor.textContent ?? "").trim() ? parent : null;
}

/** Swap an element for a new one of our own, keeping its position in the document. */
function replaceWith(target: Element, tag: keyof HTMLElementTagNameMap, cls: string): HTMLElement {
  const replacement = document.createElement(tag);
  replacement.className = cls;
  target.replaceWith(replacement);
  return replacement;
}

/**
 * The `src` as written in the file. Obsidian prefixes an unresolvable path with its own app
 * origin, which has to come off before the path can be resolved against the vault.
 */
function originalSrc(src: string | null): string | null {
  if (src === null) return null;
  const stripped = src.replace(/^app:\/\/[^/]*/, "");
  return stripped.startsWith("/") || stripped.startsWith(".attachments/") ? stripped : null;
}

/** Obsidian's `![alt|500](…)` sizing hint, which survives in the embed's alt text. */
function widthFromAlt(alt: string): number | null {
  const match = /\|\s*(\d{1,5})\s*$/.exec(alt);
  return match ? Number(match[1]) : null;
}

/**
 * A mention whose `<…>` an HTML parser will take for a tag: the name has to start with a letter,
 * which is exactly the rule for a tag name.
 */
const TAG_LIKE_MENTION = /@<([A-Za-z][^<>\n]{0,199})>/g;

/**
 * The same markdown with those mentions' delimiters escaped, or null when there are none. The
 * escapes render back to literal `<` and `>` text, which is what the inline pass looks for.
 */
function escapeTagLikeMentions(markdown: string): string | null {
  if (!TAG_LIKE_MENTION.test(markdown)) return null;
  TAG_LIKE_MENTION.lastIndex = 0;
  return markdown.replace(TAG_LIKE_MENTION, (_whole, name: string) => `@&lt;${name}&gt;`);
}

/**
 * Whether the rendered paragraph really lost a mention name. Cheaper and safer than assuming: a
 * renderer that leaves `@<Name>` alone (inside code, say) must not be second-guessed, and
 * re-rendering a paragraph that is already correct would only risk changing it.
 */
function hasLostMentionText(paragraph: HTMLElement, markdown: string): boolean {
  const rendered = paragraph.textContent ?? "";
  for (const match of markdown.matchAll(TAG_LIKE_MENTION)) {
    if (!rendered.includes(match[1])) return true;
  }
  return false;
}

/** Text nodes worth scanning: not inside a link, code, or something we already rendered. */
function textNodesOf(el: HTMLElement): Text[] {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("a, code, pre, .adowiki-toc, .adowiki-tosp, .adowiki-card")) {
        return NodeFilter.FILTER_REJECT;
      }
      return (node.nodeValue ?? "").length > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    nodes.push(node as Text);
  }
  return nodes;
}

function isModEvent(event: MouseEvent): boolean {
  return event.ctrlKey || event.metaKey || event.button === 1;
}
