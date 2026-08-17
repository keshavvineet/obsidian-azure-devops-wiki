import { describe, expect, it } from "vitest";
import { applyFixes, lintDocumentOf, lintPage } from "../src/lint/lintEngine";
import { ALL_RULES } from "../src/lint/rules";
import type { LintFinding, LintHost, LintRule } from "../src/lint/types";
import { applyEdits } from "../src/lint/types";

/** A vault where the pages below exist and everything in .attachments resolves. */
function hostWith(pages: Record<string, string> = {}): LintHost {
  return {
    resolves: (href) =>
      href.startsWith("/.attachments/known") ||
      Object.values(pages).includes(href) ||
      href === "/Existing-Page",
    converterHost: () => ({
      resolvePage: (target) =>
        pages[target] ? { wikiPath: pages[target], title: target } : null,
      resolveAttachment: (target) =>
        target === "known.png" ? { linkTarget: "/.attachments/known.png" } : null,
    }),
  };
}

/** Run one rule over a page and return its findings. */
function run(rule: LintRule, text: string, host: LintHost = hostWith()): LintFinding[] {
  return lintPage(lintDocumentOf("Page.md", text), host, { rules: [rule] });
}

const ruleById = (id: string): LintRule => {
  const rule = ALL_RULES.find((candidate) => candidate.id === id);
  if (!rule) throw new Error(`no rule ${id}`);
  return rule;
};

/** Apply a finding's fix and return the resulting text — how every fix is asserted here. */
function fixed(text: string, findings: LintFinding[]): string {
  return applyEdits(text, findings.flatMap((finding) => finding.fix?.edits ?? []));
}

describe("obsidian-wikilink", () => {
  const rule = ruleById("obsidian-wikilink");

  it("converts a resolvable wikilink to an Azure DevOps link", () => {
    const host = hostWith({ "Some Page": "/Parent/Some-Page" });
    const findings = run(rule, "See [[Some Page]] for details.", host);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(fixed("See [[Some Page]] for details.", findings)).toBe(
      "See [Some Page](/Parent/Some-Page) for details.",
    );
  });

  it("reports but cannot fix a link to a page that does not exist", () => {
    const findings = run(rule, "[[Nowhere]]");
    expect(findings[0].fix).toBeUndefined();
    expect(findings[0].advice).toContain("Create the page");
  });

  it("keeps an alias and converts a heading link", () => {
    const host = hostWith({ Page: "/Page" });
    const text = "[[Page#Seed data|the seeds]]";
    expect(fixed(text, run(rule, text, host))).toBe("[the seeds](/Page#seed-data)");
  });

  it("never touches [[_TOC_]] or [[_TOSP_]]", () => {
    expect(run(rule, "[[_TOC_]]\n[[_TOSP_]]")).toEqual([]);
  });

  it("ignores a wikilink inside code", () => {
    expect(run(rule, "```\n[[Some Page]]\n```")).toEqual([]);
    expect(run(rule, "`[[Some Page]]`")).toEqual([]);
  });

  it("converts an embed of a file that is already in .attachments", () => {
    const text = "![[known.png]]";
    expect(fixed(text, run(rule, text))).toBe("![known.png](/.attachments/known.png)");
  });

  it("refuses to convert a page embed", () => {
    const host = hostWith({ Page: "/Page" });
    const findings = run(rule, "![[Page]]", host);
    expect(findings[0].fix).toBeUndefined();
    expect(findings[0].message).toContain("embeds another page");
  });
});

describe("obsidian-comment and ==highlight==", () => {
  it("turns an Obsidian comment into an HTML one", () => {
    const rule = ruleById("obsidian-comment");
    const text = "before %%secret note%% after";
    expect(run(rule, text)[0].severity).toBe("error");
    expect(fixed(text, run(rule, text))).toBe("before <!--secret note--> after");
  });

  it("turns a highlight into <mark>", () => {
    const rule = ruleById("obsidian-highlight");
    const text = "this is ==important== here";
    expect(fixed(text, run(rule, text))).toBe("this is <mark>important</mark> here");
  });

  it("leaves the == in a production attachment name alone", () => {
    const rule = ruleById("obsidian-highlight");
    expect(run(rule, "![==image_0==-abc.png](/.attachments/==image_0==-abc.png)")).toEqual([]);
  });
});

describe("obsidian-tag", () => {
  const rule = ruleById("obsidian-tag");

  it("flags a letter tag", () => {
    const findings = run(rule, "Filed under #architecture today");
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("#architecture");
  });

  it("never flags a work-item reference", () => {
    expect(run(rule, "See #229849 for the details")).toEqual([]);
  });

  it("never flags a heading", () => {
    expect(run(rule, "# Title\n## Sub")).toEqual([]);
  });
});

describe("obsidian-callout", () => {
  const rule = ruleById("obsidian-callout");

  it("keeps the quote and bolds the title", () => {
    const text = "> [!warning] Read this first\n> body";
    expect(fixed(text, run(rule, text))).toBe("> **Read this first**\n> body");
  });

  it("uses the callout type when there is no title", () => {
    const text = "> [!note]";
    expect(fixed(text, run(rule, text))).toBe("> **Note**");
  });
});

describe("table-needs-blank-line", () => {
  const rule = ruleById("table-needs-blank-line");

  it("inserts the blank line above a table that follows a paragraph", () => {
    const text = "Some intro text\n| a | b |\n| - | - |\n| 1 | 2 |\n";
    const findings = run(rule, text);
    expect(findings).toHaveLength(1);
    expect(fixed(text, findings)).toBe("Some intro text\n\n| a | b |\n| - | - |\n| 1 | 2 |\n");
  });

  it("inserts blank lines on both sides when text follows the table too", () => {
    const text = "intro\n| a |\n| - |\n| 1 |\noutro";
    expect(fixed(text, run(rule, text))).toBe("intro\n\n| a |\n| - |\n| 1 |\n\noutro");
  });

  it("says nothing about a table that is already spaced", () => {
    expect(run(rule, "intro\n\n| a |\n| - |\n| 1 |\n\noutro")).toEqual([]);
  });
});

describe("mermaid-unsupported", () => {
  const rule = ruleById("mermaid-unsupported");

  it("rewrites flowchart to graph in a fence", () => {
    const text = "```mermaid\nflowchart TD\n  A-->B\n```";
    const findings = run(rule, text);
    expect(findings[0].message).toContain("flowchart");
    expect(fixed(text, findings)).toContain("graph TD");
  });

  it("shortens a long arrow inside a ::: mermaid block", () => {
    const text = "::: mermaid\ngraph LR\n  A---->B\n:::";
    expect(fixed(text, run(rule, text))).toContain("A-->B");
  });

  it("leaves a flowchart outside a diagram alone", () => {
    expect(run(rule, "The flowchart below explains it.")).toEqual([]);
  });
});

describe("broken-link", () => {
  const rule = ruleById("broken-link");

  it("reports a page link that resolves to nothing", () => {
    const findings = run(rule, "[gone](/No-Such-Page)");
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain("/No-Such-Page");
  });

  it("says nothing about an external link or an anchor", () => {
    expect(run(rule, "[x](https://example.com) [y](#heading)")).toEqual([]);
  });

  it("says nothing about a link that resolves", () => {
    expect(run(rule, "[ok](/Existing-Page)")).toEqual([]);
  });
});

describe("page-name-not-portable", () => {
  const rule = ruleById("page-name-not-portable");

  it("accepts an encoded ADO name", () => {
    const doc = lintDocumentOf("Parent-Page/Pre%2DRelease%3A-Q&A%3F.md", "text");
    expect(lintPage(doc, hostWith(), { rules: [rule] })).toEqual([]);
  });

  it("rejects a file name with literal spaces and says what to rename it to", () => {
    const doc = lintDocumentOf("7.4 New Test Page.md", "text");
    const findings = lintPage(doc, hostWith(), { rules: [rule] });
    expect(findings).toHaveLength(1);
    expect(findings[0].advice).toContain('"7.4-New-Test-Page.md"');
  });

  it("blames the ancestor folder when that is the broken segment", () => {
    const doc = lintDocumentOf("Bad Folder/Good-Page.md", "text");
    const findings = lintPage(doc, hostWith(), { rules: [rule] });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("every page under it");
  });
});

describe("the rule set", () => {
  it("has unique ids", () => {
    const ids = ALL_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("finds every seeded incompatibility in one page", () => {
    const page = [
      "# Fixture",
      "",
      "A [[Some Page]] link and an ==important== word.",
      "",
      "%%a leaked comment%%",
      "",
      "> [!note] Careful",
      "",
      "Intro text",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "```mermaid",
      "flowchart TD",
      "```",
      "",
      "A #tag and a [^1] footnote and a [broken](/No-Such-Page) link.",
    ].join("\n");

    const findings = lintPage(
      lintDocumentOf("Fixture.md", page),
      hostWith({ "Some Page": "/Some-Page" }),
    );
    const rules = new Set(findings.map((finding) => finding.rule));

    expect(rules).toEqual(
      new Set([
        "obsidian-wikilink",
        "obsidian-highlight",
        "obsidian-comment",
        "obsidian-callout",
        "table-needs-blank-line",
        "mermaid-unsupported",
        "obsidian-tag",
        "obsidian-footnote",
        "broken-link",
      ]),
    );
  });

  it("reports the most severe findings first", () => {
    const findings = lintPage(
      lintDocumentOf("P.md", "%%leak%% and a ==highlight=="),
      hostWith(),
    );
    expect(findings.map((finding) => finding.severity)).toEqual(["error", "warn"]);
  });
});

describe("applyFixes", () => {
  it("applies every non-overlapping fix in one pass", () => {
    const text = "%%one%% and ==two==";
    const findings = lintPage(lintDocumentOf("P.md", text), hostWith());
    const outcome = applyFixes(text, findings);

    expect(outcome.text).toBe("<!--one--> and <mark>two</mark>");
    expect(outcome.deferred).toEqual([]);
  });

  it("defers a fix that overlaps one already applied, keeping the severe one", () => {
    const text = "x";
    const findings: LintFinding[] = [
      {
        rule: "a",
        severity: "warn",
        message: "",
        path: "P.md",
        from: 0,
        to: 1,
        line: 0,
        fix: { description: "", edits: [{ from: 0, to: 1, text: "warn" }] },
      },
      {
        rule: "b",
        severity: "error",
        message: "",
        path: "P.md",
        from: 0,
        to: 1,
        line: 0,
        fix: { description: "", edits: [{ from: 0, to: 1, text: "error" }] },
      },
    ];

    const outcome = applyFixes(text, findings);
    expect(outcome.text).toBe("error");
    expect(outcome.deferred.map((finding) => finding.rule)).toEqual(["a"]);
  });

  it("leaves the text alone when nothing is fixable", () => {
    const text = "[broken](/No-Such-Page)";
    expect(applyFixes(text, lintPage(lintDocumentOf("P.md", text), hostWith())).text).toBe(text);
  });
});
