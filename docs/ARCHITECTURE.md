# Architecture — Azure DevOps Wiki plugin for Obsidian

Companion to [REQUIREMENTS.md](REQUIREMENTS.md). Format ground truth: [ADO-WIKI-FORMAT.md](ADO-WIKI-FORMAT.md).
Syntax rules: [SYNTAX-MAPPING.md](SYNTAX-MAPPING.md). Build order: [../PLAN.md](../PLAN.md).

## 1. Technology stack

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript 5.x, `strict: true` | Obsidian API is TS-first |
| Bundler | esbuild (single `main.js`, CJS, external: `obsidian`, `electron`, `@codemirror/*`) | community-plugin standard |
| Obsidian API | `obsidian` d.ts, `minAppVersion` 1.5+ | CM6 editor extensions, `registerEditorExtension` |
| Editor integration | CodeMirror 6 `StateField` (block decorations) + `ViewPlugin` (inline) for live preview, `MarkdownPostProcessor` for reading mode | the two rendering pipelines in Obsidian; the split is forced — see §4.4b |
| Git | system `git` binary via `child_process.execFile` | credential helpers, proxies, SSH all "just work"; same approach as the obsidian-git plugin |
| ADO REST | `fetch` (Obsidian's `requestUrl` to bypass CORS) + PAT | work-item search/titles |
| Unit tests | vitest, pure-logic modules only | codecs/converters are the risk surface |
| Lint/format | eslint + prettier (repo defaults) | |

**Desktop-only** (`isDesktopOnly: true`): git via child_process. Every non-git feature is
written against the Vault API only, so a mobile build without git remains possible later.

## 2. Module map

```
src/
├── main.ts                     # Plugin class: wiring, lifecycle, settings load
├── settings.ts                 # AdoWikiSettings model + SettingTab UI
├── constants.ts                # limits (235/18MB/19MB), regexes, branch default
├── strings.ts                  # user-facing strings (single module)
│
├── naming/
│   ├── pageNameCodec.ts        # encodeTitle(title) ⇄ decodeFileName(name)  [PURE]
│   ├── titleValidator.ts       # ADO title rules → ValidationResult          [PURE]
│   ├── displayTitle.ts         # which explorer rows to relabel, and to what [PURE]
│   ├── anchors.ts              # ADO heading→anchor algorithm                [PURE]
│   ├── portableName.ts         # is this a name ADO can load? + the fix       [PURE]
│   └── titleDecorator.ts       # DOM decoration of explorer + tab/window/inline titles,
│                               #   plus the "not published yet" change marks
│
├── order/
│   ├── orderFile.ts            # parse/serialize/reconcile .order            [PURE]
│   └── orderManager.ts         # vault-event hooks, repair command, reorder, home page
│
├── pages/
│   ├── pageIndex.ts            # cached tree: file ⇄ title ⇄ wiki path (core index)
│   ├── pageCommands.ts         # new page / new subpage / rename / delete
│   ├── pageModals.ts           # title prompt with live validation, confirm dialog
│   ├── pageSwitcher.ts         # "Open wiki page" fuzzy switcher over decoded titles
│   ├── treeModel.ts            # tree shape + reorder arithmetic              [PURE]
│   ├── pageNameGuard.ts        # warns when a new/renamed file name is one ADO cannot load
│   ├── folderPlan.ts           # what a folder ADO cannot represent should become  [PURE]
│   ├── folderGuard.ts          # turns a folder created in the explorer into a page
│   ├── creationInterceptor.ts  # asks for the title before Obsidian writes Untitled
│   └── wikiTreeView.ts         # sidebar ItemView: ordered tree, drag-reorder
│
├── links/
│   ├── adoLinkResolver.ts      # '/x/y' or '/.attachments/z' → TFile         [uses pageIndex]
│   ├── linkTargets.ts          # find/rewrite link targets in page text       [PURE]
│   ├── linkConverter.ts        # wikilink AST → ADO link text                [PURE]
│   ├── adoBlocks.ts            # ::: blocks + the mid-paragraph table repair        [PURE]
│   ├── documentBlocks.ts       # renderable blocks + headings of a page's raw lines [PURE]
│   ├── readingModeProcessor.ts # MarkdownPostProcessor: img/src rewrite, page links, TOC/TOSP, :::-blocks
│   ├── livePreviewExtension.ts # CM6 decorations: block widgets (TOC/TOSP/mermaid/images/tables), WI chips
│   └── pasteHandler.ts         # editor-paste/drop → .attachments + ADO link
│
├── toolbar/
│   ├── toolbarView.ts          # toolbar DOM above editor, per-leaf
│   └── formatActions.ts        # insert/wrap primitives shared with commands [PURE-ish]
│
├── workitems/
│   ├── adoClient.ts            # REST: WIQL search, batch get titles; requestUrl; cache
│   ├── workItemSuggest.ts      # EditorSuggest triggered by '#'
│   └── workItemHover.ts        # hover popover (P3)
│
├── git/
│   ├── gitStatus.ts            # porcelain-v2 parser + status-bar text                [PURE]
│   ├── gitLog.ts               # `git log` records → commits + the pages they touched [PURE]
│   ├── commitMessage.ts        # commit template + change summary                     [PURE]
│   ├── gitService.ts           # execFile wrapper: status/pull/commit/push/abort; typed results
│   ├── syncOrchestrator.ts     # Refresh & Sync flows incl. conflict state machine (no obsidian)
│   ├── syncUi.ts               # Notices + conflict modal (the orchestrator's SyncUi)
│   ├── gitStatusBar.ts         # status bar + sync menu + auto-refresh timers (no ribbon icons),
│   │                           #   and the single "git status was re-read" announcement
│   └── wikiChangesView.ts      # sidebar ItemView: not-published-yet list + recent history
│
├── lint/
│   ├── types.ts                # finding/fix/rule vocabulary + edit application  [PURE]
│   ├── rules/*.ts              # the rules, grouped by what they are about       [PURE]
│   ├── lintEngine.ts           # run rules, sort, apply fixes                    [PURE]
│   ├── compatLinter.ts         # vault side: read pages, attachment checks, write fixes
│   └── lintView.ts             # results pane with fix buttons
│
├── setup/
│   ├── vaultSetup.ts           # the "Check vault setup" decisions               [PURE]
│   └── setupCheck.ts           # gathers the facts, shows the modal, applies fixes
│
├── comments/
│   ├── wikiComments.ts         # comment REST URLs + response parsing              [PURE]
│   ├── wikiCommentsClient.ts   # the calls, with typed failures instead of throws
│   └── pageActivityView.ts     # sidebar ItemView: this page's comments + git history
│
└── util/
    ├── mutationQueue.ts        # single async queue for all file mutations    [PURE]
    ├── rowKeyboardNav.ts       # roving tabindex + arrow keys, shared by the three panes [DOM-only]
    └── around.ts              # reversible method wrapper (monkey-patching)  [PURE]
```

`[PURE]` modules import nothing from `obsidian` — they are unit-testable in isolation and
form the correctness core. Everything else is thin adapter code over Obsidian APIs.

## 3. The core index (`pageIndex.ts`)

Single in-memory index built at load and maintained incrementally from vault events:

```ts
interface PageEntry {
  file: TFile;             // Obsidian handle
  title: string;           // decoded display title
  name: string;            // encoded page name, no .md — what .order lists
  wikiPath: string;        // '/Parent-Page/Child-Page' (encoded, no .md) — link target form
  titlePath: string;       // 'Parent Page/Child Page' (decoded)
  folderPath: string;      // vault-relative parent folder; '' at the wiki root
  parentPath: string|null; // parent page's file path; resolved via index.parentOf(entry)
  order: number;           // position from .order (UNORDERED when unlisted)
}
// Maps: byFilePath, byWikiPathExact + byWikiPathLower, byTitleLower, orderByFolder
```

The parent is stored as a *path*, not a reference, so entries can never hold a stale
`PageEntry` across a rebuild. Page hierarchy follows ADO's paired-folder convention
(subpages of `A/B.md` live in `A/B/`), which is not the same as the raw folder tree.

Every consumer (decorator, resolver, converter, tree view, linter) reads this index —
no consumer walks the vault itself. Rebuild is O(files); incremental updates are O(1).
Excluded from the index: `.attachments/**`, `.obsidian/**`, `.git/**`, non-`.md` files.

Views do not watch vault events themselves: the index exposes `onChange(listener)` and emits
after every rebuild, incremental update and `.order` re-read. A page created by a command, a
page arriving from a git pull and a drag-reorder therefore refresh the UI through one path.
`pagesByFolder()` returns every level in sequence in a single pass, so drawing the tree stays
one O(n log n) grouping rather than a scan per node (NFR-2).

## 4. Key flows

### 4.1 Display-title decoration (FR-1.1) — implemented in Phase 2
There is no official API to rename explorer labels. Strategy (proven by the
`front-matter-title` community plugin):
- File explorer: locate `file-explorer` leaves, set the text of `.nav-file-title-content` /
  `.nav-folder-title-content` from the row's `data-path`; re-apply on `layout-change`, index
  changes, and a `MutationObserver` per explorer container (debounced 50 ms). Rows we changed
  carry `data-adowiki-decorated`, which is what `disable()` walks to restore them.
- Tab headers & window title: wrap `WorkspaceLeaf.getDisplayText` on the prototype
  (`util/around.ts` — a local, reversible `around()`; no `monkey-around` dependency). The
  wrapper returns the index title for file-backed views and defers to the original for
  everything else, so non-page views are untouched even while patched.
- Quick switcher/search: providing a `sortText`/alias via `metadataCache` is not possible →
  ship our own "Open wiki page" fuzzy switcher over the index (`pages/pageSwitcher.ts`,
  matching on the decoded title path) and leave the native switcher alone. Native *search
  results* therefore still show encoded names; the switcher is the supported path.
- `decorateFileExplorer` toggles this live: everything above is reversible, so the setting
  takes effect without a reload.
**Risk:** DOM patching breaks on Obsidian UI updates → all of it lives in
`titleDecorator.ts`, feature-flagged, and degrades to raw names gracefully (a missing class
just means no relabelling).

#### 4.1b Claiming an explorer row without taking the explorer hostage

`singleRowPerPage` hides a page's `.md` row and makes its **folder** row open the page. Getting
that wrong once made the whole file explorer un-navigable — no folder could be expanded or
collapsed — so the contract is now explicit and covered by `tests/explorerRows.test.ts`, which
drives the real markup under jsdom:

1. **`preventDefault()` only, never `stopPropagation()`.** Obsidian's delegated explorer handler
   begins `onFileClick(e, t) { if (!e.defaultPrevented && …) }`, so `preventDefault` is enough to
   claim the row, while the arrow's own listener, drag and selection all keep working.
   `stopPropagation` on the container in the capture phase silently kills every one of them.
2. **The collapse arrow is `tree-item-icon collapse-icon`**, built by `setCollapsible`, not
   `nav-folder-collapse-indicator` (which no longer exists). `COLLAPSE_SELECTOR` matches every
   spelling; a click inside it is never ours.
3. **Open by `TFile`, never by `openLinkText`.** An unresolved link makes `openLinkText` *create*
   the file, and ADO page names are full of characters the link resolver treats as meaningful.
   The index already holds the exact file, so there is nothing to resolve.

**How these were verified, and how to verify the next one.** Obsidian's own source is readable:
`%APPDATA%/obsidian/obsidian-<version>.asar` is a plain asar (4-byte header size at offset 12,
JSON directory, payload after it) whose `app.js` contains the file-explorer implementation. Read
it before guessing at host DOM or API behaviour — three review sessions found nothing in code
that looked correct, and one grep for `nav-folder-title` settled it.

### 4.1a Wiki tree (FR-2.3, FR-2.4)
`pages/wikiTreeView.ts` draws `pageIndex.pagesByFolder()` through the pure `treeModel`, so the
sidebar shows the ADO page hierarchy (paired folders as one node) in `.order` sequence. Drag
reorders **siblings only** — changing a page's parent means renaming its file plus folder and
rewriting inbound links, which is the Rename command's job. The view hands OrderManager the
full sequence it is displaying (`reorder(folder, names)`) rather than an index, so what lands
in `.order` is exactly what the user arranged; the context menu offers the same move up/down
without dragging, plus new subpage / rename / delete / set-as-home-page (root pages only).

### 4.1d Why every sidebar pane mounts lazily — Phase 12

Reproduced under CDP against Obsidian 1.12.7: a leaf can hold the **real** view object with
`isDeferred === false` while `onOpen()` was **never called**. The Wiki pages pane was therefore
blank — `treeEl` was null and `render()` returned at its first line — and `lintView` was worse,
because `headerEl` was a `!` field and `repaint()` threw on `undefined.empty()`.

Both now build themselves in an idempotent `ensureMounted()` that *every* entry point calls
(`onOpen`, `render`/`repaint`, `revealActiveFile`, and `onResize`, which fires when a collapsed
sidebar is opened). Obsidian defers sidebar views that are not visible (1.7.2+) and swaps the real
one in later; whatever the exact path, **a view that can only draw itself from one host hook is a
view that silently shows nothing.**

### 4.1c Keyboard navigation in the three panes (FR-2.4) — Phase 11
`util/rowKeyboardNav.ts` is one helper shared by the wiki tree, the compatibility results and the
wiki changes pane, because all three are the same interaction: a vertical list of rows operated
with the arrow keys. Rows carry a **roving tabindex** (exactly one is `0`), so Tab enters the list
where the user left it and leaves it in one press instead of walking every page in the wiki.

The two hard parts are both about surviving a redraw — every pane rebuilds its rows from scratch on
a pull, an `.order` write or a rescan:

- Rows are identified by a **caller-supplied key** (vault path, commit sha, finding coordinates),
  never by element, because no element survives the rebuild.
- "Did this pane have the caret" is captured in `beginRender()`, **before** the container is
  emptied. Reading it afterwards is always `false` — detaching the focused row sends
  `document.activeElement` to `<body>` — so focus is never restored and navigation silently ends
  mid-list. Guarded by `tests/rowKeyboardNav.test.ts`, which builds real DOM for exactly this.

A background redraw therefore places the tab stop but does **not** move the caret, so a Refresh
landing while the user is typing cannot steal focus out of the editor.

### 4.2 New subpage (FR-1.2)
```
input title ─▶ titleValidator ─▶ encodeTitle ─▶ ensure paired folder exists
  ─▶ vault.create('<folder>/<Encoded-Name>.md') ─▶ orderManager.append(folder, name)
  ─▶ open leaf ─▶ pageIndex incremental update (event-driven)
```
Rename additionally: `fileManager.renameFile` (folder + md), rewrite inbound links
(from index reverse-link map), update `.order` line in place (preserving position).

Entry points, all of them landing in `promptCreate`: the two commands, **New subpage** on the wiki
tree's context menu *and* on the file explorer's, and an **Under** dropdown on the create prompt
(`PageCommands.parentChoices`). Rename has no such dropdown on purpose — see Phase 11 note 6.

### 4.2b Asking for the name first (`creationInterceptor`) — Phase 12

`FileManager.createNewMarkdownFile` and `createNewFolder` are wrapped, because the asar shows all
six routes to a new note or folder converge there — both explorer menus, both header buttons and
both global commands. Three constraints, each read out of Obsidian rather than guessed:

- **Never return null.** Three callers null-check via `afterCreate`; the global
  `file-explorer:new-folder` command does not. Cancelling falls back to the original method.
- **`""` is not a name.** `file-explorer:new-file` calls `createAndOpenMarkdownFile("", "tab")`, and
  Obsidian's own `createNewFile` treats any falsy name as absent.
- **Obsidian starts its own rename on the result** (`eState: {rename: "all"}` for a file). Harmless:
  the name is already correct, and the inline title is read-only while decorated (Phase 7 note 4).

### 4.2a Folders, which Azure DevOps does not have — Phase 11

A wiki has pages. `A/B/` exists only as the container for the subpages of `A/B.md`, and `.order`
lists page names, so a folder created on its own is listed nowhere, owned by no page, and orphans
everything put inside it. Obsidian offers *New folder*, so users make them.

```
vault 'create'/'rename' (TFolder) ─▶ folderGuard.check ─▶ 2 s settle ─▶ re-decide vs live vault
  ─▶ planFolderAdoption(path, {hasPairedPage})   [PURE]
  ─▶ rename folder to the encoded name ─▶ vault.create('<Encoded-Name>.md')
  ─▶ the ordinary create event puts it in the parent's .order
```

Four guards, each load-bearing (Phase 11 notes 1, 4, 5):

- **The settle delay.** *New folder* creates `Untitled` and opens the row for renaming, so the name
  the user means arrives on the `rename` event, not the `create`.
- **Re-decided at flush time**, against `vault.getAbstractFileByPath` rather than the index — a
  folder that has since been deleted, renamed or paired with a page drops out.
- **Never a collision.** If the page path or the renamed folder path is already taken, nothing
  happens.
- **Stands down during a git flow** (`syncFlowActive`), because a checkout delivers a folder and its
  paired page as two events. Held work resumes on `folderGuard.resume()` when the state returns to
  idle — a signal, not a poll, because a conflict dialog can hold the state for hours.

### 4.3 Reading-mode rendering (FR-3.1/3.3, FR-4)
One registered `MarkdownPostProcessor`, running each pass inside its own `try/catch`: a
post-processor that throws makes Obsidian render that section as **nothing**, so the user gets a
blank page and no error they can act on.
- **Attachments: `.internal-embed[src]`, not `img`.** Obsidian only emits an `<img>` when the
  target looks like a URL. A markdown image pointing anywhere else becomes an *internal embed*
  handed to the link resolver, which cannot see a root-absolute path into a dot-folder — the
  output is `<span class="internal-embed … mod-empty-attachment" src="/.attachments/…">“…” could
  not be found.</span>`. Matching only `img` is why reading mode showed that sentence while live
  preview showed the picture (round 6). Both shapes are handled; the replacement carries **only**
  `adowiki-*` classes, because Obsidian keeps processing anything with `internal-embed` and will
  empty an element of ours that wears it.
- `a[href^="/"]` → intercept click → `adoLinkResolver` → `AdoLinkService.open`
- text nodes: `[[_TOC_]]` → TOC from the index's headings; `[[_TOSP_]]` → subpage list from index;
  `#\d+` → WI anchor; `@<…>` → mention chip
- **`@<Alias>` mentions are rescued before the inline pass.** `<Vineet Khurana>` parses as an HTML
  element named `vineet` with an attribute `khurana`, so the name is gone from the DOM and the
  paragraph reads `@ @ : …`. The paragraph is re-rendered from source with the delimiters escaped
  (`@&lt;…&gt;`), which brings the name back as text for the inline pass to chip — the same
  approach, and the same nested-render caveat, as the table repair. Only the alias form is
  affected: an HTML tag name must start with a letter, so ADO's usual `@<…guid>` survives as text.
- `::: mermaid` blocks arrive as plain paragraphs → re-render via Obsidian's Mermaid
  (```mermaid) pipeline into a replacement element. `::: video/query-table` → placeholder cards.

### 4.4 Live preview (CM6) — reworked in Phase 6, split in two in round 5
**Two decoration sources**, both at `Prec.highest`: a `StateField` for the block half and a
`ViewPlugin` for the inline half (see 4.4b for why they cannot be one). It renders the
same things reading mode does, because that is where users actually work:

- **Whole-line constructs → `Decoration.replace({block: true})`** spanning the line(s):
  `[[_TOC_]]` and `[[_TOSP_]]` become the generated list, `::: mermaid` becomes the diagram
  (handed to Obsidian's own ```` ```mermaid ```` pipeline, as in reading mode),
  `::: video`/`::: query-table` become cards, and an image alone on a line becomes the picture.
- Inline: `#123` / `!123` → mark decorations + mod-click; an inline root-absolute image → replace
  widget; a macro inside a paragraph → chip. **`@<…>` is a replace widget, not a mark**: the
  markdown highlighter reads it as HTML and hands back `cm-hmd-html-begin` / `cm-tag` /
  `cm-attribute` / `cm-bracket` tokens, and CodeMirror splits a mark at every one of them — the
  chip styling landed on all twelve fragments and one mention drew as a row of little boxes
  (round 6). A widget cannot be split, and it shows the same label reading mode does.
- The block source is shown raw whenever the selection touches it, so it stays editable.
- Nothing inside code blocks, inline code, frontmatter or math (syntax tree).

**Why block decorations, and why `Prec.highest`.** Obsidian's own live preview already puts
inline decorations on `[[…]]` and on `![…](…)`. When two *inline* replacements cover the same
text, CodeMirror's `SpanCursor` keeps the point decoration from the lower-ranked (earlier)
extension and skips the rest — so a plugin's decoration silently loses and the user sees
Obsidian's broken-image/unresolved-link rendering instead. A **block** replacement opens at
`startSide ≈ -3e8` versus an inline one's `≈ 5e8`, so it always sorts first; `Prec.highest`
covers the inline cases by making ours the earlier extension. This was the cause of the
"TOC/images/Mermaid do not render" reports (PLAN notes 7–9).

`links/documentBlocks.ts` [PURE] does the parsing — renderable blocks and headings from raw
lines, skipping fences and frontmatter. Headings come from the **CM6 document**, not
`metadataCache`, so the table of contents updates as headings are typed. The parse is cached
per document version (~1 ms for a 2,400-line page; see `tests/performance.test.ts`).

### 4.4b Why block decorations live in a `StateField` — round 5
**CodeMirror refuses a block decoration from a `ViewPlugin`, and the punishment is that the page
does not open at all.** `DocView.updateDeco` marks a decoration source *dynamic* when its
`EditorView.decorations` facet value is a function — which is exactly what
`ViewPlugin.fromClass(…, { decorations })` installs — and `ContentBuilder.point` then throws
`RangeError: Block decorations may not be specified via plugins` (there is a sibling guard for a
non-block replacement that spans a line break). That throw happens while the editor builds its
content, i.e. synchronously inside `MarkdownView.onLoadFile`. `FileView.loadFile` catches it,
nulls `this.file`, and raises `msgFailedToLoadFile` — **and Obsidian interpolates that message
under the wrong key (`{plugin: …}` into a `{{filepath}}` template), so the notice reads
`Failed to open ""` with empty quotes, naming nothing.** The real error is only in
`console.error` beside it.

Consequences worth keeping in mind:

- Block decorations must come from a **static** source: a `StateField` whose `provide` is
  `EditorView.decorations.from(field)`. State is enough — document and selection are both there.
- **A `try/catch` around building the set cannot catch this.** The builder succeeds; CodeMirror
  rejects the set later, when it consumes it. The catch that used to claim otherwise was wrong.
- There is no viewport in a `StateField`, so block decorations are built for the whole document.
  That is not a performance regression: CodeMirror only calls `toDOM` for widgets it draws, and
  the widgets carry `estimatedHeight` for the rest — so no Mermaid diagram, markdown render or
  image decode happens off-screen anyway.
- Do **not** "fix" a recurrence by flipping `block: false`: multi-line blocks then hit the
  line-break guard, and single-line ones lose the precedence fight the block flag exists to win.

`tests/livePreviewMount.test.ts` mounts a real `EditorView` per ADO block construct, and asserts
the guard is still live, because every unit test of the decoration logic passed while 7 of the 11
pages in `test-vault` could not be opened.

### 4.4a Compatibility linter (FR-8) — Phase 6
`lint/rules/*` are pure functions `(LintDocument, LintHost) → LintFinding[]`; a finding is a
character range plus an optional fix expressed as text edits. `lint/lintEngine.ts` [PURE] runs
them, sorts by severity, stamps each finding with the text it was computed from, and applies
fixes (last-first, dropping any that overlap one already applied). `lint/compatLinter.ts` is
the only part that touches the vault: it reads pages, adds the cross-file checks (attachment
size, attachments nothing links to), and re-reads a file before fixing it — a page edited since
the scan is skipped rather than patched at offsets that have moved. `lint/lintView.ts` is the
results pane; the pre-sync gate in `main.ts` lints only the pages git reports as changed.

### 4.5 Sync state machine (FR-7) — implemented in Phase 3
```
IDLE ─Refresh─▶ FETCH ─behind=0─▶ IDLE(“up to date”)
                    └─behind>0─▶ PULLING(rebase,autostash) ─ok─▶ IDLE(toast: N pages updated)
                    └─conflict─▶ CONFLICT ─user choice per file─▶ resolve(mine/server)
                                     │                             └▶ rebase --continue ─▶ IDLE
                                     └─"Ask engineer"─▶ rebase --abort ─▶ IDLE (nothing lost)
IDLE ─Sync─▶ LINT(optional gate) ─▶ FLUSH(.order queue) ─▶ STAGE(add -A -- .)
        ─▶ COMMIT(template) ─▶ FETCH ─behind>0─▶ PULLING ─▶ PUSH ─▶ IDLE
```
Guard rails checked before any flow: git binary present, is a repo, no in-progress
merge/cherry-pick/revert (an in-progress **rebase** is resumed through the conflict flow
instead of refused — a user who closed Obsidian mid-conflict must not be stranded),
not detached, branch == configured wiki branch, branch has an upstream. All git calls:
`execFile('git', [...], {cwd: vaultBasePath})`, never shell-interpolated; 60s timeout
(120s for network commands); `GIT_TERMINAL_PROMPT=0` so a credential prompt can never hang
the UI; stdout/stderr captured into a typed `GitResult`. The plugin never runs destructive
commands (`reset --hard`, `push --force`, `clean`) — conflict resolution uses
`checkout --ours/--theirs <file>` within the rebase only, and `tests/gitSafety.test.ts`
holds that line by reading the source.

**The `--ours` inversion.** Inside a rebase, git's `--ours` is the branch being rebased *onto*
(the server) and `--theirs` is the user's replayed work. "Keep my version" therefore maps to
`--theirs`. That single fact is why conflict resolution lives behind
`gitService.resolveConflict(path, 'mine'|'server')` and is covered by tests that assert the
resulting file content, not the flag.

A background flow (auto-refresh, sync on quit) runs `unattended`: it never opens the conflict
dialog, aborts the rebase instead, and leaves the work committed locally for the next Refresh.

#### 4.5a "Changed" means the text changed, not that `git status` said so

`git status` calls a file modified whenever its cached stat no longer matches disk, and on Windows
that happens without a character changing: Obsidian always saves LF, git checks pages out as CRLF
whenever `core.autocrlf=true` (the Git-for-Windows default), and every page the user edits then
stays "modified" for good. The reference wiki had three such pages — byte-identical to their
committed blob (`git hash-object` matched exactly) and permanently listed by `git status` while
`git diff` reported nothing.

So `GitStatusBar.refreshStatus()` intersects the status with `git diff --name-only`
(`GitService.contentChangedPaths`) through the pure `withoutUnchangedFiles`, **once**, before any
UI sees it. Untracked, renamed and conflicted entries pass through untouched — none of them is an
"is the text different" question — and a diff that fails filters nothing, because hiding real work
is the worse failure. `Check vault setup` separately offers `core.autocrlf=input` **for that clone
only**, which stops it recurring.

### 4.6 Work-item suggester (FR-6.2)
`EditorSuggest` with trigger: `#` preceded by start-of-line/whitespace, followed by `\d*`
or query text. Queries `adoClient.search(text)`:
- digits → `GET _apis/wit/workitems?ids=…` (+ WIQL `CONTAINS` fallback)
- text → WIQL `SELECT [System.Id],[System.Title] WHERE [System.Title] CONTAINS '…'`
LRU cache (15 min TTL). No PAT configured → suggester disabled (plain `#` typing untouched).

## 5. Settings model

```ts
interface AdoWikiSettings {
  // connection
  organizationUrl: string;   // https://dev.azure.com/{org}
  project: string;
  wikiName: string;          // for web deep links
  pat: string;               // '' = REST features off; warning shown; env ADO_WIKI_PAT wins
  // git
  gitEnabled: boolean;       // engineers may turn the whole git UI off (live, no reload)
  wikiBranch: string;        // default 'wikiMain'; adopted from the clone when it is 'wikiMaster'
  autoRefreshOnOpen: boolean;
  autoRefreshIntervalMin: number;  // 0 = off
  autoSyncOnClose: boolean;        // opt-in; unattended, so conflicts abort instead of asking
  commitMessageTemplate: string;   // 'wiki: edited {files} ({date})'
  preSyncLint: 'off'|'warn'|'block';
  // editing
  wikilinkConversion: 'insert'|'save'|'off';
  showToolbar: boolean;
  decorateFileExplorer: boolean;
  // rendering
  renderWorkItemLinks: boolean;
  renderMentions: boolean;
}
```

## 6. Error-handling & safety policy

- Every user-triggered flow ends in either a success `Notice`, or an actionable error
  `Notice` + detail in the plugin's log (`console` + optional log file) — never silent.
- File mutations are sequenced through a single async queue (`orderManager` and
  `pageCommands` share it) to prevent racing `.order` writes.
- `.order` writes are read-modify-write with content comparison (skip no-op writes → no
  needless git noise).
- All regex-based text transforms operate on the Markdown AST boundaries where possible
  (`metadataCache` sections) to avoid touching code blocks.
- The plugin never edits files under `.git/`, never shells out to anything but `git`.

## 7. Repo hygiene for wiki vaults (shipped as docs + "Setup check" command)

The plugin's "Vault setup check" command verifies and offers to fix:
- `.gitignore` contains `.obsidian/` (plugin config must not pollute the wiki repo),
  plus `.trash/`, `.DS_Store`. Until then, Phase 3's `stageAll()` already refuses to stage
  `.obsidian/`, so an unconfigured vault cannot push it by accident.
- Vault root == repo root (paired-folder logic assumes it).
- Obsidian settings that fight the format, set per-vault when accepted:
  - "Default location for new attachments" → irrelevant (paste handler overrides) but set
    to vault root `.attachments` for non-image files,
  - "New link format" → absolute path, "Use [[Wikilinks]]" → off (belt-and-braces; the
    converter is the primary mechanism),
  - "Detect all file extensions" → off.

## 8. Testing strategy

- **Unit (vitest):** `pageNameCodec` (round-trip property tests + the four production
  examples from ADO-WIKI-FORMAT §2), `titleValidator`, `orderFile`, `linkConverter`,
  `anchors`, every lint rule. Target: 100% of PURE modules.
- **Fixture vault:** `test-vault/` in-repo, mirroring the AXBIS structure (encoded names,
  `.order` chains, `.attachments` with `==image_0==-…` names, `[[_TOC_]]`, `::: mermaid`,
  `#123` refs). Used for manual smoke tests; `npm run dev` symlinks build output into it.
- **Git flows:** integration-tested manually against a scratch ADO wiki repo (checklist in
  PLAN Phase 3); gitService unit-tested with a local bare repo fixture (no network).
- **Live ADO verification:** each phase's acceptance list includes "push fixture page,
  verify rendering in ADO web" for the syntax that phase touches.

## 9. Packaging & release

- `manifest.json` (id `azure-devops-wiki`, `isDesktopOnly: true`), `versions.json`,
  GitHub repo with release workflow (zip: `main.js`, `manifest.json`, `styles.css`).
- Distribution: GitHub releases + BRAT during beta; Obsidian community plugin submission
  after Phase 6 hardening.

## 10. Top risks & mitigations

| Risk | Mitigation |
|---|---|
| Explorer DOM patching breaks on Obsidian update | isolated module, feature flag, graceful degrade (raw names still work) |
| Encoded-name edge cases corrupt renames | codec is pure + property-tested; rename dry-runs the target path and validates before touching disk |
| Functional users hit rebase states they can't exit | conflict state machine always offers clean abort; repo state re-checked before every flow |
| `.order` divergence when users edit outside plugin commands | repair-on-event + explicit repair command; `.order` is always derivable from disk |
| OneDrive/antivirus file locking on Windows (seen: the reference wiki lives in OneDrive) | docs: clone OUTSIDE OneDrive; setup check warns when vault path is under OneDrive/Dropbox |
| PAT in plaintext `data.json` | warning in UI, env-var override, PAT is optional (only WI search/titles need it) |
| Obsidian native wikilink features (graph, backlinks) don't understand ADO links | resolver feeds `metadataCache.resolvedLinks`? Not writable → accept reduced graph fidelity in v1; document |
