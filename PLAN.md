# Implementation Plan — Azure DevOps Wiki plugin for Obsidian

Execution model: **one phase = one focused Claude (Opus) session.** Read `CLAUDE.md` + the docs
it references, implement, satisfy the acceptance criteria, tick the box here with a short
outcome note, and stop. Requirement IDs (FR-x.y) refer to
[docs/REQUIREMENTS.md](docs/REQUIREMENTS.md).

| | |
|---|---|
| **Phases complete** | 0–12 (see [Done](#done)) |
| **Tests** | 556 green (`npm test`); `npm run build` clean |
| **Installed in** | `test-vault/` and the user's `AXBISDevOpsWiki` clone |
| **Next up** | [1. Live-wiki acceptance](#1-acceptance-against-a-live-ado-wiki-p0) |

---

## What's next — in priority order

Everything below is unbuilt or unverified. The order is the order to do it in.

### 1. Acceptance against a live ADO wiki (P0)

- [ ] Push a page from Obsidian, confirm it renders in the portal.
- [ ] Make a conflicting edit in the portal, Refresh, walk both resolution paths + abort.
- [ ] Confirm "Open in Azure DevOps" lands on the right page for a nested, encoded-name page,
      and settle the `pagePath` URL form (ADO-WIKI-FORMAT §6 still marks it **unverified**).
- [ ] Confirm the work-item suggester returns results against a real project with a PAT.

**Why it is still open after eight phases:** it needs a *scratch* wiki that is safe to push to.
Every clone on this machine is production. Everything that does not require ADO's own auth and
renderer is already covered by the unit suite and by `npm run verify-wiki` audits of real clones.
**This is now the only thing standing between the plugin and a real release** — do it first, and
cover the whole list in one pass.

### 2. Confirm the round-5 and round-6 fixes in the user's own vault (P0)

Verified under CDP against a copy of `test-vault` (see round 5 below), so this is confirmation in
the real clone, not discovery. After `Ctrl+R`:

- [ ] Open **Class Diagram Example**, **Execute State based automation** and **2. FAQ?** — each
      opens, and the mermaid diagram / table of contents / image render.
- [ ] Close every tab: the toolbar is still there, formatting greyed out, **Get updates** and
      **Publish** live.
- [ ] Press **Get updates** — only its icon spins; press **Publish** — only its icon spins. Both
      buttons disable either way.
- [ ] Click a page in the **Wiki changes** pane — it opens (was going through the link resolver).
- [ ] On **Execute State based automation**, switch to reading mode (`Ctrl+E`): the image renders,
      and `@<Vineet Khurana>` / `@<Sai Ram>` read as two chips — not `@ @ :`, not a row of boxes.
      Check the same page in live preview: one chip each there too.

### 3. Confirm the round-4 fixes in the user's vault (P0)

Ship-blocking only in the sense that these are freshly written and reported symptoms are cheap to
re-check. In `AXBISDevOpsWiki`, after `Ctrl+R`:

- [ ] Expand and collapse a page with subpages (7.2) from the arrow — the reported "stuck".
- [ ] Click a page-with-subpages row — it opens, and the row highlights.
- [ ] The unpublished marks now show on **one** page, not four (see round-4 note 1 below).
- [ ] `Check vault setup` offers *"Git is converting line endings"*; applying it makes the
      remaining phantom marks go away for good.
- [ ] Right-click any page in the file explorer → **Move up / Move down** changes `.order`.
- [ ] Obsidian's own *New note* inside the wiki gets renamed to the encoded form automatically.

### 4. Keyboard navigation for the three sidebar panes (P1) ✅ *Phase 11*

- [x] Wiki tree, compatibility results and wiki changes are all mouse-and-menu only; rows are not
      focusable. Logged since Phase 2 and never done. One shared row-focus helper covers all three.
      Done in Phase 11 — `util/rowKeyboardNav.ts`. Still to confirm by hand: Tab into each pane,
      arrow through it, Enter to open, and that a background Refresh does not steal the caret.

### 5. Live-API acceptance for the comments pane (P1)

- [ ] The **Page activity** pane's comment half is written against Microsoft's documented routes
      (`_apis/wiki/wikis/{wiki}/pages?path=…` for the id, then `…/pages/{id}/comments`) but has
      **never been run against the live API** — the vault has no PAT. Add one with *Wiki (Read &
      Write)* and check: comments load, posting works, the four failure messages are right. The
      comment routes are a **preview** api-version, separate from the GA one the page lookup uses.
- [ ] History needs no PAT and can be checked immediately.

### 6. Diffs in the changes pane (P2)

- [ ] The pane shows history and which pages a commit touched, not *what* changed in them. A
      per-page diff view is a bigger piece of UI than FR-7.8 asked for — build it only if the
      users ask, and reuse the changes pane's commit list as the entry point.

### 7. Loose ends worth one small session each (P2)

- [ ] **Live-preview table repair** is limited to tables whose rendering actually differs from
      ADO's (Phase 7 decision 3). Quoted and list-nested tables are still shown raw.
- [ ] **The wikilink interceptor's `'save'` mode** fires when a page stops being active, because
      Obsidian has no "file saved" event. Revisit if `preSyncCheck` should convert too.
- [ ] **`workItemHover`** is a native tooltip (title/type/state), not a rich popover — P3 on
      purpose. Only revisit on request.
- [ ] **Native search results** still show encoded file names (no Obsidian API for it). The
      "Open wiki page" switcher is the supported path; reconsider if Obsidian adds a title
      provider.
- [ ] **Heading levels 1–6** have commands but no default hotkeys (Ctrl+Alt+1..6 collides with
      window managers). Left for users to bind.
- [ ] **The status bar polls `git status` every 60 s.** If that ever shows up on a large repo,
      move it behind the window-focus event.

### 8. Housekeeping in the user's clone — theirs to decide, not ours (P2)

Found by audit, deliberately not changed behind their back:

- [ ] `.gitignore` is **empty**, so `.obsidian/` is untracked but not ignored. `Check vault setup`
      offers the fix. (Publish already refuses to stage it; any other git tool would not.)
- [ ] There is a second `Product-Documentation/.obsidian/`, from opening a subfolder as its own
      vault. Harmless, but it will be published one day.
- [ ] `Product-Documentation/B.-EDI-Studio/7.-EDI-Peppol/.order` still lists `7.4 New Test Page`,
      whose file is deleted. The next Publish, or `Repair .order files`, drops the line.

---

## Standing rules for every phase

1. **Never break the on-disk ADO format** (REQUIREMENTS §3). When in doubt, check
   ADO-WIKI-FORMAT.md; when still in doubt, do less.
2. Pure logic goes in `[PURE]` modules with tests *first*; Obsidian adapters stay thin.
3. Update this file: tick the phase box and add a short "what changed / decisions / follow-ups"
   note under [Done](#done). Move anything unfinished into the priority list above.
4. Manual ADO-web verification is part of acceptance whenever rendering or format is touched —
   record what was pushed and observed.
5. New settings must have safe defaults that keep stock Obsidian behaviour available.
6. **Before writing code against Obsidian's own UI, read Obsidian's own UI.**
   `%APPDATA%/obsidian/obsidian-<version>.asar` unpacks with ~15 lines of node and its `app.js`
   is the file explorer, the workspace and the metadata cache. One grep there is worth three
   sessions of reviewing our code (ARCHITECTURE §4.1b).
7. **Before writing code for a bug report, check the build in the vault that produced it**
   (`main.js` size and timestamp) and read the real `git status` / `git diff` of that clone. Two of
   the four report rounds were dominated by facts that were sitting on disk.
8. **Reproduce a UI report in a running Obsidian before theorising about it.** Copy the vault into
   the scratchpad, seed `<userdata>/obsidian.json` with it, launch
   `Obsidian.exe --user-data-dir=<scratch> --remote-debugging-port=9222` **detached** (a child of the
   tool shell gets killed with it, and a second instance on a vault that is already open quits), then
   drive it over CDP `Runtime.evaluate`. Round 5 found the failing 7-of-11 pages, the useless notice
   text and the real `RangeError` in three calls; the static read of the same code had put the blame
   on the page content.
   **Confirm which vault the debugger attached to before driving anything** —
   `app.vault.adapter.getBasePath()`, and check it against the scratch path. Round 8 attached to the
   *real* `test-vault` instead of the copy and created two pages in it (nothing was committed, and
   it was undone). Seeding `obsidian.json` does not guarantee the instance you reach is yours.
9. **Anything that only fails when a real host consumes our output needs a test that builds the
   host.** For CM6 that means constructing an `EditorView`, not asserting over a `DecorationSet`;
   for reading mode it means the markup Obsidian *really* produces, captured from a running app
   rather than imagined (`tests/readingModeEmbeds.test.ts`).
10. **Before believing a measurement taken over CDP, take the same one with the plugin disabled.**
    Obsidian does not render reading mode in an occluded Electron window, so every probe reads as
    an empty page — indistinguishable from a plugin that blanks the view. Round 6 chased that for
    several rounds of edits before checking.

---

## Done

- [x] **Phase 0** — Project scaffold *(2026-08-07)*
- [x] **Phase 1** — Naming core: codec, validation, page index, page commands, `.order` *(2026-08-07)*
- [x] **Phase 2** — Display layer: title decoration, wiki tree sidebar *(2026-08-07)*
- [x] **Phase 3** — Git for functional users *(2026-08-10)*
- [x] **Phase 4** — Links, attachments & ADO rendering *(2026-08-10)*
- [x] **Phase 5** — Toolbar + work-item integration *(2026-08-10)*
- [x] **Phase 6** — Compatibility linter, polish, release *(2026-08-10)*
- [x] **Phase 7** — User round 3: edit-mode tables, attachments, sync buttons, changes pane, colour *(2026-08-10)*
- [x] **Phase 8** — User round 4: explorer navigation, honest change marks, page names, reordering *(2026-08-10)*
- [x] **Phase 9** — User round 5: pages would not open (CM6 block decorations), always-on toolbar, per-direction sync spinner *(2026-08-12)*
- [x] **Phase 10** — User round 6: reading-mode attachments, `@<Alias>` mentions in both modes, per-pass post-processor guards *(2026-08-12)*
- [x] **Phase 11** — User round 7: new folders become pages, subpage creation from the explorer, keyboard navigation *(2026-08-12)*
- [x] **Phase 12** — User round 8: untracked-folder status bug, name-first creation, the tree that never mounted, comments pane *(2026-08-12)*

### Phase 0 — Project scaffold ✅

`manifest.json`, `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `src/main.ts` +
`settings.ts` + `constants.ts`, vitest config, `test-vault/` fixture skeleton, green build.

### Phase 1 — Naming core ✅

**Scope:** FR-1.2–1.4, FR-2.1, FR-2.2 · ADO-WIKI-FORMAT §1–2
**Delivered:** `naming/pageNameCodec` + `titleValidator`, `order/orderFile` + `orderManager`,
`links/linkTargets`, `pages/pageIndex` + `pageCommands` + `pageModals`, `util/mutationQueue`,
`strings.ts`; five commands. 102 tests.

**Decisions that still hold:**
1. **`.order` and `.attachments` are dotfiles, so the Vault API cannot see them** —
   `getMarkdownFiles()`, `getAbstractFileByPath()` and vault events all skip them. All such I/O
   goes through `vault.adapter`.
2. **A folder with no `.order` is already correct** — ADO renders it alphabetically. `repairAll()`
   skips those folders instead of creating files nobody asked for; a real create/rename/delete
   seeds one from the alphabetical sequence (so the visible order never jumps) then appends the
   new page last, matching the portal.
3. `PageEntry.parent` is stored as `parentPath: string | null`, resolved through
   `index.parentOf(entry)`, so entries can never hold stale references across a rebuild.
4. `.order` writes are skipped when the serialized content is unchanged, preserving the file's
   existing EOL style and trailing-newline habit — one-line diffs.
5. Rename reads every page through `vault.cachedRead` rather than pre-filtering with
   `metadataCache`: **Obsidian normalizes link targets in its cache**, which hides the
   percent-encoded paths this format depends on.

### Phase 2 — Display layer ✅

**Scope:** FR-1.1, FR-2.3, FR-2.4 · ARCHITECTURE §4.1
**Delivered:** `naming/displayTitle` + `titleDecorator`, `util/around`, `pages/treeModel` +
`pageSwitcher` + `wikiTreeView`, `PageIndex.onChange`/`pagesByFolder`, `OrderManager.reorder`,
`orderFile.withEntriesArranged`, entry-targeted page commands, tree CSS, two commands, a ribbon
icon. 147 tests.

**Decisions that still hold:**
1. **`.order` writes declare which side of reconciliation they apply to.** A rename must apply
   *before* (or reconciliation drops the old name and re-appends the new one at the end, losing
   its position); a reorder must apply *after*, so it acts on the complete sequence. Drag-reorder
   silently did nothing until this was split (`SyncOptions.beforeReconcile`/`afterReconcile`).
2. **The tree passes OrderManager the full sequence it is displaying**, not an index or a delta.
   Index arithmetic could disagree with the visible tree, and the user must get what they arranged.
3. **Views never watch vault events.** `PageIndex.onChange` fires after every rebuild, incremental
   update and `.order` re-read, so command-driven, out-of-band and reorder changes all refresh the
   UI through one path.
4. **No `monkey-around` dependency** — `util/around.ts` is 15 lines and refuses to restore a method
   someone else wrapped after us.
5. Drag moves siblings only. Changing a page's parent means renaming file + folder and rewriting
   inbound links — that is the Rename command, and hiding it behind an accidental gesture would put
   a large silent commit one slip away.
6. `displayTitle` returns `null` when a name needs no decoding, so the plugin only touches rows it
   actually changes — and has an exact list to restore when switched off.

**Verified against a production wiki** (`Product-Engineering.wiki`, 96 pages): 96/96 names
round-trip; every escape in ADO-WIKI-FORMAT §2 except `%2A` occurs in real names. Two real-world
deviations documented in ADO-WIKI-FORMAT §1.1 — `.order` lines carrying a `.md` extension, and file
names with literal spaces (which display fine but do not round-trip; see note 12).

### Phase 3 — Git for functional users ✅

**Scope:** FR-7.1–7.7 · ARCHITECTURE §4.5, §6
**Delivered:** `git/gitStatus` + `commitMessage` (pure), `gitService`, `syncOrchestrator`,
`syncUi`, `gitStatusBar`, an `Azure DevOps sync` settings section, quit-time sync, two commands.
207 tests.

**Decisions that still hold:**
1. **In a rebase, git's `--ours` is the *server*.** "Keep my version" therefore resolves with
   `--theirs`. The choice is named (`resolveConflict(path, 'mine'|'server')`) and the tests assert
   resulting file *content*, never the flag.
2. **The orchestrator imports nothing from `obsidian`** — all interaction goes through an injected
   `SyncUi`, which is what makes the whole Refresh/Sync/conflict machine testable against real
   repositories (bare origin + two clones in a temp dir, no network).
3. **A leftover rebase is resumed, not refused.** Guard rails reject an in-progress
   merge/cherry-pick/revert, but a rebase means someone closed Obsidian mid-conflict. Background
   flows (`unattended`) never open a dialog: they abort and leave the work committed locally.
4. **Refresh fetches before it pulls**, so the common case costs one network call and never touches
   the working tree, and "N pages updated" is counted from real SHAs.
5. `git add -A -- .` (never bare `-A`); every call carries `GIT_TERMINAL_PROMPT=0`,
   `GIT_EDITOR=true` and `core.quotepath=false`.
6. `tests/gitSafety.test.ts` reads `src/git/*.ts` and fails if a destructive argument or a
   shell-spawning call ever appears — NFR-3 as a test rather than a promise.
7. **Staging excludes `.obsidian/`**, and an *untracked* `.obsidian` is left out of the dirty count.
   Without this, a functional user's first Sync would push an Obsidian workspace into a wiki the
   whole team reads.
8. **Wikis provisioned before the default-branch rename are on `wikiMaster`** (ADO-WIKI-FORMAT §5),
   which the `wikiMain` default would have blocked. The plugin adopts a provisioned branch from the
   clone when the user has not chosen one (`PROVISIONED_WIKI_BRANCHES`).

### Phase 4 — Links, attachments & ADO rendering ✅

**Scope:** FR-3.1–3.5, FR-4.1–4.4, FR-4.6 · SYNTAX-MAPPING §2–3, ARCHITECTURE §4.3–4.4
**Delivered — pure:** `naming/anchors`, `links/adoLinkResolver`, `adoBlocks`, `inlineAdo`,
`attachmentNames`, `linkConverter`. **Adapters:** `adoLinkService`, `readingModeProcessor`,
`livePreviewExtension`, `pasteHandler`, `wikilinkInterceptor`. Plus `Editing`/`Rendering` settings,
two commands, page CSS, a syntax-showcase fixture, and `npm run verify-wiki`. 283 tests.

**Decisions that still hold:**
1. **A wikilink that cannot be resolved is never converted.** Inventing `/Guessed/Path` would
   produce a link that renders and lies; leaving `[[…]]` keeps it visible to the user and the linter.
2. **Reading mode reads the *source*, not the DOM** (`ctx.getSectionInfo`) — the only way to see
   `:::` fences and escapes: the rendered HTML of `\#123` is identical to `#123`.
3. **`::: mermaid` is rendered by handing the body to Obsidian's own ```` ```mermaid ```` pipeline**,
   so both fence styles share one renderer and Mermaid upgrades come for free.
4. **The table repair only ever changes rendering.** Fixing the *file* is a linter offer, not
   something a renderer may do.
5. **Anchors are `github-slugger`, not "punctuation → hyphen"** — the documented ADO example only
   works if punctuation is *dropped* (SYNTAX-MAPPING §4).
6. Attachments are written through `vault.adapter`, named `<stem>-<uuid>.<ext>` exactly as the
   portal does, and the folder is re-read before naming so a collision cannot overwrite a file.
7. **`[[_TOC_]]` is case-sensitive and only the first instance on a page renders** (Microsoft's
   guidance); a later tag becomes a muted chip that says so. ADO's Mermaid subset is `graph`, not
   `flowchart` (ADO-WIKI-FORMAT §4.1).
8. A production wiki contains **57 Obsidian wikilinks** that render as literal text on ADO. They
   exposed a bug: decoding a wikilink target first turns the hyphen in `[[… Display - Basic]]` into
   spaces and matches nothing. Titles are now tried as typed, then as a path segment, then decoded.

### Phase 5 — Toolbar + work-item integration ✅

**Scope:** FR-5.1–5.4, FR-6.1–6.3, FR-9.1–9.2 · ARCHITECTURE §4.6
**Delivered — pure:** `toolbar/formatActions`, `links/adoWebUrl`, `adoClient`'s query/URL/cache
helpers. **Adapters:** `toolbarView`, `adoClient`, `workItemSuggest`, `workItemHover`. Plus
`gitService` identity methods, a "Commit identity" settings section, **the PAT field itself**
(note 11), ~25 commands with Ctrl+B/I/K, and a `file-menu` entry. 337 tests.

**Decisions that still hold:**
1. **`formatActions` splits into pure string transforms and thin `apply*` adapters** over a minimal
   `EditorLike` (satisfied structurally, no import) — which is what let the adapters be unit-tested
   against a ~60-line in-memory fake editor.
2. **List/quote/heading toggles operate on whole lines**, so bulleting a selection that starts
   mid-line still bullets the whole line.
3. **The env var wins over the stored PAT, always** (`resolvePat`) — a shared machine never needs a
   token in plugin data.
4. **`AdoClient.search` tries a direct id lookup first for a numeric query, then a WIQL title
   search**, so `#4` finds work item 4 and a project with low ids still gets title matches.
5. **No PAT/org/project → `onTrigger` returns `null`.** Plain `#` typing is completely untouched,
   not routed through a different code path that could diverge from stock Obsidian.
6. The image toolbar button reuses `AttachmentPasteHandler.storeFiles` rather than duplicating the
   `.attachments` naming/collision logic.
7. **`GitService.run()` takes optional `stdin`**, so `credential reject` is a real git plumbing call
   rather than shelling out to a credential helper.

### Phase 6 — Compatibility linter, polish, release ✅

**Scope:** FR-8.1–8.3, FR-1.5, FR-3.6–3.7, NFR-2 · SYNTAX-MAPPING §1, ARCHITECTURE §7, §9
**Delivered — pure:** `links/documentBlocks`, `lint/types` + `lintEngine`, `lint/rules/*`
(**15 rules**), `setup/vaultSetup`. **Adapters:** a rewritten `livePreviewExtension`,
`compatLinter`, `lintView`, `setupCheck`, one-row-per-page in `titleDecorator`. Plus four commands,
a `Compatibility` settings section with a toggle per rule, a colour pass, a seeded fixture, a
user-facing README, CI + release workflows. 416 tests.

**Decisions that still hold:**
1. **Notes 7–10 were one bug: decoration precedence.** Among overlapping *inline* replace
   decorations CodeMirror keeps the one from the earlier extension and skips the rest
   (`@codemirror/state`, `SpanCursor`/`pointRank`) — so our chip lost to Obsidian's own `[[…]]`
   rendering and our image widget lost to its broken-image widget, silently. Whole-line constructs
   are now **block** replacements (`startSide ≈ -3e8` beats an inline `≈ 5e8`) and the extension is
   registered at `Prec.highest`. Recorded in ARCHITECTURE §4.4.
2. **Live preview renders the real thing, not a chip** — `[[_TOC_]]` shows the generated list,
   `::: mermaid` the diagram, in edit mode, where these users are. Headings come from the **CM6
   document** rather than `metadataCache`, so the contents list updates while a heading is typed.
3. **A block's source reappears when the selection touches it**, or the page would be uneditable.
4. **Every finding carries the text it was computed from** (`excerpt`). Fixes are character offsets,
   so a page edited between scan and fix is skipped with a notice, never patched at moved offsets.
5. **Overlapping fixes are deferred, not blended** — the more severe one applies; the other survives
   to the next run, which is also what applies it.
6. **The pre-sync gate lints only what git reports as changed.** Blocking a two-word fix on someone
   else's 2019 callout would teach every user to switch the setting off.
7. **`singleRowPerPage` defaults to _on_** — showing one page twice was the reported problem, one
   row is what ADO does, and it is one reversible toggle away. The folder row's collapse arrow keeps
   its own job (see Phase 8 note 2 for what happens when it does not).
8. **Six `--adowiki-*` tokens**, each derived from an Obsidian theme variable via `color-mix`, so a
   tinted surface sits a fixed distance from whatever background the theme uses.
9. **`vault.getConfig`/`setConfig` are undocumented**, so the setup check treats an unknown key as
   "nothing to report" and a failed write as "this Obsidian version cannot".

**Performance (NFR-2)**, `tests/performance.test.ts` over a synthetic 5,020-page / 3-level wiki:
index rebuild **35 ms**, `pagesByFolder` **1.4 ms**, fully expanded tree **1.8 ms**, 20,000 lookups
**197 ms**; live-preview parse of a 2,400-line page **~1 ms per keystroke**; every lint rule over a
3,500-line page **87 ms**. The budgets in that test are several times these numbers on purpose:
they catch linear work turning quadratic, not a slow CI runner.

### Phase 7 — User round 3 ✅

**Delivered — pure:** `naming/portableName`, `git/gitLog`, table detection in `documentBlocks`.
**Adapters:** `git/wikiChangesView`, `pages/pageNameGuard`, `GitService.recentCommits`, block table
widgets + missing-attachment cards, `AdoLinkService.attachmentExists`, wider paste capture, two
labelled sync buttons, inline-title decoration and change marks, a `source-mode` setup check, one
setting, one command + ribbon icon. 448 tests.

**Decisions that still hold:**
1. **Three of the eight reports were one thing: the vault was running an old build.** Check
   `main.js`'s size and timestamp in the vault under test before writing code for a report — a
   Phase-N report against a Phase-(N−1) build costs a session. (Now standing rule 7.)
2. **Attachments were never an "online URL" problem.** ADO commits a pasted file into the wiki's own
   `.attachments` folder; of 79 attachment links in the user's wiki, **0** are missing on disk. What
   was added is the *honest failure*: a card saying "not in this copy of the wiki — click Get
   updates" instead of a broken-image icon.
3. **Only tables whose rendering differs from ADO's are taken over.** A table with blank lines on
   both sides renders identically, so leaving it alone keeps its native editing behaviour. Header
   rows must start with `|`, which excludes quoted and list-nested tables.
4. **The inline title is read-only while decorated.** Obsidian's `.inline-title` is editable and
   typing in it renames the file — with a *decoded* title in there, one keystroke would rename a
   page to something containing `:`.
5. **One funnel for "git said something changed"** (`main.onGitStatusRead`), so the status bar, the
   toolbar buttons, the row marks and the changes pane read one result instead of adding three more
   pollers to a repository the user also uses elsewhere.
6. **The name guard collects and reports once** (1.5 s batch). A Refresh can land hundreds of files
   and a production wiki already contains such a name, so per-file notices would be unusable.
7. **`git log` is parsed from `\x1e`/`\x1f`-separated records** — page names legitimately contain
   `|`, `,`, `%`, `(`, `&` and unicode punctuation, so every conventional delimiter is a real
   character in this format.

**Note 12 confirmed:** the offending file is `…/7.4 New Test Page.md` — **literal spaces**, which is
what Obsidian's own *New note* writes and what `Create wiki page` never writes. The round-trip test
lives in `naming/portableName`.

**Verified against the user's wiki** (`AXBISDevOpsWiki`, 164 pages, `npm run verify-wiki`): 61
tables live preview now renders, 67 root-absolute images, 18 `[[_TOC_]]`, 43 `[[_TOSP_]]`, 3 mermaid
blocks, 87 work-item refs, 79 attachment links with **none missing**, 163/164 names round-tripping.

### Phase 8 — User round 4 ✅ *(2026-08-10)*

Six reports, four root causes, all four found on disk rather than by reading code.

**Delivered — pure:** `gitStatus.withoutUnchangedFiles`, a `line-endings` rule in `vaultSetup`.
**Adapters:** the explorer-row contract in `titleDecorator` (collapse selector, `preventDefault`-only
interception, open-by-`TFile`, active-page marking), `GitService.contentChangedPaths` /
`configValue` / `setLocalConfig` / `refreshIndex`, the filter in `GitStatusBar.refreshStatus`,
`PageCommands.movePage` / `setHomePage` / `positionOf` / `renameToPortableName`, auto-fix in
`pageNameGuard`, a hard publish gate for new non-portable names, wiki items on the file explorer's
context menu, two commands, `line-endings` in the setup check. **468 tests** (was 448), including
`tests/explorerRows.test.ts` — the first test in this project that drives **real DOM** (jsdom).

**Decisions worth carrying forward:**

1. **Claiming a host row means `preventDefault()`, never `stopPropagation()`.** Obsidian's delegated
   explorer handler begins `if (!e.defaultPrevented …)`, so `preventDefault` alone takes the row
   while the arrow's listener, drag and selection keep working. `stopPropagation` in the capture
   phase kills all of them at once — which is exactly what "the navigation is stuck, I cannot open
   or close anymore" was. Full contract in ARCHITECTURE §4.1b.
2. **The collapse arrow is `tree-item-icon collapse-icon`.** The code excepted
   `.nav-folder-collapse-indicator`, a class Obsidian 1.13 no longer builds, so *every* arrow click
   on a page-with-subpages was swallowed. `COLLAPSE_SELECTOR` now matches every spelling.
3. **Never open a wiki page with `openLinkText`.** An unresolved link makes it **create** the file —
   on a wiki, a commit — and ADO page names are full of characters the link resolver treats as
   meaningful. The index holds the exact `TFile`; there is nothing to resolve.
4. **Read Obsidian's own source before theorising about it.** Three sessions of reviewing our code
   found nothing; unpacking `%APPDATA%/obsidian/obsidian-1.13.4.asar` and grepping `app.js` for
   `nav-folder-title` settled points 1–3 in minutes. Now standing rule 6.
5. **"Changed" must mean the text changed.** `git status` reports a page as modified whenever its
   cached stat is stale, and on Windows that happens with no character changing: Obsidian saves LF,
   git checks out CRLF under `core.autocrlf=true`. Three pages in the user's wiki were
   byte-identical to their committed blob (`git hash-object` matched) yet permanently listed —
   which is the whole of "the colour shows randomly to a few pages". The status is now intersected
   with `git diff --name-only` once, before any UI sees it; untracked/renamed/conflicted pass
   through, and a failed diff filters nothing. ARCHITECTURE §4.5a.
6. **A brand-new empty page with a bad name is renamed on the spot; anything else is only
   reported.** The title is identical either way, nothing links to a page that does not exist yet,
   and this is what actually stops "adding a new page gives an error in ADO" — the broken name never
   reaches a commit. A page with content, or one older than a minute, may be someone else's; those
   still get the notice and the pre-filled Rename dialog.
7. **A *new* page whose name ADO cannot decode blocks Publish whatever `preSyncLint` says.** Once
   pushed, the portal refuses to open it for the whole team and cannot fix it. Only new pages —
   blocking an edit to an already-broken name would trap someone repairing its content.
8. **Reordering has to be reachable from the file explorer.** Obsidian's explorer *cannot* show the
   wiki's sequence: it sorts alphabetically and lists folders first, so a page with subpages jumps
   above its siblings (7.2 above 7.1 in the report, while `.order` says 7.1, 7.2, 7.3). Move
   up/down/set-as-home are now context-menu items and commands over the same `PageCommands` methods
   the wiki tree uses; the tree remains where the result is *visible*.
9. **The merged folder row now marks the open page itself.** Obsidian only ever highlights file
   rows, so with `singleRowPerPage` on there was no indication of what was open.

**Evidence, for the record.** In `AXBISDevOpsWiki`: `git status` listed four changes,
`git diff --name-only` listed one; the three extra were `[[_TOSP_]]` pages whose index entry cached
size 12 against 11 bytes on disk (CRLF vs LF) with `core.autocrlf=true` from
`C:/Program Files/Git/etc/gitconfig` and no `.gitattributes`. `7.4 New Test Page.md` is in `HEAD` —
it was published, which is why the portal shows the error — and is now deleted locally while still
listed in its `.order`. The installed `main.js` was the current Phase 7 build, so unlike round 3
none of this was a stale build.

### Phase 11 — User round 7: pages, subpages and the keyboard ✅ *(2026-08-12)*

One report — *"if I create a new folder and add a new page under it, it doesn't work and gives an
error"* — plus the long-standing keyboard item (§4) and a scoping pass on feature request 1.

**Delivered — pure:** `pages/folderPlan` (what to do with a folder ADO cannot represent),
`NonPortableSegment.path` in `naming/portableName`. **Adapters:** `pages/folderGuard`,
`util/rowKeyboardNav` wired into all three panes, a parent picker in `TitlePromptModal`,
`PageCommands.parentChoices`, **New subpage** on the file explorer's context menu, corrected
folder-vs-page wording in `pageNameGuard`, a shared focus ring. **529 tests** (was 496), including
`tests/rowKeyboardNav.test.ts` (jsdom) and `tests/folderGuard.test.ts` (fake timers through the real
debounce). Plus [docs/MULTI-WIKI-SCOPING.md](docs/MULTI-WIKI-SCOPING.md).

**Decisions worth carrying forward:**

1. **An Azure DevOps wiki has no folders, so neither do we.** `A/B/` exists only as the container
   for the subpages of `A/B.md`, and `.order` lists page names. A bare folder is therefore invisible
   to the wiki — nothing lists it, no page owns it, and every page inside is orphaned. The fix is
   not a better error message: a folder created in the explorer becomes a page
   (`This is a new page/` → `This-is-a-new-page.md` + `This-is-a-new-page/`).
2. **The reported error named the wrong file.** `nonPortableSegments` scans the whole path, but the
   notice printed the *page's* name against the *folder's* suggestion — "cannot open
   `Untitled.md` … it should be `This-is-a-new-page`" — over a button that opened the page's
   rename dialog, which cannot rename a folder. A folder now gets its own message and offers the
   page that owns it (`${segment.path}.md`), which is why `NonPortableSegment` grew a `path`.
3. **Auto-fix no longer requires the page to be the *only* problem.** `problems.length === 1` meant
   a fresh empty note inside a badly named folder got neither the silent fix nor a usable offer.
   The page's own name is fixed whenever it is fresh; the folder is a different owner's repair.
4. **The folder guard waits 2 s, and re-decides against the live vault.** Obsidian's *New folder*
   creates `Untitled` and opens the row for renaming, so the name the user means arrives as a
   `rename` event — acting on `create` would adopt "Untitled". The delay also lets a folder that has
   since been deleted, renamed or paired with a page drop out.
5. **It stands down during a git flow, by signal and not by poll.** A checkout lands a folder and its
   paired page as two events; inventing a page in that gap would commit a file the server is about
   to deliver. Re-arming the timer from inside the flush polled forever — a conflict dialog keeps
   the state non-idle until somebody answers it — so `main` calls `resume()` when the flow ends.
6. **Users reached for *New folder* because there was no other way to choose a parent.**
   `promptNewPage` could only use the active file's folder, so putting a page somewhere else meant
   opening a page there first. It now has an **Under** dropdown, and **New subpage** is on the file
   explorer's own context menu. Rename deliberately has *no* parent picker: moving a page carries
   its subpage folder and rewrites every inbound link, and hiding that behind a dropdown row would
   put a large silent commit one misclick away (Phase 2 note 5).
7. **A pane's focus must be captured before it is emptied, not after.** `RowKeyboardNav` first read
   "did this pane have the caret" in `endRender()` — by which point the focused row had already been
   detached and `activeElement` was `<body>`, so every render looked like a background one and focus
   was never restored. It is read in `beginRender()`. Rows are keyed by string (vault path, commit
   sha) rather than by element for the same reason: nothing survives the redraw.
8. **Roving tabindex, not a tabbable row per page.** Exactly one row is `tabindex=0`, so Tab enters
   the list where the user left it and leaves in one press instead of walking 164 pages.

**Measured, not assumed** (for [MULTI-WIKI-SCOPING.md](docs/MULTI-WIKI-SCOPING.md) §1): git
**follows** a Windows directory junction, and `git add -A -- .` records a junction to another repo
as a **gitlink** (`160000 commit <sha>`) — so junctioning a second wiki inside a vault that is
itself a wiki clone would publish a submodule entry to the whole team on the next Publish.
`.gitignore` on the mount point prevents it entirely. This is why the container-vault layout is the
only one worth offering.

### Phase 12 — User round 8 ✅ *(2026-08-12)*

Five reports. One of them turned out to be the same defect that had published a broken page to the
portal, and one was a pane that had never mounted at all.

**Delivered — pure:** `formatActions.padBlock`, `comments/wikiComments` (URL building + response
parsing). **Adapters:** `-uall` on `git status`, `GitService.fileHistory`,
`pages/creationInterceptor`, `comments/wikiCommentsClient`, `comments/pageActivityView`,
`ensureMounted()` in `wikiTreeView` and `lintView`, a trailing space from the work-item picker, one
setting, one command + ribbon icon; the Refresh/Publish ribbon icons **removed**. **556 tests** (was
529).

**Decisions worth carrying forward:**

1. **`git status` collapses an untracked directory into one `dir/` entry.** This is the round's
   biggest finding and it explains two reports at once. A brand-new folder full of new pages was
   reported as `? This is a new page/` — one entry, matching no page's vault path. So the explorer
   marked none of those pages as unpublished (*"the coloured pages… not anymore"*), the changes pane
   listed a folder instead of pages, and — the damaging part — `preSyncLint` filters status entries
   by `.md` **before** checking their names, so the gate never saw them and **a folder and page with
   literal spaces were published to the portal**, where they cannot be opened or repaired. `-uall`
   fixes all three. Verified against a real repository both ways before and after.
2. **Ask for the name before anything is written.** The guards from Phase 11 repaired names
   *afterwards*, which leaves a window in which an unpublishable name exists on disk — and note 1
   is what happens when a Publish lands inside that window. `creationInterceptor` wraps
   `FileManager.createNewMarkdownFile` / `createNewFolder`, which the asar shows is where all six
   routes to a new note or folder converge. The guards stay as the net for a pull, another plugin,
   or the file system.
3. **Those two methods may never return null.** Three of four callers run the result through
   `afterCreate`, which null-checks; the global `file-explorer:new-folder` command does
   `ensureSideLeaf(…, {state: {newFile: t.path}})` with **no** check. Cancelling therefore falls
   back to Obsidian's own behaviour rather than returning null.
4. **An empty string is not a name.** `file-explorer:new-file` — Ctrl+N, the commonest route of all
   — goes through `createAndOpenMarkdownFile("", "tab")`, which forwards `""`. Gating on
   `typeof name === "string"` skipped the prompt on exactly that path, and the unit test passed
   because it only ever exercised `undefined`. **Caught by driving a real Obsidian, not by the
   suite** — standing rule 9 earning its place again.
5. **A view that only draws itself from `onOpen` is a view that shows nothing.** The Wiki pages pane
   was empty because Obsidian had constructed the real `WikiTreeView` with `isDeferred === false`
   and **never called `onOpen()`** — so `treeEl` stayed null and `render()` returned at its first
   line. Calling `onOpen()` by hand on the same object drew all seven rows, which is how it was
   diagnosed. Mounting is now idempotent (`ensureMounted()`) and every entry point asks for it,
   including `onResize`, which fires when a collapsed sidebar opens. `lintView` had the same shape
   and a worse failure mode — `headerEl` undefined meant `repaint()` *threw*.
6. **Refresh and Publish have no ribbon icon.** They are on the toolbar above every page with
   counts and tooltips, in the changes pane, and in the status bar's menu. A fourth copy, furthest
   from the page being edited, was three too many.
7. **Comments are the one feature that genuinely needs a PAT.** Microsoft store wiki comments in
   their own database, per branch — there is nothing in the repository to read. So the pane
   distinguishes *no token*, *token refused*, *page not published yet* and *network failed*, because
   all four look like "no comments" and mean different things. History, by contrast, is `git log`
   for one file: free, offline, and it renders before the REST call returns.
8. **The toolbar was manufacturing lint findings.** Table/TOC/mermaid/math/rule were written at the
   cursor, so pressing **Table** at the end of a paragraph produced the glued table that
   `table-needs-blank-line` reports. `padBlock` adds only the newlines that are missing. The mermaid
   button also wrote `::: mermaid`, contradicting both SYNTAX-MAPPING §3 and CLAUDE.md; it writes a
   fence now, so a diagram survives the plugin being switched off.

**Verified in a running Obsidian** (CDP, 1.12.7): the tree draws 7 rows through the plugin's own
command; **New note** opens the prompt and writes `FAQ-for-customers%3A-v2%3F.md` with no stray
`Untitled.md`; **New folder** opens *"New wiki page (with subpages)"* and produces
`Release-notes.md` **+** `Release-notes/`. `npm run verify-wiki test-vault` reports
**namesNotRoundTripping 0** (was 2) after the repair below.

**Harness mistake, recorded so it is not repeated:** the CDP session attached to the **real
`test-vault`** rather than the copy seeded in the scratchpad, so two test pages were created in it
and appended to its root `.order`. Nothing was committed or pushed; the files were deleted and
`.order` restored. Standing rule 8 says to copy the vault — it does not say to *verify which vault
the debugger actually attached to*, and it should: check `app.vault.adapter.getBasePath()` before
driving anything.

**The published broken page** (`This is a new page/This is a sample page 2.md`, literal spaces in
both) is repaired and **committed locally in `test-vault`** as `1406deb`: folder and page renamed
with `git mv`, the owning `This-is-a-new-page.md` added, both `.order` files updated. It is **not
pushed** — the remote needs interactive credentials this session cannot supply. Pressing **Publish**
in Obsidian ships it, and doubles as the §1 acceptance test.

---

## Closed user reports

All 26 notes from four rounds of testing, with where each was fixed. Original wording kept so the
intent is not lost in translation.

### Round 1 (2026-08-10)

| # | Note | State |
|---|---|---|
| 1 | "In ADO the Page can have its own text… so it acts as a folder and a file. Obsidian should accept this behavior." | ✅ Phase 6 — `singleRowPerPage` (on) hides the `.md` row and makes the folder row open the page |
| 2 | "TOC and TOSP should be generated automatically when the page is opened." | ✅ Phase 4 — regenerated on every render; Phase 6 added edit mode, live as you type |
| 3 | "Coloring of things would help make it easier to read — pick from a good obsidian theme." | ✅ Phase 6 — six `--adowiki-*` tokens derived from theme variables |
| 4 | "Mermaid diagrams are not rendering properly in Obsidian, but they are rendering in ADO." | ✅ Phase 4 (reading) + Phase 6 (live preview) |
| 5 | "Someplace tables are not showing properly in Obsidian, but they are showing in ADO." | ✅ Phase 4 display repair + Phase 6 `table-needs-blank-line` source fix |
| 6 | "The sync… is using my previous login. Somewhere to show which login is used… a way to login and logout." | ✅ Phase 5 — "Commit identity" section + "Forget the saved sign-in" |

### Round 2 (2026-08-10) — notes 7–10 were **one** bug: CM6 decoration precedence

| # | Note | State |
|---|---|---|
| 7 | "The TOC and TOSP still do not show the contents. They show colors but they do not render." | ✅ Phase 6 — block widgets at `Prec.highest`; our chip had been losing to Obsidian's own `[[…]]` rendering |
| 8 | "The Mermaid diagram is not rendering at all." | ✅ Phase 6 — `:::` blocks were never handled in live preview at all |
| 9 | "The images do not render." | ✅ Phase 6 — Obsidian's *broken*-image inline widget outranked ours |
| 10 | "The `#<devops id>` does not link to the work item." | ✅ Phase 6 — chips in both modes, mod-click opens ADO; linking needs org URL + project, and says so on hover when they are missing |
| 11 | "'Link work items and pull requests' did not show in the setup." | ✅ Phase 5 — `pat` was a settings field with no input rendered; there was no way to enter a token |

### Round 3 (2026-08-10) — the vault was running the Phase 5 build

| # | Note | State |
|---|---|---|
| 12 | "Adding a new page in Obsidian gives an error in ADO." | ✅ Confirmed Phase 7 (`7.4 New Test Page.md`, literal spaces); **prevented** Phase 8 |
| 13 | "The attachments are not showing… check how the URL of the attachment works." | ✅ Not a URL problem — old build; a genuinely missing file now shows a card saying so |
| 14 | "Add 2 buttons for syncing directly in the toolbar." | ✅ Phase 7 — **Get updates** / **Publish**, with counts and plain-language tooltips |
| 15 | "In the side bar if we can see the last few changes from wiki, and ability to open those." | ✅ Phase 7 — **Wiki changes** pane (closes FR-7.8) |
| 16 | "Colors for different things across, so it looks more lively." | ✅ Phase 7 |
| 17 | "The markdown is not rendering when in edit mode." | ✅ Old build; the setup check now also reports **Source mode** and offers Live Preview |
| 18 | "The TOC/TOSP not rendering in edit mode." | ✅ Old build — the Phase 6 precedence fix |
| 19 | "The table is not rendered when there is no space between the line and the table." | ✅ Phase 7 — block widget in live preview; **61** such tables in the user's wiki |
| 20 | "A way to show unsynced pages which are changed (like how it shows in VS Code)." | ✅ Phase 7 — "Not published yet" list + per-row marks (see round 4 note 21 for the accuracy fix) |

### Round 4 (2026-08-10)

| # | Note | State |
|---|---|---|
| 21 | "The color shows randomly to few pages, not sure what was different from before." | ✅ Phase 8 — the marks were truthful to `git status`, which reports CRLF-vs-LF pages as modified for ever. Marks now come from `git diff`; the setup check offers `core.autocrlf=input` so it stops recurring |
| 22 | "The page navigation is stuck… it is what it is, cannot open or close anymore." | ✅ Phase 8 — the collapse-arrow exception matched a class Obsidian no longer builds, and `stopPropagation()` killed the arrow's own handler |
| 23 | "When I add a new page here, it gives an error on ADO." | ✅ Phase 8 — a new empty page with a non-portable name is renamed automatically, and a new one that slips through blocks Publish |
| 24 | "I cannot open the pages anymore." | ✅ Phase 8 — same cause as 22; pages also now open by `TFile` instead of through the link resolver |
| 25 | "I can see the main page on the page itself, but the subpage doesn't open (7.2)." | ✅ Phase 8 — 7.2 is a page *with* subpages, so its only row was the folder row that note 22 had disabled |
| 26 | "The order is not changing, if I want to move pages up or down, I cannot do it… we find an alternate way which updates the .order as well." | ✅ Phase 8 — Move up / Move down / Set as wiki home page on the file explorer's own right-click menu, plus two commands. The explorer cannot *display* wiki order (folders sort first); the **Wiki pages** pane shows it, and "Show in the wiki page order" jumps there |

### Round 5 (2026-08-12) — reproduced under CDP, not inferred

Obsidian was driven headlessly for this round: `Obsidian.exe --user-data-dir=<scratch>
--remote-debugging-port=9222` against a copy of `test-vault`, then Chrome DevTools Protocol
`Runtime.evaluate` to open every page and read the notices and console. Worth repeating — it turned
"three odd pages" into a measured 7-of-11 and caught that the notice text is a red herring.

| # | Note | State |
|---|---|---|
| 27 | "Opening pages in the test-vault gives error cannot open the page (class diagram example, execute state based automation)." | ✅ Round 5 — **not those pages: 7 of the 11.** `Decoration.replace({block: true})` was served from the `ViewPlugin`, which CodeMirror refuses; the throw lands inside `onLoadFile`, so any page with a `:::` block, a `[[_TOC_]]`/`[[_TOSP_]]`, a whole-line image or a repaired table would not open. Block decorations moved to a `StateField` (ARCHITECTURE §4.4b). All 11 pages verified opening clean |
| 28 | "I added an image on the FAQ on devops, now the page cannot open." | ✅ Round 5 — same cause. A whole-line `![…](/.attachments/…)` is one of the block constructs; adding it to a page that opened fine is what tipped it over |
| 29 | "Can the bar show always, irrespective if the page is open or not." | ✅ Round 5 — the toolbar now mounts on Obsidian's `empty` view too, pinned to the top of the tab. Formatting controls are disabled there (no editor to act on) so the row keeps its shape; Get updates / Publish stay live |
| 30 | "When I click on get updates or publish, icons on both rotate. Only rotate the action which is happening." | ✅ Round 5 — the toolbar read one global `busy` flag. `SyncOrchestrator.flow` now reports *which action the user pressed* — distinct from `state`, because a publish fetches and rebases on the way, and a conflict dialog replaces the state entirely. Both buttons still disable; only the pressed one spins |
| — | "The wiki pages are opening correctly on Azure DevOps." | ℹ️ Confirmed the format side is fine — the failure was entirely local. §1 acceptance ran against the disposable scratch wiki `test-vault/` is cloned from |

### Round 6 (2026-08-12)

| # | Note | State |
|---|---|---|
| 31 | "The image shows when in edit mode but doesn't on the read mode." | ✅ Round 6 — Obsidian only emits an `<img>` when the target looks like a URL; `![x](/.attachments/…)` becomes an *internal embed* whose path the link resolver cannot see, so reading mode matched nothing and showed *"…could not be found"*. It now rewrites `.internal-embed[src]` as well — carrying **only** `adowiki-*` classes, because Obsidian re-processes anything wearing `internal-embed` and empties it again (ARCHITECTURE §4.3) |
| 32 | Not reported — visible in the same screenshots: `@<Vineet Khurana>` drew as `@ ‹ Vineet Khurana ›` in a row of boxes in edit mode, and as bare `@ @ :` in reading mode | ✅ Round 6 — one cause: `@<Alias>` is an HTML tag to every markdown parser. Reading mode loses the name before a post-processor runs (the paragraph is re-rendered with the delimiters escaped); the CM6 highlighter tokenises it and CodeMirror splits a mark at every token (a mention is now a replace widget). ADO's `@<…guid>` form was never affected — a tag name must start with a letter |

Found while fixing, not reported:

- A markdown post-processor that throws makes Obsidian render that section as **nothing** — a blank
  page, no error the user can act on. Each pass now runs in its own `try/catch`.
- **Harness trap that cost real time:** Obsidian does not render reading mode in an occluded or
  background Electron window. Every measurement came back empty, which reads exactly like a plugin
  bug — until the same probe with the plugin *disabled* came back empty too. Check against the
  plugin off, and restart the window, before believing a blank preview.
- `Class-Diagram-Example.md` came over from the portal with its whole `classDiagram` on one line,
  which Mermaid rejects (`Expecting 'NEWLINE', got 'ALPHA'`). A content problem in that page, not a
  rendering one — worth tidying in the portal.

### Round 5 — found while fixing, not reported:

- `wikiChangesView.openPage` still used `openLinkText` with a raw ADO path and an empty source path
  — the exact thing round-4 note 24 banned. Now opens the indexed `TFile`.
- `npm run dev` copied `styles.css` once at start-up, so any CSS edit during a watch was invisible
  and looked like a broken feature. The watch now copies it on change.
- Obsidian 1.13 gates Mermaid behind a per-vault *"Display Mermaid diagrams in this vault?"* consent
  card. A blank diagram in a fresh vault is that prompt, not a rendering bug.

### Round 7 (2026-08-12)

| # | Note | State |
|---|---|---|
| 33 | "If I create a new folder and add a new page under it, it doesn't work and gives an error." | ✅ Phase 11 — an ADO wiki has no folders, so a bare one is unpublishable by construction. A folder created in the explorer now becomes a page; the mis-worded notice that named the *page* against the *folder's* suggestion is fixed; and **New subpage** + an **Under** picker mean nobody needs a folder in the first place |

### Round 8 (2026-08-12)

| # | Note | State |
|---|---|---|
| 34 | "The coloured pages which need to be published (added, removed, edited) were showing with a different colour before, but not anymore." | ✅ Phase 12 — `git status` collapses an untracked **directory** into one `dir/` entry, which matches no page's path, so every page inside a new folder was invisible to the marks. `-uall`. The same defect let a bad name past the publish gate (note 1) |
| 35 | "Creating a new note and a folder — can the plugin open a pop-up for the user to enter the name, so we add it with the right name the first time?" | ✅ Phase 12 — `creationInterceptor` asks first, for both, from all six entry points. `Untitled` never touches disk, so no Publish can catch it mid-repair |
| 36 | "The tree view is not working, we can remove it. Refresh and sync are not needed as they are already available." | ✅ Phase 12 — **kept, because it was fixable and it is the only place wiki order is visible**: Obsidian had constructed the view and never called `onOpen()`, so the pane was blank. Mounting is idempotent now. The Refresh/Publish **ribbon icons are removed** — the toolbar, changes pane and status-bar menu already carry both |
| 37 | "Comments is still missing — if we can add it on the side where we can add comments, see comments." | ✅ Phase 12 — **Page activity** pane: comments (ADO REST, needs a PAT with Wiki Read & Write) plus this page's git history. Untested against the live API — the vault has no PAT yet |
| 38 | "Confirm from the syntax mapping that everything is working, and do anything pending." | ✅ Phase 12 — audited every row. Fixed: whole-line inserts now get the blank lines they need, the mermaid button writes a fence instead of `:::`, the work-item picker adds a trailing space. Documented as deliberate or unbuilt: mention picker (P3), note-embed conversion, dataview/MathJax rules (SYNTAX-MAPPING §3) |

### Round 9 (2026-08-17)

| # | Note | State |
|---|---|---|
| 39 | "How will the users find what branch their wiki is on?" | ✅ **They don't have to — the plugin works it out.** Azure DevOps never shows the branch of a provisioned wiki (the portal's *Clone wiki* dialog gives a URL and no branch), so requiring the setting was asking for something the product hides. `git/wikiBranch.branchToAdopt` now adopts whatever branch the clone is on **provided it tracks an upstream**; previously only `wikiMain`/`wikiMaster` were adopted, so every "publish code as wiki" repository failed its first Sync with an error telling the user to type in a name they could not look up. Verified against real git: an ADO wiki clone reports `branch.upstream origin/wikiMaster`, a clone on an arbitrary branch reports `origin/docs`, and a local scratch branch reports **no** upstream line — so a clone parked on somebody's experiment is still left alone and still gets the wrong-branch guard rail (FR-7.7) |

---

## Feature requests

### 1. More than one wiki in one vault (mklink / junctions)

Scoped in **[docs/MULTI-WIKI-SCOPING.md](docs/MULTI-WIKI-SCOPING.md)** *(Phase 11)*, not built.

- [ ] Decide the layout first: a **container vault with no repository at its root**, holding one
      junction per wiki. Measured (scoping doc §1): git *follows* a junction and commits a junction
      to another repo as a **gitlink**, so a second wiki junctioned inside a vault that is itself a
      wiki clone publishes a submodule entry to the whole team on the next Publish.
- [ ] Seven coupling clusters, ~a phase, of which the junction button itself is one day. **The
      button must not ship first** — a two-wiki vault under a single-wiki plugin publishes to the
      wrong repository. Order is in §4 of the scoping doc.

### 2. Page history and comments in the side panel

- [ ] **History is nearly free** — `git/gitLog` and `GitService.recentCommits` already exist for the
      Wiki changes pane; scoping them to the active file's path is a small addition and needs no PAT.
- [ ] **Comments need the REST API** (`_apis/wiki/wikis/{wiki}/pages/{pageId}/comments`). `adoClient`
      and PAT resolution are in place from Phase 5; the new work is resolving a file path to an ADO
      `pageId`, which needs the same `pagePath` URL form that acceptance item §1 still marks
      **unverified** — so this is gated on the live-wiki pass.
