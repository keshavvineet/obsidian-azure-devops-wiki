# CLAUDE.md — Azure DevOps Wiki plugin for Obsidian

Obsidian desktop plugin that makes a git-cloned Azure DevOps wiki repo editable as a
first-class Obsidian vault: decoded page titles, `.order`-aware page tree, ADO-style
toolbar, work-item links, and one-click git Refresh/Sync for non-technical users.

## The one rule that overrides everything

**Files on disk stay 100% ADO-native, always.** Encoded file names
(`Pre%2DRelease-….md`), root-absolute links (`/.attachments/…`, `/Parent/Child`),
`.order` files, `::: mermaid` blocks — we adapt Obsidian's UX *around* this format and
convert Obsidian-isms at insertion time. We never batch-rewrite files into another format,
and any change must leave `git diff` containing only what the user actually edited.

## Documents (read before coding)

| Doc | Contents |
|---|---|
| [PLAN.md](PLAN.md) | Phased build plan + status + standing rules. **Work one phase per session; update its checkbox + notes when done.** |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Numbered FRs/NFRs (FR-x.y referenced everywhere) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Module map, core index, key flows, risks |
| [docs/ADO-WIKI-FORMAT.md](docs/ADO-WIKI-FORMAT.md) | **Ground truth** for names/`.order`/links/limits — verified against a production wiki |
| [docs/SYNTAX-MAPPING.md](docs/SYNTAX-MAPPING.md) | Obsidian⇄ADO syntax table, linter rules, insertion-time conversions |
| [docs/TEST-PLAN.md](docs/TEST-PLAN.md) | What a human must check in `test-vault/` (UI, git, ADO rendering) — keep it in step with the features |

## Commands

```bash
npm run dev      # esbuild watch → builds into test-vault/.obsidian/plugins/azure-devops-wiki/
npm run build    # type-check (tsc --noEmit) + production build
npm test         # vitest (pure modules only)
```

Manual testing: open `test-vault/` as an Obsidian vault. Since 2026-08-11 it is **a real clone** of
a disposable scratch wiki (branch `wikiMaster`; the concrete remote is whatever
`git -C test-vault remote -v` reports — `test-vault/` is git-ignored, so it never leaves this
machine), so git flows — Refresh, Sync, conflicts — can be exercised end to end against a wiki
nobody reads. Only `.obsidian/` is untracked there, and `stageAll()` excludes it from every commit.
Treat everything else in the vault as a real repository: pages you add are published on Sync.
Test *fixtures* therefore live outside the vault (`tests/fixtures/`) — copy one in when a
by-eye check is wanted, and delete it afterwards.

## Architecture in one paragraph

`src/pages/pageIndex.ts` is the single cached index (file ⇄ decoded title ⇄ wiki path ⇄
order); every feature reads it, nothing else walks the vault. Pure logic (name codec,
`.order` codec, link converter, anchors, lint rules) lives in modules that never import
`obsidian` and is unit-tested; Obsidian adapters (decorator, CM6 extensions, post-
processor, git UI) stay thin. Git = system binary via `execFile` arrays (never shell
strings, never destructive commands). Details: ARCHITECTURE.md.

## Conventions

- TypeScript strict; no `any` without a comment justifying it.
- User-facing strings via `src/strings.ts`; errors surface as actionable `Notice`s.
- File mutations go through the shared mutation queue (no racing `.order` writes) and the
  Obsidian Vault API (never `fs` directly, except `gitService`/tests).
- Skip decorating/parsing inside code blocks & frontmatter (use CM6 syntax tree /
  metadataCache sections).
- Test-first for anything in `naming/`, `order/`, `links/linkConverter`, `lint/rules/`.
- The codec table in ADO-WIKI-FORMAT §2 is law; if reality disagrees with it, update the
  doc (with evidence) before changing code.

## Gotchas already discovered (don't re-learn these)

- **`.order` and `.attachments` start with a dot, so Obsidian's Vault API cannot see them.**
  `getMarkdownFiles()`, `getAbstractFileByPath()` and `vault.on('create'|…)` all skip
  dot-paths. Read and write them through `app.vault.adapter` instead.
- A folder with **no `.order` file is not broken** — Azure DevOps sorts it alphabetically.
  Never create one during a repair sweep; only when a real change happens (see PLAN Phase 1
  outcome for the seeding rule).
- `-` means space; literal hyphen is `%2D`. Only `- : * ? | " < >` are encoded — `& ( ) .`
  and unicode (curly quotes!) are stored literally in file names.
- Obsidian **normalizes link targets in `metadataCache`**, which loses the percent-encoding
  these paths rely on. Don't use it to find links to rewrite; read the files.
- Windows reserved names (`CON`, `COM1`, …) are legal ADO page titles but unusable on disk,
  so the title validator rejects them.
- Tests alias `obsidian` to `tests/stubs/obsidian.ts` (vitest.config.ts) so `instanceof`
  works, but `tsc` still checks tests against the **real** typings — cast stub-only surface
  (e.g. the recorder in `tests/pluginLoad.test.ts`) rather than weakening the config.
- Numeric `#123` is *not* a valid Obsidian tag (digits-only), so work-item decoration
  doesn't fight the tag system.
- Attachment stems can contain `==` (`==image_0==-<guid>.png` exists in production) —
  beware Obsidian's highlight parser around image link text.
- ADO renders both `::: mermaid :::` and ```` ```mermaid ```` — insert fences (portable),
  but must render `:::` for existing pages.
- ADO anchor algorithm keeps consecutive hyphens: `Team #1 : Release Wiki!` →
  `#team-1--release-wiki`.
- **Read Obsidian's own source before theorising about its UI.**
  `%APPDATA%/obsidian/obsidian-<version>.asar` is a plain asar (u32 header size at offset 12, JSON
  directory, payload after); its `app.js` holds the file explorer, workspace and metadata cache.
  Two bugs survived three review sessions because nobody grepped it (ARCHITECTURE §4.1b).
- **Claiming a click on a host row: `preventDefault()` only, never `stopPropagation()`.** Obsidian's
  delegated explorer handler starts `if (!e.defaultPrevented …)`, so `preventDefault` takes the row
  while the collapse arrow, drag and selection keep working. The arrow is
  `tree-item-icon collapse-icon`, *not* `nav-folder-collapse-indicator`.
- **Never open a wiki page with `openLinkText`** — an unresolved link makes it *create* the file, and
  ADO page names are full of characters the link resolver treats as meaningful. Open the `TFile`.
- **`Failed to open ""` (empty quotes) is Obsidian saying "a plugin threw inside
  `MarkdownView.onLoadFile`".** It names nothing because Obsidian interpolates `msgFailedToLoadFile`
  under the wrong key (`{plugin: …}` into a `{{filepath}}` template) — the real error is in
  `console.error` right beside it, so read the console, never the notice. It is not about the file.
- **CM6 block decorations (`block: true`) may only come from a `StateField`, never a `ViewPlugin`.**
  A function-valued `EditorView.decorations` provider — which is what `ViewPlugin.fromClass(…,
  {decorations})` installs — is "dynamic", and `ContentBuilder` throws
  `RangeError: Block decorations may not be specified via plugins` *while the editor builds its
  content*, i.e. inside `onLoadFile`. So the page does not lose its rendering, it refuses to open.
  A `try/catch` around building the set cannot catch it (the set is rejected on consumption, not on
  construction). ARCHITECTURE §4.4b; guarded by `tests/livePreviewMount.test.ts`.
- **A decoration test that never mounts an `EditorView` proves nothing.** 7 of 11 pages in
  `test-vault` were unopenable with the whole unit suite green.
- **`![x](/.attachments/f.png)` does not become an `<img>`.** Obsidian only emits one when the target
  looks like a URL; anything else becomes `<span class="internal-embed … mod-empty-attachment"
  src="…">“…” could not be found.</span>`. Reading mode has to rewrite *that*, not `img`.
- **Never put Obsidian's `internal-embed` class on an element of ours.** Its embed handler keeps
  processing anything wearing it, finds no `src` it can resolve, and empties the element again — the
  picture appears and silently vanishes. Use only `adowiki-*` classes and style them ourselves.
- **`@<Alias>` is an HTML tag to every markdown parser** (`<Vineet Khurana>` → element `vineet`,
  attribute `khurana`). Reading mode loses the name before a post-processor can see it (re-render the
  paragraph with the delimiters escaped); live preview keeps the text but the *highlighter* tokenises
  it, and CM6 splits a `Decoration.mark` at every token — so a mention must be a replace **widget**,
  never a mark. Only the alias form is affected: a tag name must start with a letter, so ADO's usual
  `@<…guid>` is untouched.
- **A markdown post-processor that throws makes Obsidian render the section as nothing** — a blank
  page with no error the user can act on. Guard each pass separately (`readingModeProcessor.attempt`).
- **Obsidian does not render reading mode in an occluded or background Electron window.** Every
  measurement comes back empty, which looks exactly like a plugin bug — verify against the plugin
  *disabled* before believing it, and restart the window to get a real reading.
- **`git status` is not "what did I change".** Obsidian saves LF, Git for Windows checks out CRLF
  (`core.autocrlf=true` by default), and every edited page is then reported modified for ever with
  `git diff` showing nothing. Intersect with `git diff --name-only` before showing anything to a
  user (ARCHITECTURE §4.5a).
- The reference production wiki lives under OneDrive — real users will do this; warn them
  (file locking corrupts git) via the Vault setup check.
- **`git status` collapses an untracked *directory* into one `dir/` entry** unless `-uall` is passed.
  A brand-new folder of new pages therefore reported as `? New folder/`, which matches no page path:
  no change marks, and the publish gate (which filters by `.md` first) never saw the names, so a
  page ADO cannot open reached the portal. `gitService.status()` passes `-uall`.
- **A sidebar view can be constructed without `onOpen()` ever being called** (`isDeferred` already
  false). Build the pane in an idempotent `ensureMounted()` that every entry point calls, including
  `onResize` — otherwise the pane is silently blank, or throws if it uses `!` fields.
- **Obsidian's own New note passes `""` as the file name**, not `undefined`
  (`createAndOpenMarkdownFile("", "tab")`). Any "did the caller supply a name?" check must treat an
  empty string as *no name*, which is how Obsidian itself treats it.
- **`FileManager.createNewMarkdownFile` / `createNewFolder` may never return null** once wrapped:
  the global `file-explorer:new-folder` command reads `.path` off the result with no null check.
- **An ADO wiki has no folders.** `A/B/` exists only as the container for the subpages of `A/B.md`,
  and `.order` lists page names, never folder names. A folder created on its own is invisible to the
  wiki and orphans everything inside it, so `folderGuard` turns one into a page rather than
  explaining a distinction the format does not have.
- **Git follows a Windows directory junction, and commits one that points at another repo as a
  gitlink** (`160000 commit <sha>`) — measured, not assumed (MULTI-WIKI-SCOPING §1). Never junction
  a wiki into a vault that is itself a wiki clone.
- **A settings text field's `onChange` fires on every keystroke.** Never `saveSettings()` or spawn
  a process there: `data.json` sits inside `.obsidian/` in a vault that is usually OneDrive-synced,
  so per-character writes fight the sync client for the file, and the identity fields were spawning
  one `git config` process per character. Mutate settings in memory at once (live toggles need
  that), debounce the write, and flush it in the setting tab's `hide()`.
- **Anything the explorer decorator asks per row must be O(1).** It runs for every visible row on
  every repaint, and a repaint follows every DOM mutation; `hasPairedFolder` once answered through
  `pagesInFolder`, making a single repaint O(rows × pages) with a sort per row.
- Windows dev environment: PowerShell 5.1 quirks; paths with spaces (`DevOps Wiki`) —
  always quote in scripts.
