# Requirements — Obsidian Plugin for Azure DevOps Wiki

**Plugin name:** Azure DevOps Wiki (`azure-devops-wiki`)
**Status:** Approved for implementation — see [PLAN.md](../PLAN.md)
**Last updated:** 2026-08-07

## 1. Problem statement

Azure DevOps (ADO) wikis are backed by a Git repository (`<Project>.wiki`, branch `wikiMain`).
Editing them in the ADO web portal is clunky for heavy documentation work; editing the cloned
repo in a plain editor loses all wiki affordances (page titles, ordering, work-item links,
attachments, TOC). Obsidian is an excellent Markdown editor, but:

- ADO encodes page titles into file names (`Pre%2DRelease-RCA-Categories.md` = "Pre-Release RCA Categories"), which is unreadable in Obsidian's file explorer.
- ADO uses `.order` files for page sequence; Obsidian knows nothing about them.
- ADO image links are root-absolute (`/.attachments/image-<guid>.png`) and don't render in Obsidian.
- ADO-specific syntax (`[[_TOC_]]`, `::: mermaid`, `#123` work items, `@<user>` mentions) doesn't render in Obsidian.
- Obsidian-specific syntax (wikilinks, callouts, highlights, embeds) doesn't render in ADO.
- Functional (non-technical) users need one-click git pull/push, not a terminal.

## 2. Product vision

> Clone your ADO wiki with git, open the folder as an Obsidian vault, install this plugin —
> and Obsidian behaves like a first-class Azure DevOps wiki editor: readable page titles,
> correct page ordering, working images and links, the familiar ADO formatting toolbar,
> work-item linking, and one-click **Refresh** (pull) / **Sync** (commit + push) buttons.

## 3. Core design principle (non-negotiable)

**The on-disk files remain 100% ADO-native at all times.** The vault IS the wiki repo.
The plugin never rewrites files into an "Obsidian format" — it adapts Obsidian's *display,
editing and commands* to the ADO format. This guarantees:

- `git push` at any moment produces a valid, correctly-rendering ADO wiki.
- Git diffs stay minimal and reviewable (no churn from format conversion).
- Users can mix editing in Obsidian, the ADO portal, and VS Code with no corruption.

Anything the user types in Obsidian-only syntax is either converted to ADO-safe syntax
**at insertion time** (e.g. wikilink autocomplete produces an ADO link) or flagged by the
**compatibility linter** before push.

## 4. Personas

| Persona | Needs |
|---|---|
| **Documentation author** (functional user, no git knowledge) | Readable titles, ADO-style toolbar, paste images, work-item links, one-click Refresh/Sync, never see a git command or a conflict they can't resolve with "keep mine / take theirs". |
| **Engineer** | Everything above, plus: clean diffs, keyboard-first commands, compat linter, no interference with their own git workflow (plugin git features are optional). |
| **Wiki gardener** | Reorder pages, move/rename pages safely (links + `.order` updated), find broken links and orphaned `.order` entries. |

## 5. Functional requirements

Priority: **P1** = must have (MVP), **P2** = should have, **P3** = nice to have.

### FR-1 Page naming & titles
- **FR-1.1 (P1)** Decode ADO file names to human titles everywhere Obsidian shows a file name: file explorer, tab headers, search results, quick switcher. Decoding: `-` → space, `%2D` → `-`, `%3A` → `:`, `%2A` → `*`, `%3F` → `?`, `%7C` → `|`, `%22` → `"`, `%3C`/`%3E` → `<`/`>`.
- **FR-1.2 (P1)** "New wiki page" and "New subpage" commands that ask for a *title* and create the correctly *encoded* file, update `.order`, and create the paired subfolder when needed.
- **FR-1.3 (P1)** "Rename page" command: re-encodes the file name, renames the paired subfolder (if any), updates the containing `.order`, and updates all inbound links across the vault.
- **FR-1.4 (P1)** Title validation per ADO rules: no `/ \ #`, no leading/trailing `.`, no control characters, full repo path ≤ 235 chars, unique (case-sensitive) within folder. Clear error messages before the file is created.
- **FR-1.5 (P2)** Warn when a page file exceeds 18 MB (ADO hard limit).

### FR-2 Page ordering (`.order`)
- **FR-2.1 (P1)** On page create/delete/rename via plugin commands, update the folder's `.order` file (create it if missing; new pages appended at the end).
- **FR-2.2 (P1)** On file create/delete/rename done *outside* plugin commands (drag in explorer, sync, etc.), detect and repair `.order` (append missing, drop orphans) — automatically or via a "Repair .order files" command (setting).
- **FR-2.3 (P2)** Sidebar "Wiki pages" view that shows the page tree in `.order` sequence with decoded titles, and supports drag-and-drop reordering (writes `.order`).
- **FR-2.4 (P3)** "Set as wiki home page" (move to first line of root `.order`).

### FR-3 Links & attachments
- **FR-3.1 (P1)** Render ADO root-absolute image links `![x](/.attachments/file.png)` in reading mode and live preview.
- **FR-3.2 (P1)** Paste/drop an image into the editor → file saved as `/.attachments/<name>-<guid8/uuid>.<ext>`, ADO-style link inserted. Never use Obsidian's default attachment folder.
- **FR-3.3 (P1)** Make ADO page links `[Text](/Parent-Page/Child-Page)` clickable in Obsidian (resolve to the corresponding `.md` file, including encoded-name resolution).
- **FR-3.4 (P1)** Wikilink interception: when the user completes `[[Some Page]]` (Obsidian's native autocomplete), the plugin replaces it with the ADO-safe form `[Some Page](/Path/To/Some-Page)`. Setting: convert on insert (default) / on save / never (lint only).
- **FR-3.5 (P2)** "Convert current file/vault to ADO-safe links" command (bulk wikilink → ADO link).
- **FR-3.6 (P2)** Attachment size warning > 19 MB (ADO hard limit).
- **FR-3.7 (P3)** Broken-link report (links to non-existent pages/attachments; unused attachments).

### FR-4 ADO syntax rendering inside Obsidian
- **FR-4.1 (P1)** `[[_TOC_]]` renders as a generated table of contents of the current page (reading mode + live preview widget), not as a broken wikilink.
- **FR-4.2 (P2)** `[[_TOSP_]]` renders as the list of subpages (from the paired folder's `.order`).
- **FR-4.3 (P1)** `::: mermaid … :::` blocks render as Mermaid diagrams (Obsidian natively renders only ```` ```mermaid ```` fences).
- **FR-4.4 (P1)** Work-item references `#123` render as links to `https://dev.azure.com/{org}/{project}/_workitems/edit/123` (org/project from settings). `\#123` stays escaped and unlinked.
- **FR-4.5 (P2)** `@<GUID-or-alias>` mentions render as a styled `@mention` chip (display name resolution is P3, needs REST).
- **FR-4.6 (P3)** `::: video … :::` and `::: query-table … :::` render as labelled placeholders (never as raw text soup).

### FR-5 Editor toolbar (parity with ADO wiki editor)
- **FR-5.1 (P1)** A toolbar (top of editor pane, toggleable) with ADO's buttons: header level dropdown, **Bold**, *Italic*, ~~Strikethrough~~, inline code, code block, quote, table insert (grid picker P3, 3×3 default P1), bulleted list, numbered list, task list, horizontal rule, link, image/attachment, `[[_TOC_]]` insert, Mermaid block insert, KaTeX math insert.
- **FR-5.2 (P1)** **Work item** button: inserts `#` and triggers the work-item suggester (FR-6.2), or with no PAT just inserts `#`.
- **FR-5.3 (P2)** **@ Mention** button (inserts `@`; resolution P3).
- **FR-5.4 (P2)** All toolbar actions also available as Obsidian commands (assignable hotkeys), matching ADO shortcuts where sensible (Ctrl+B, Ctrl+I, Ctrl+K…).

### FR-6 Work-item integration (Azure DevOps REST)
- **FR-6.1 (P2)** Settings for organization URL, project, wiki name, and a Personal Access Token (scope: Work Items Read). PAT stored in plugin data with a plain-text warning; env-var override supported.
- **FR-6.2 (P2)** Typing `#` followed by digits/text shows a suggester with matching work items (ID + title + type + state); selection inserts `#<ID>`.
- **FR-6.3 (P3)** Hover over `#123` shows work item title/state/assignee (cached).
- **FR-6.4 (P3)** Azure CLI (`az`) token as PAT alternative.

### FR-7 Git for functional users
- **FR-7.1 (P1)** Ribbon buttons + commands: **Wiki: Refresh** (`git pull --rebase --autostash`) and **Wiki: Sync** (stage all → commit with message template → pull --rebase → push).
- **FR-7.2 (P1)** Status bar item: current branch, ahead/behind counts, dirty-file count, last refresh time; click = open sync menu.
- **FR-7.3 (P1)** Uses the system `git` executable via child_process (desktop only). Respects existing credential helpers (Git Credential Manager) — the plugin never stores git credentials.
- **FR-7.4 (P1)** Conflict handling for functional users: on rebase conflict, offer "Keep my version / Take server version" per file, or "Abort and ask an engineer" (aborts rebase cleanly). Never leave the repo mid-rebase silently.
- **FR-7.5 (P2)** Auto-refresh on vault open + configurable interval; auto-sync on window close (opt-in).
- **FR-7.6 (P2)** Commit message template with `{date}`, `{user}`, `{files}` placeholders.
- **FR-7.7 (P2)** Guard rails: refuse to sync if not on the wiki branch (default `wikiMain`, configurable); warn if remote is unreachable.
- **FR-7.8 (P3)** Simple history view for the current page (`git log --follow`, read-only).

### FR-8 Compatibility linter
- **FR-8.1 (P2)** A "Wiki compatibility" pane/command listing everything in the current file (or vault) that will NOT render on ADO: Obsidian wikilinks/embeds `[[…]]`/`![[…]]`, callouts `> [!note]`, highlights `==…==`, comments `%%…%%`, footnotes, dataview blocks, unescaped `#` before digits meant literally, tags in frontmatter, etc. Each finding has a one-click fix where safe (see [SYNTAX-MAPPING.md](SYNTAX-MAPPING.md)).
- **FR-8.2 (P2)** Optional pre-sync lint: block/confirm Sync when P1-severity incompatibilities exist.
- **FR-8.3 (P3)** Auto-fix on save (opt-in, conservative fixes only).

### FR-9 Navigation helpers
- **FR-9.1 (P2)** "Open in Azure DevOps" command/context-menu: opens the current page in the ADO wiki web UI (URL built from settings + encoded path).
- **FR-9.2 (P3)** "Copy ADO wiki link" (web URL) and "Copy wiki-relative path".

## 6. Non-functional requirements

- **NFR-1** Platform: Obsidian desktop (Windows/macOS/Linux), `isDesktopOnly: true` (git + child_process). Mobile: out of scope for v1.
- **NFR-2** Performance: title decoding and link resolution must be O(1) per file via cached indexes; no full-vault scans on keystroke. Vault of 5,000 pages must open without noticeable delay.
- **NFR-3** Safety: the plugin never deletes user content; destructive git actions (reset, force push) are never issued. `.git` internals are never touched directly.
- **NFR-4** All file mutations (rename, `.order` writes) go through Obsidian's Vault API so other plugins and sync see them.
- **NFR-5** TypeScript strict mode; pure-logic modules (naming codec, `.order` codec, link converter, linter rules) are unit-tested (vitest) with fixtures copied from a real wiki structure.
- **NFR-6** Localization-ready strings (single strings module); English only for v1.
- **NFR-7** No telemetry.
- **NFR-8** Works with both provisioned wikis and "publish code as wiki" repos (same file conventions).

## 7. Out of scope (v1)

- Editing work items from Obsidian (read/link only).
- Wiki-wide search via ADO REST (Obsidian search covers the local clone).
- Multi-wiki vaults (one vault = one wiki repo clone).
- Obsidian Mobile.
- Real-time co-editing / merge UI beyond the functional-user conflict flow (FR-7.4).
- Migrating an existing Obsidian vault *into* an ADO wiki (import tool) — candidate for v2.

## 8. Ground truth references

- Real wiki repo examined: `AXBISDevOpsWiki` (structure, naming, `.order`, attachments confirmed) — see [ADO-WIKI-FORMAT.md](ADO-WIKI-FORMAT.md).
- [Microsoft: Markdown guidance](https://learn.microsoft.com/en-us/azure/devops/project/wiki/markdown-guidance?view=azure-devops)
- [Microsoft: Wiki file and folder structure](https://learn.microsoft.com/en-us/azure/devops/project/wiki/wiki-file-structure?view=azure-devops)
- [Microsoft: Naming restrictions](https://learn.microsoft.com/en-us/azure/devops/organizations/settings/naming-restrictions?view=azure-devops#wiki-page-and-file-names)

## 9. Success criteria

1. A functional user can clone the wiki (one-time, assisted), open it in Obsidian, edit pages with the toolbar, paste screenshots, link work items, and press **Sync** — and the ADO web wiki renders everything perfectly.
2. `git diff` after an Obsidian editing session contains only the lines the user actually changed.
3. An engineer reviewing the wiki repo cannot tell whether a page was edited in Obsidian or the ADO portal.
