// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { App, MarkdownPostProcessorContext } from "obsidian";
import { AdoReadingProcessor } from "../src/links/readingModeProcessor";
import { AdoLinkService } from "../src/links/adoLinkService";
import { PageIndex } from "../src/pages/pageIndex";
import { DEFAULT_SETTINGS } from "../src/settings";
import { fakeApp, FakeVault } from "./helpers/fakeVault";
import { installObsidianDomExtensions } from "./helpers/domExtensions";

/**
 * What the reading-mode processor is actually handed for an ADO image and an ADO mention.
 *
 * Both of these shipped broken because the markup was assumed rather than read:
 *
 *  - **`![x](/.attachments/f.png)` does not become an `<img>`.** Obsidian only emits one when the
 *    target looks like a URL; anything else becomes an *internal embed* run through the link
 *    resolver, which cannot see a root-absolute path into a dot-folder. So reading mode showed
 *    `"/.attachments/…" could not be found.` while live preview showed the picture, because the
 *    CM6 widget replaces the source text before Obsidian's embed handling matters.
 *  - **`@<Alex Green>` is an HTML tag to the markdown renderer.** `<Alex Green>` parses as
 *    an element named `alex` with an attribute `khurana`, so the name is gone from the DOM and
 *    the paragraph reads `@ @ : …`. Only the alias form is affected: an HTML tag name must start
 *    with a letter, so ADO's usual `@<…guid>` survives as text.
 *
 * The markup below is copied from the real DOM of `Execute-State-based-automation.md`, captured
 * over CDP from a running Obsidian 1.13.6.
 */

installObsidianDomExtensions();

const PAGE = "Execute-State-based-automation.md";
const ATTACHMENT = ".attachments/image-74526ba7-70c4-41f7-837b-5949fc6e6f91.png";

let vault: FakeVault;
let processor: AdoReadingProcessor;
let rendered: Array<{ markdown: string; host: HTMLElement }>;

beforeEach(async () => {
  vault = new FakeVault();
  vault.addPage(PAGE);
  vault.disk.set(ATTACHMENT, "binary:1");

  const app = fakeApp(vault) as unknown as App;
  // getResourcePath is what Obsidian gives an <img>; only its shape matters here.
  (app.vault as unknown as { adapter: Record<string, unknown> }).adapter.getResourcePath = (
    path: string,
  ) => `app://local/${path}`;

  const index = new PageIndex(app);
  await index.rebuild();
  const links = new AdoLinkService(app, index, () => DEFAULT_SETTINGS);
  await links.reloadAttachments();

  rendered = [];
  processor = new AdoReadingProcessor(app, links, () => ({ ...DEFAULT_SETTINGS }));
  // MarkdownRenderer.render is Obsidian's; record what a nested render was asked to draw.
  const renderer = (await import("../tests/stubs/obsidian")).MarkdownRenderer as unknown as {
    render: (app: unknown, markdown: string, host: HTMLElement) => Promise<void>;
  };
  renderer.render = async (_app, markdown, host) => {
    rendered.push({ markdown, host });
    host.textContent = markdown;
  };
});

/** A post-processor context for a section spanning `lineStart..lineEnd` of `source`. */
function contextFor(source: string, el: HTMLElement): MarkdownPostProcessorContext {
  return {
    docId: "doc-1",
    sourcePath: PAGE,
    frontmatter: {},
    addChild: () => {},
    getSectionInfo: (target: Element) =>
      target === el || el.contains(target)
        ? { text: source, lineStart: 0, lineEnd: source.split("\n").length - 1 }
        : null,
  } as unknown as MarkdownPostProcessorContext;
}

describe("root-absolute images in reading mode", () => {
  it("renders the picture from Obsidian's unresolvable internal embed, not an <img>", () => {
    const el = document.createElement("div");
    // Verbatim from the running app: a span, class mod-empty-attachment, no <img> at all.
    el.innerHTML =
      `<p dir="auto"><span alt="image.png" src="/${ATTACHMENT}" ` +
      `class="internal-embed is-loaded file-embed mod-empty-attachment">` +
      `“/${ATTACHMENT}” could not be found.</span></p>`;

    processor.process(el, contextFor(`![image.png](/${ATTACHMENT})\n`, el));

    const image = el.querySelector("img");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe(`app://local/${ATTACHMENT}`);
    expect(image?.getAttribute("alt")).toBe("image.png");
    expect(el.textContent).not.toContain("could not be found");
    expect(el.querySelector(".mod-empty-attachment")).toBeNull();
    // Our replacement must NOT wear Obsidian's embed class: its embed handler keeps processing
    // anything with `internal-embed`, finds no resolvable `src`, and empties the span again — the
    // picture appeared and then silently vanished (round 6).
    expect(el.querySelector(".internal-embed")).toBeNull();
    expect(image?.closest(".adowiki-embed")).not.toBeNull();
  });

  it("still rewrites a real <img>, for a page that spells the embed as HTML", () => {
    const el = document.createElement("div");
    el.innerHTML = `<p><img src="/${ATTACHMENT}" alt="shot"></p>`;

    processor.process(el, contextFor(`<img src="/${ATTACHMENT}" alt="shot">\n`, el));

    expect(el.querySelector("img")?.getAttribute("src")).toBe(`app://local/${ATTACHMENT}`);
  });

  it("says so when the attachment is not in this clone", () => {
    vault.disk.delete(ATTACHMENT);
    const el = document.createElement("div");
    el.innerHTML =
      `<p><span alt="gone.png" src="/.attachments/gone.png" ` +
      `class="internal-embed file-embed mod-empty-attachment">“…” could not be found.</span></p>`;

    processor.process(el, contextFor("![gone.png](/.attachments/gone.png)\n", el));

    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector(".adowiki-card--missing")).not.toBeNull();
    expect(el.textContent).toContain("gone.png");
  });

  it("leaves an ordinary external image alone", () => {
    const el = document.createElement("div");
    el.innerHTML = `<p><img src="https://example.com/a.png" alt="x"></p>`;

    processor.process(el, contextFor("![x](https://example.com/a.png)\n", el));

    expect(el.querySelector("img")?.getAttribute("src")).toBe("https://example.com/a.png");
  });
});

describe("@<mentions> the markdown renderer ate", () => {
  const SOURCE =
    "@<Alex Green> @<Sam Blue> : Unlike the attribute condition, state condition " +
    "can only have 1 column.\n";

  /** What Obsidian really produces: the names parsed away as unknown elements. */
  function swallowedParagraph(): HTMLElement {
    const el = document.createElement("div");
    el.innerHTML =
      "<p dir=\"auto\">@<alex green> @<sam blue> : Unlike the attribute condition, " +
      "state condition can only have 1 column.</p>";
    return el;
  }

  it("re-renders the paragraph with the names escaped back in", () => {
    const el = swallowedParagraph();
    // Precondition — the name really is missing from the DOM Obsidian handed us.
    expect(el.textContent).not.toContain("Alex");

    processor.process(el, contextFor(SOURCE, el));

    expect(rendered).toHaveLength(1);
    expect(rendered[0].markdown).toContain("@&lt;Alex Green&gt;");
    expect(rendered[0].markdown).toContain("@&lt;Sam Blue&gt;");
    // The rest of the paragraph is passed through untouched.
    expect(rendered[0].markdown).toContain("state condition can only have 1 column");
  });

  it("leaves a guid mention alone — the parser never touched it", () => {
    const source = "@<3b0a2131-0000-4000-8000-000000000000> approved this.\n";
    const el = document.createElement("div");
    el.innerHTML = `<p>${source.trim()}</p>`;

    processor.process(el, contextFor(source, el));

    expect(rendered).toHaveLength(0);
    expect(el.querySelector(".adowiki-mention")?.textContent).toBe("@3b0a2131…");
  });

  it("does not re-render a paragraph whose mention text survived", () => {
    const source = "Mail @<Alex Green> about it.\n";
    const el = document.createElement("div");
    // e.g. inside code, where the renderer keeps the angle brackets literal.
    el.innerHTML = "<p>Mail @&lt;Alex Green&gt; about it.</p>";

    processor.process(el, contextFor(source, el));

    expect(rendered).toHaveLength(0);
    expect(el.querySelector(".adowiki-mention")?.textContent).toBe("@Alex Green");
  });

  it("does nothing when mention rendering is switched off", () => {
    const quiet = new AdoReadingProcessor(
      fakeApp(vault) as unknown as App,
      { resolve: () => ({ kind: "external", href: "" }) } as unknown as AdoLinkService,
      () => ({ ...DEFAULT_SETTINGS, renderMentions: false }),
    );
    const el = swallowedParagraph();

    quiet.process(el, contextFor(SOURCE, el));

    expect(rendered).toHaveLength(0);
  });
});
