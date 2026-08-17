# Syntax Mapping — Obsidian ⇄ Azure DevOps Wiki

Reference for the wikilink converter (FR-3.4/3.5), the compatibility linter (FR-8) and the
renderers (FR-4). Severity: **error** = breaks/garbles on ADO, **warn** = degrades gracefully,
**info** = cosmetic.

## 1. Obsidian syntax → what ADO does with it → required action

| Obsidian syntax | On ADO renders as | Severity | Linter fix |
|---|---|---|---|
| `[[Page Name]]` | literal `[[Page Name]]` text | error | → `[Page Name](/Path/To/Page-Name)` |
| `[[Page\|Alias]]` | literal text | error | → `[Alias](/Path/To/Page)` |
| `[[Page#Heading]]` | literal text | error | → `[Page › Heading](/Path/To/Page#heading-anchor)` (ADO anchor algorithm) |
| `[[Page#^blockid]]` | literal text | error | no ADO equivalent → link to page, drop block ref (confirm with user) |
| `![[image.png]]` (embed) | literal text | error | → `![image.png](/.attachments/image.png)` — only if file is in `.attachments`; else offer to move it there |
| `![[Page]]` (note embed) | literal text | error | no equivalent → convert to link (confirm) |
| `> [!note] Title` callouts | plain blockquote containing literal `[!note] Title` | warn | → blockquote with `**Title**` bold first line, or `<details>` for foldable |
| `==highlight==` | literal `==` chars | warn | → `<mark>highlight</mark>` (ADO renders basic HTML) |
| `%%comment%%` | literal text (leaks!) | error | → `<!-- comment -->` or strip |
| `#tag` (letters) | attempted work-item autolink? No — renders literal `#tag` | warn | frontmatter tags are invisible on ADO anyway → move to frontmatter or drop |
| YAML frontmatter `---` | **rendered as a table** by ADO (or raw text on Server) | info | leave — ADO shows frontmatter as metadata table; lint only if it contains Obsidian-only fields |
| Footnotes `[^1]` | literal text | warn | inline the footnote or convert to superscript HTML |
| `[Link](path%20with spaces.md)` relative | works if path correct | info | prefer root-absolute wiki form |
| ```` ```mermaid ```` fence | ✓ renders | ok | none |
| `$x^2$`, `$$…$$` | ✓ renders (KaTeX) | ok | lint MathJax-only macros |
| `- [ ]` task list | ✓ renders | ok | but not inside tables (ADO limitation) → warn if in table |
| Obsidian comments in dataview/templater blocks | literal text | error | flag; no auto-fix |

## 2. ADO syntax → what Obsidian does with it → required plugin behavior

| ADO syntax | In vanilla Obsidian | Plugin behavior |
|---|---|---|
| `Page-Name%2Dwith-encoding.md` | ugly file names everywhere | decode for display (explorer, tabs, switcher, search) |
| `.order` files | invisible/ignored | drives Wiki-pages sidebar ordering; maintained on CRUD |
| `![x](/.attachments/f.png)` | broken image | resolve `/` → vault root, render image |
| `[Text](/Parent/Child)` | broken link | resolve to `Parent/Child.md` (encoded lookup), clickable |
| `[[_TOC_]]` | broken wikilink to page "_TOC_" | render generated TOC widget; exclude from link graph |
| `[[_TOSP_]]` | broken wikilink | render subpage list from paired folder `.order` |
| `::: mermaid` … `:::` | plain paragraph text | render as Mermaid (same renderer as fences) |
| `::: video <url> :::` | plain text | render placeholder card with link |
| `::: query-table <guid> :::` | plain text | render placeholder chip "ADO query results" |
| `#123` | plain text (NOT a tag — numeric-only tags are invalid in Obsidian) | decorate as work-item link to ADO; hover title (P3) |
| `\#123` | `\#123` literal | leave as-is (escaped on purpose) |
| `!123` | plain text | decorate as PR link (P3) |
| `@<3b0a2131-…>` | plain text | render as `@mention` chip; name resolution P3 |
| `:smile:` emoji codes | literal text | render emoji (P3, small dictionary) |
| `<br>`, `<mark>`, `<details>` | ✓ mostly renders | none |
| `==image_0==-guid.png` inside link text | `==` may parse as highlight | image post-processor renders it; verify no mangling (test fixture exists in real wiki) |
| A pipe table on the line **straight after a paragraph line** | the whole run shows as literal `\| a \| b \|` text | re-render that section with blank lines around the table (`adoBlocks.normalizeAdoParagraph`), display only — **see §2.1** |

### 2.1 Tables: ADO's parser starts a table mid-paragraph

Verified 2026-08-10 against `Product-Engineering.wiki` (11 paragraphs affected in 96 pages) and a
user report from a production page:

- **ADO** starts a pipe table wherever a header row plus a delimiter row appear, even with no
  blank line above, and **ends the table at the first line without a `|`** (markdown-it behaviour).
  So `text / table / text / table / text` renders as five separate blocks.
- **Obsidian** (CommonMark + GFM) needs a blank line before a table, and without it renders the
  whole run as one paragraph of literal pipes.

The plugin therefore re-renders such a section with the blank lines reinstated. Both the leading
and the trailing blank line move the rendering *towards* ADO's, since ADO also breaks the table at
the pipe-less line. **The file is never modified** — this is a render-time repair, and the Phase 6
linter is the place to *offer* fixing the source (`table-needs-blank-line`).

**Both view modes, from Phase 7.** Reading mode re-renders the paragraph
(`adoBlocks.normalizeAdoParagraph`); live preview replaces just the table's rows with a block
widget rendering the table on its own (`documentBlocks` decides *which* tables — only those whose
rendering actually differs from ADO's, i.e. glued to text above or below; a table with blank lines
on both sides is left to Obsidian, cursor behaviour and all). Verified against
`AXBISDevOpsWiki` (164 pages): **61 tables** now render in edit mode that previously showed as
pipes. The reported screenshot ("the table only shows up if I add a space above it") was this.

## 3. Insertion-time conversions (what the toolbar/autocomplete writes)

These guarantee new content is ADO-native from the moment it's typed:

| User action | Written to file |
|---|---|
| Completes wikilink `[[Some Page]]` | `[Some Page](/Encoded/Path/Some-Page)` |
| Pastes/drops image `shot.png` | file → `/.attachments/shot-<uuid>.png`; text → `![shot.png](/.attachments/shot-<uuid>.png)` |
| Toolbar → Table | ADO-style pipe table with header row + blank line before |
| Toolbar → TOC | `[[_TOC_]]` on its own line |
| Toolbar → Mermaid | ```` ```mermaid ```` fence (renders on both platforms) |
| Toolbar → Math | `$$ … $$` block |
| Work-item picker → item 456 | `#456` (with surrounding spaces if adjacent to text — ADO table rule) |
| Mention picker (P3) | `@<user-guid>` |

**How the first four are placed** (Phase 12). Every whole-line construct goes through
`formatActions.padBlock`, which adds *only* the newlines that are missing: two to break out of a
paragraph, one on a blank line that sits directly under text, none when the line is already
separated. Before this, the buttons wrote their construct at the cursor — so pressing **Table** at
the end of a paragraph produced exactly the glued table that `table-needs-blank-line` exists to
report, and the toolbar was manufacturing lint findings. Pressing **Horizontal rule** twice left
four blank lines behind for the same reason.

**Mermaid inserts a fence, never `:::`** — the code used to write `::: mermaid`, contradicting both
this table and CLAUDE.md. ADO renders both, but only the fence renders in stock Obsidian and every
other markdown tool, so a diagram this plugin writes survives the plugin being switched off. `:::`
blocks already in the wiki are still *rendered* (§2), just never *written*.

**Still not implemented** from this section: the mention picker (P3, no UI) and the "offer to move
it" action for `![[image.png]]` outside `.attachments` (§1 row 5) — the linter reports those but
cannot fix them. `![[Page]]` note embeds are deliberately never converted (§1 row 6 says "confirm";
the implementation refuses instead, because a note embed has no ADO equivalent that preserves
meaning). `%%`-comments inside dataview/templater blocks (§1 row 18) and MathJax-only macros
(§1 row 16) have **no rule** — both would need a rule id in §4.1 first.

## 4. Anchor algorithm (for `[[Page#Heading]]` conversion)

ADO heading → anchor, implemented in `src/naming/anchors.ts` (Phase 4): **trim, lowercase, drop
punctuation, then turn each remaining whitespace character into a hyphen.** Consecutive hyphens
survive.

The earlier wording here said punctuation is *converted* to `-`; the documented example proves
otherwise. `#### Team #1 : Release Wiki!` → `#team-1--release-wiki`: converting `#` and `:` would
give `team--1---release-wiki`, whereas dropping them leaves two spaces around the deleted `:`,
which become the two hyphens. This is exactly `github-slugger`.

Still unverified against a live wiki (do it in Phase 5): a heading that starts or ends with
punctuation followed by a space (`!!! Careful !!!` → `-careful-` under this algorithm).

Microsoft's own guidance for same-page links agrees with the rule: "use an anchor link with the
lowercased heading text and hyphens in place of spaces".

## 4.1 Linter rule ids (Phase 6)

Every row of §1 that the linter checks, by the id shown in the settings and in findings.
`src/lint/rules/index.ts` is the authoritative list; this table is the map back to §1.

| Rule id | §1 rows | Severity | Fix |
|---|---|---|---|
| `obsidian-wikilink` | 1–6 | error | the insert-time converter, reused |
| `obsidian-comment` | 10 | error | `<!-- … -->` |
| `obsidian-highlight` | 9 | warn | `<mark>` |
| `obsidian-callout` | 7 | warn | keep the quote, bold the title |
| `obsidian-tag` | 11 | warn | — (content decision) |
| `obsidian-footnote` | 13 | warn | — |
| `task-in-table` | 17 | warn | — |
| `table-needs-blank-line` | §2.1 | warn | insert the blank line(s) |
| `mermaid-unsupported` | ADO-WIKI-FORMAT §4.1 | warn/info | `flowchart`→`graph`, shorten long arrows |
| `unterminated-colon-block` | — | warn | close the block |
| `broken-link` | FR-3.7 | error | — |
| `relative-link` | 14 | info | — |
| `page-name-not-portable` | FR-1.5 | error | — (a rename, not a text edit) |
| `page-path-too-long` | limits | error/warn | — |
| `page-too-large` | limits | error | — |
| `attachment-too-large`, `orphan-attachment` | limits | error/info | — (vault-level, in `compatLinter`) |

## 5. Known irreconcilables (document, don't fix)

- Obsidian block references (`^blockid`) — no ADO equivalent.
- Obsidian canvas files, dataview queries, templater — vault-local only; linter flags them,
  and `.gitignore`/`.gitattributes` guidance keeps `.obsidian/` out of the wiki repo (see
  ARCHITECTURE §7).
- ADO `::: query-table :::` live results — only render on ADO.
- Emoji shortcode sets differ slightly between platforms.
