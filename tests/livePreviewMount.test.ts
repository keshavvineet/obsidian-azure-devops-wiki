// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { adoLivePreview, type LivePreviewDeps } from "../src/links/livePreviewExtension";
import type { AdoLinkService } from "../src/links/adoLinkService";
import { DEFAULT_SETTINGS } from "../src/settings";

/**
 * Mounting the live-preview extension in a real CodeMirror editor.
 *
 * This file exists because every unit test of the decoration logic passed while **7 of the 11
 * pages in `test-vault` could not be opened at all**. `Decoration.replace({ block: true })` was
 * served from the `ViewPlugin`, and CodeMirror rejects a block decoration from any *dynamic*
 * source — "dynamic" meaning the `EditorView.decorations` facet value is a function, which is
 * exactly what `ViewPlugin.fromClass(…, { decorations })` installs. It throws
 * `RangeError: Block decorations may not be specified via plugins` from inside `ContentBuilder`,
 * i.e. while the editor builds its content, i.e. inside `MarkdownView.onLoadFile` — so Obsidian
 * caught it, blanked the view and showed "Failed to open “”" (with empty quotes: Obsidian
 * interpolates that message under the wrong key). Nothing short of constructing an `EditorView`
 * catches this: the decoration set is built without complaint and refused later, when consumed.
 *
 * So: one test per ADO block construct, each asserting the *editor* survives — not that a
 * particular decoration came out.
 */

/** Just enough AdoLinkService for the block widgets; images resolve to a present attachment. */
const links = {
  resolve: (href: string) =>
    href.startsWith("/.attachments/")
      ? { kind: "attachment" as const, vaultPath: href.slice(1), anchor: null }
      : { kind: "external" as const, href },
  attachmentExists: () => true,
  resourcePath: (vaultPath: string) => `app://local/${vaultPath}`,
  subpagesOf: () => [],
  workItemHref: () => null,
  pullRequestHref: () => null,
  open: async () => {},
} as unknown as AdoLinkService;

function deps(): LivePreviewDeps {
  return {
    links,
    settings: () => ({ ...DEFAULT_SETTINGS }),
    sourcePathOf: () => "Sample-Pages/2.-FAQ%3F.md",
    // Obsidian's renderer is not available here; the widget only needs it to exist.
    renderMarkdown: () => Promise.resolve(),
    openHeading: () => {},
  };
}

/** Build and mount an editor over `text`, the way opening a page does. */
function mount(text: string): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  return new EditorView({
    state: EditorState.create({ doc: text, extensions: [adoLivePreview(deps())] }),
    parent,
  });
}

/** The cursor lands at position 0 on open, which suppresses a block on line 1 — so give it room. */
const PREAMBLE = "# A page\n\nSome text.\n\n";

const CONSTRUCTS: ReadonlyArray<{ name: string; markdown: string }> = [
  {
    name: "a whole-line root-absolute image (what broke the FAQ page)",
    markdown: "![image.png](/.attachments/image-a9aa2758-165d-418a-8e74-6ef936e9b929.png)\n",
  },
  {
    name: "a fenced ::: mermaid block",
    markdown: "::: mermaid\ngraph TD;\n  A-->B;\n:::\n",
  },
  {
    name: "a single-line :::mermaid … ::: block (as Azure DevOps stores one)",
    markdown: ":::mermaid classDiagram Creature <|-- Superman :::\n",
  },
  { name: "a [[_TOC_]] macro", markdown: "[[_TOC_]]\n" },
  { name: "a [[_TOSP_]] macro", markdown: "[[_TOSP_]]\n" },
  { name: "a ::: video block", markdown: "::: video\nhttps://example.com/v\n:::\n" },
  { name: "a ::: query-table block", markdown: "::: query-table\nid\n:::\n" },
  {
    name: "a table glued to its paragraph",
    markdown: "Intro line\n| a | b |\n|---|---|\n| 1 | 2 |\n",
  },
  {
    name: "several block constructs on one page",
    markdown:
      "[[_TOC_]]\n\n::: mermaid\ngraph TD;\n  A-->B;\n:::\n\n" +
      "![i](/.attachments/image-74526ba7-70c4-41f7-837b-5949fc6e6f91.png)\n",
  },
];

describe("live preview mounted in a real editor", () => {
  for (const { name, markdown } of CONSTRUCTS) {
    it(`opens a page containing ${name}`, () => {
      const view = mount(PREAMBLE + markdown);
      try {
        // Reaching here at all is the assertion: a rejected decoration throws out of the
        // constructor. `docView` having measured proves the content was built, not skipped.
        expect(view.dom.isConnected).toBe(true);
        expect(() => view.dispatch({ selection: { anchor: 0 } })).not.toThrow();
      } finally {
        view.destroy();
      }
    });
  }

  it("survives an edit inside a block and the cursor leaving it again", () => {
    const view = mount(`${PREAMBLE}::: mermaid\ngraph TD;\n  A-->B;\n:::\n`);
    try {
      const inside = view.state.doc.line(6).from + 2;
      expect(() => view.dispatch({ selection: { anchor: inside } })).not.toThrow();
      expect(() => view.dispatch({ changes: { from: inside, insert: "  C-->D;\n" } })).not.toThrow();
      expect(() => view.dispatch({ selection: { anchor: 0 } })).not.toThrow();
    } finally {
      view.destroy();
    }
  });

  it("renders the block widget rather than the source text", () => {
    const view = mount(`${PREAMBLE}[[_TOC_]]\n`);
    try {
      // The proof that the decoration was accepted, not merely that nothing threw.
      expect(view.contentDOM.querySelector(".adowiki-toc")).not.toBeNull();
      expect(view.contentDOM.textContent).not.toContain("[[_TOC_]]");
    } finally {
      view.destroy();
    }
  });

  /**
   * `@<Alex Green>` is an HTML tag to the markdown highlighter, which hands back
   * `cm-hmd-html-begin` / `cm-tag` / `cm-attribute` / `cm-bracket` tokens — and CodeMirror splits a
   * *mark* decoration at every one of them. The chip styling landed on all twelve fragments, so one
   * mention drew as a row of little boxes: `@ ‹ Alex Green ›` (round 6). A replace widget
   * cannot be split.
   */
  it("draws an @<alias> mention as one chip, not one per syntax token", () => {
    const view = mount(`${PREAMBLE}Ask @<Alex Green> about the delimiter.\n`);
    try {
      const chips = view.contentDOM.querySelectorAll(".adowiki-mention");
      expect(chips).toHaveLength(1);
      expect(chips[0].textContent).toBe("@Alex Green");
      expect(view.contentDOM.textContent).not.toContain("@<Alex Green>");
    } finally {
      view.destroy();
    }
  });

  it("shows the mention source again when the cursor is inside it", () => {
    const text = `${PREAMBLE}Ask @<Alex Green> about the delimiter.\n`;
    const view = mount(text);
    try {
      view.dispatch({ selection: { anchor: text.indexOf("Alex") + 2 } });
      expect(view.contentDOM.querySelectorAll(".adowiki-mention")).toHaveLength(0);
      expect(view.contentDOM.textContent).toContain("@<Alex Green>");
    } finally {
      view.destroy();
    }
  });

  it("still marks a work-item reference rather than replacing it", () => {
    const view = mount(`${PREAMBLE}Fixed in #4567 and !89.\n`);
    try {
      expect(view.contentDOM.querySelector(".adowiki-workitem")?.textContent).toBe("#4567");
      expect(view.contentDOM.querySelector(".adowiki-pullrequest")?.textContent).toBe("!89");
      // Marked, not replaced — the digits are still editable text.
      expect(view.contentDOM.textContent).toContain("#4567");
    } finally {
      view.destroy();
    }
  });

  /**
   * The constraint itself, so the tests above cannot quietly stop proving anything: if a future
   * CodeMirror drops this guard, or if someone concludes the rule was imagined, this fails and
   * says so. It is also the exact shape the shipped bug had.
   */
  it("still rejects a block decoration served from a ViewPlugin", () => {
    const illegal = ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = Decoration.set([
            Decoration.replace({ widget: new BlankWidget(), block: true }).range(
              view.state.doc.line(1).from,
              view.state.doc.line(1).to,
            ),
          ]);
        }
      },
      { decorations: (value) => value.decorations },
    );

    const parent = document.body.appendChild(document.createElement("div"));
    expect(
      () =>
        new EditorView({
          state: EditorState.create({ doc: "one\ntwo\n", extensions: [illegal] }),
          parent,
        }),
    ).toThrow(/Block decorations may not be specified via plugins/);
  });
});

class BlankWidget extends WidgetType {
  toDOM(): HTMLElement {
    return document.createElement("div");
  }
}
