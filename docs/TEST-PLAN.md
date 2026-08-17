# Manual test plan

What a human has to check, because it is UI, git, or Azure DevOps rendering. Everything else is
covered by `npm test` (556 automated tests). Work top to bottom — later sections assume the
earlier ones passed.

**Where:** `test-vault/`, a real clone of a disposable scratch wiki (branch `wikiMaster`). Nothing
in there is read by anyone, so it is safe to break — but it **is** a real repository: pages you add
are published to Azure DevOps the moment you Sync.

**Every command below** is run from the command palette (`Ctrl+P`), by the exact name given.

For each step: do the action, check the expectation. If an expectation fails, note the step number
and see [What to send back](#what-to-send-back).

---

## 0. Setup (2 minutes)

1. Rebuild and install, so the vault runs the current code:
   ```bash
   npm run build && npm run install-plugin -- "test-vault"
   ```
2. Open `test-vault/` in Obsidian, then press `Ctrl+R` (reload without saving).
   *Expect:* no error notices on load. Settings → Community plugins shows **Azure DevOps Wiki**
   enabled.
3. Open the developer console (`Ctrl+Shift+I` → Console) and leave it open for the whole session.
   *Expect:* nothing red. `[azure-devops-wiki]` lines are failed git commands — worth reading.

---

## 1. Page titles (FR-1.1)

The vault holds pages whose file names are encoded; every place a name is shown must show the
decoded title.

| File on disk | Must read |
|---|---|
| `Release-Notes-%2D-2026-Q3.md` | Release Notes - 2026 Q3 |
| `Sample-Pages/2.-FAQ%3F.md` | 2. FAQ? |
| `Sample-Pages/3.-Design-%2D-Overview.md` | 3. Design - Overview |
| `Sample-Pages/3.-Design-%2D-Overview/Sequence-%7C-Flow.md` | Sequence \| Flow |

1. Look at the file explorer. *Expect:* all four read as the right-hand column — no `%2D`, `%3F`,
   `%7C` anywhere, and no hyphens where spaces belong.
2. Open `Sample Pages`. *Expect:* the tab header, the heading above the text (the "inline title"),
   and the window title all say "Sample Pages".
3. Click that inline title and try to type. *Expect:* it refuses — it is read-only while decorated,
   with a tooltip pointing at the Rename command. (Typing there would rename the file to something
   Azure DevOps cannot open.)
4. In the explorer, find `Sample Pages`. *Expect:* **one** row with an expand arrow — not a file row
   and a folder row for the same page. Click the arrow: it expands. Click the label: the page opens.
5. Run **Open wiki page**, type `faq`. *Expect:* "Sample Pages/2. FAQ?" is offered; `Enter` opens it,
   `Ctrl+Enter` opens it in a new tab.
6. Settings → Azure DevOps Wiki → turn **Show decoded page titles** off.
   *Expect:* the explorer immediately shows the raw file names, no reload needed, no errors. Turn it
   back on.

## 2. The wiki tree and page order (FR-2.3, FR-2.4)

1. Run **Show wiki page tree**. *Expect:* the right sidebar lists, in this order:
   `Test Wiki`, `Sample Pages`, `Release Notes - 2026 Q3`, `Execute State based automation`,
   `Class Diagram Example`, `Lint Sandbox`. That is `.order`, not alphabetical.
2. Expand `Sample Pages`. *Expect:* `1. Getting Started`, `3. Design - Overview`, `2. FAQ?` — in
   that order. `.order` wins over the numbers in the names.
3. Expand `3. Design - Overview`. *Expect:* `Sequence | Flow` above `Data Model` (again `.order`,
   not alphabetical), indented one level deeper.
4. Drag `2. FAQ?` above `3. Design - Overview`. *Expect:* the tree redraws in the new order, and
   `git diff test-vault/Sample-Pages/.order` shows **one line moved** — nothing else.
5. Right-click `2. FAQ?` → **Move up** / **Move down**. *Expect:* same effect without dragging; the
   options grey out at the ends of the list.
6. Try dragging `2. FAQ?` onto `Release Notes - 2026 Q3` (a different parent). *Expect:* the cursor
   refuses the drop and nothing changes — moving a page between parents is Rename's job, not drag's.
7. Right-click `Release Notes - 2026 Q3` → **Set as wiki home page**. *Expect:* it jumps to the top
   of the tree and becomes the first line of the root `.order`. Put `Test Wiki` back afterwards.
8. Click a page in the tree. *Expect:* it opens, and the row is highlighted as the active page.

## 3. Creating, renaming and deleting pages (FR-1.2 – FR-1.4, FR-2.1)

1. Open `Sample Pages`, run **Create subpage**, and type `Pre-Release: Q&A?`.
   *Expect:* the dialog previews the file name `Pre%2DRelease%3A-Q&A%3F.md` before you commit.
2. Confirm. *Expect:* the page opens; it is **last** in `Sample-Pages/.order` (where the Azure DevOps
   portal puts new pages); the tree shows "Pre-Release: Q&A?".
3. Run **Create wiki page** and type `CON`. *Expect:* refused with a readable reason (Windows
   reserves that name). Try `bad/name` — refused too. Try a title that duplicates a sibling —
   refused.
4. With "Pre-Release: Q&A?" open, run **Rename wiki page** and change it to `Q and A`.
   *Expect:* the file is renamed, its position in `.order` is unchanged, and a notice reports how
   many inbound links were updated.
5. Open `Sample Pages` and run **Rename wiki page** → `Sample Wiki Pages`.
   *Expect:* the `.md` **and** the paired folder are renamed together, the subpages still hang off
   it in the tree, and the links inside `Release Notes - 2026 Q3` that pointed at `/Sample-Pages`
   now point at `/Sample-Wiki-Pages`. Rename it back to `Sample Pages`.
6. Select `Q and A` and run **Delete wiki page**. *Expect:* a confirmation naming the page; after it,
   the file is gone and its `.order` line with it.
7. Try **Delete wiki page** on `Sample Pages` (which has subpages). *Expect:* refused, with a notice
   saying it still has subpages.
8. Outside Obsidian, create `test-vault/Out-Of-Band.md` in Explorer or VS Code.
   *Expect:* it appears in the tree, and the root `.order` gains it (at the end). Delete the file
   again; the `.order` line goes with it. Run **Repair .order files** — *expect* "already match".

### 3a. Folders, which the wiki does not have (Phase 11 — the round-7 report)

Since Phase 12, **New folder** asks for a title first (§3c), so the repair below is the *safety net*
rather than the usual path. To exercise the net, turn **Ask for the page title when creating a page**
off in settings for steps 9–10, then turn it back on.

9. With the setting off, use Obsidian's own **New folder** and call it `This is a new page`.
   *Expect:* after about two seconds, one notice saying an ADO wiki has pages rather than folders.
   On disk the folder is now `This-is-a-new-page/` **and** `This-is-a-new-page.md` exists beside it;
   the root `.order` ends with `This-is-a-new-page`; the wiki tree shows the page.
10. Add a note inside that folder with Obsidian's **New note**. *Expect:* it is renamed to the
    encoded form, and it appears in the tree **as a subpage** of the new page — not as an orphan.
    Nothing complains about the folder any more. Delete both afterwards, and restore the setting.
11. Right-click any page row in the **file explorer** → **New subpage**. *Expect:* the create dialog,
    headed with the parent's title; the page lands inside that page's folder. (This is the route
    that should make step 9 unnecessary.)
12. Run **Create wiki page** with no page open. *Expect:* an **Under** dropdown listing "Top level of
    the wiki" plus every page. Pick a page well down the tree and confirm — the new page is created
    there without having opened it first. *Expect also:* **Rename wiki page** has **no** such
    dropdown.
13. Make a folder whose name needs no encoding, e.g. `Research`. *Expect:* the paired
    `Research.md` is still created (the folder is not renamed, because it did not need it).
14. Check that nothing touched `.attachments` or `.obsidian` — neither should have grown a `.md`.

### 3c. Naming a page before it exists (Phase 12 — round-8 report 2)

19. Press **Ctrl+N** (Obsidian's own *New note*). *Expect:* the **New wiki page** dialog, with an
    **Under** dropdown — not an `Untitled.md` in the explorer. Type `FAQ for customers: v2?` and
    check the preview says `Saved as FAQ-for-customers%3A-v2%3F.md`, then create it. *Expect:* that
    exact file, and **no** `Untitled.md` anywhere.
20. Right-click a folder row → **New folder**. *Expect:* **New wiki page (with subpages)**. Create
    `Release notes`. *Expect:* both `Release-notes.md` **and** `Release-notes/` appear, and the page
    is in its parent's `.order`.
21. Press Escape on either dialog. *Expect:* Obsidian's own behaviour instead — an `Untitled` note
    or folder — which the name guards then rename. Nothing should throw.
22. Turn **Ask for the page title when creating a page** off in settings and repeat step 19.
    *Expect:* stock Obsidian behaviour is back.

### 3d. The colour marks on unpublished pages (Phase 12 — round-8 report 1)

23. Create a **new folder with two pages inside it** (steps 19–20). *Expect:* **both pages** are
    marked as not-published-yet in the explorer and the wiki tree, and the **Wiki changes** pane
    lists them **individually** — not as one folder row. This is the regression: git reports an
    untracked folder as a single `folder/` entry, so nothing inside it used to be marked.
24. Edit an existing page. *Expect:* it gets the "edited" mark. Delete a page. *Expect:* the
    "removed" mark. Press **Publish**; all marks clear.

### 3e. Comments and history (Phase 12 — round-8 report 4)

25. Open a page and run **Show comments and history for this page**. *Expect:* under **History**,
    the commits that touched *this* page (author and relative time); under **Comments**, either the
    comments from Azure DevOps or a message naming what is missing.
26. With no personal access token set, *expect* the message about needing the organization URL,
    project, wiki name and a token, plus an **Open settings** button — **not** an empty list.
27. Add a PAT with **Wiki (Read & Write)**. *Expect:* comments load. Type one and press **Comment**
    (or Ctrl+Enter). *Expect:* it appears in the list, and in the portal. **This half has never been
    run against the live API** — if it fails, the message should say which of the four things went
    wrong (no token / token refused / page not published / could not reach ADO).
28. Open a page you have created but not published. *Expect:* "Azure DevOps does not have this page
    yet — publish it and its comments will appear here."

### 3f. Toolbar placement of whole-line constructs (Phase 12 — round-8 report 5)

29. Put the cursor at the **end of a paragraph** and press **Table**. *Expect:* a blank line is
    inserted before the table, and the table renders — previously it was glued to the paragraph and
    showed as literal rows, which is what `table-needs-blank-line` reports.
30. Press **Horizontal rule** twice in a row. *Expect:* no growing stack of blank lines.
31. Press **Mermaid**. *Expect:* a ```` ```mermaid ```` fence, **not** `::: mermaid`.
32. Type `#` and pick a work item from the suggester in the middle of a sentence. *Expect:* a space
    after the number, so `#456` does not run into the next word.

### 3b. Keyboard navigation of the three panes (Phase 11, PLAN §4)

15. Click once in the **Wiki pages** pane, then use only the keyboard. *Expect:* ↑/↓ move between
    rows with a visible focus ring, → opens a page's subpages and ← closes them, ← on a closed page
    jumps up to its parent, Home/End go to the ends, Enter opens the page, Ctrl+Enter opens it in a
    new tab, and the menu key gives the same right-click menu. Tab should leave the pane in **one**
    press, not walk every row.
16. With the caret part-way down that list, press **Get updates**. *Expect:* the pane redraws and the
    caret stays on the same page — it does not jump back to the top.
17. Now click into the editor and press **Get updates** again. *Expect:* focus stays in the editor —
    the pane must not steal it.
18. Repeat step 15 in **Compatibility** (Enter jumps to the offending line) and in **Wiki changes**
    (→/← expand a commit, Enter opens a page).

## 4. Azure DevOps syntax rendering (FR-3.1, FR-3.3, FR-4)

**First, the cheap check that matters most: open every page in the vault.** A page carrying ADO
block syntax once threw out of CodeMirror while the editor was building itself, and Obsidian
reported that as `Failed to open ""` — empty quotes, naming nothing — with a blank editor
(round 5, ARCHITECTURE §4.4b). Click through all of them; *expect* no notice and no blank page.
If one appears, the useful text is in the developer console (`Ctrl+Shift+I`), never in the notice.

Then open `Release Notes - 2026 Q3`. Check each item in **reading mode** (`Ctrl+E`), then again in
live preview — both must work.

> Obsidian 1.13 asks *"Display Mermaid diagrams in this vault?"* once per vault. A consent card
> where a diagram should be is that prompt, not a failure.

1. `[[_TOC_]]` at the top. *Expect:* a table of contents of this page's headings, not a broken
   wikilink.
2. The image. *Expect:* the committed screenshot renders **in both modes** — check reading mode
   explicitly. `"/.attachments/… " could not be found.` means the internal-embed rewrite is not
   running; a picture that flashes and disappears means the replacement is wearing Obsidian's own
   `internal-embed` class again (round 6).
2a. Open `Execute State based automation` and find the `@<Vineet Khurana> @<Sai Ram>` line.
   *Expect:* two chips reading `@Vineet Khurana` and `@Sai Ram`, in reading mode **and** live
   preview. `@ @ :` means the names were eaten by the HTML parser; a row of little boxes means a
   mark decoration was split across the highlighter's tokens.
3. `#1` and `#4567`. *Expect:* links; clicking opens the work item in Azure DevOps (a 404 there is
   fine — the ids are invented). `\#1234` must stay plain text.
4. The `::: mermaid` block. *Expect:* a rendered diagram, not raw text. (`Sequence | Flow` uses the
   ```` ```mermaid ```` form; both must render.)
5. `[jump to Known issues](#known-issues)`. *Expect:* clicking scrolls to that heading.
6. The links at the bottom to `/Sample-Pages` and `/Sample-Pages/3.-Design-%2D-Overview/Data-Model`.
   *Expect:* both open the right page. **Nothing may be created** — if a click creates a new empty
   page, that is a bug worth reporting immediately.
7. Open `Data Model`. *Expect:* the table renders as a table even though no blank line precedes it.
   Then check `git status` — *expect* the file is **not** modified: the repair is display-only.
8. Open `Sample Pages`. *Expect:* `[[_TOSP_]]` renders as its three subpages, in `.order` sequence.

## 5. Editing (FR-3.2, FR-3.4, FR-5)

1. Open any page. *Expect:* the toolbar above the editor. Select a word and click **B**, then *I*,
   then the code button. *Expect:* `**word**`, `*word*`, `` `word` `` at the cursor/selection.
1a. Close every tab so the "No file is open" tab shows. *Expect:* the toolbar is **still there**, in
   the same place, with the formatting controls greyed out and **Get updates** / **Publish** live.
2. Try the header dropdown, quote, bullet list, numbered list, task list, horizontal rule, table,
   `[[_TOC_]]`, mermaid and math buttons. *Expect:* each inserts valid markdown at the cursor.
3. Press `Ctrl+B` / `Ctrl+I` / `Ctrl+K`. *Expect:* the same actions as the buttons.
4. Type `[[Sample` and pick "Sample Pages" from Obsidian's completion.
   *Expect:* what lands in the file is `[Sample Pages](/Sample-Pages)`, not `[[Sample Pages]]`.
5. Copy any image to the clipboard and paste it into a page.
   *Expect:* the file is saved as `.attachments/<name>-<guid>.<ext>` (check the folder), and the link
   inserted is `![…](/.attachments/…)` — **not** an Obsidian `![[…]]` embed, and not in an
   attachments folder of Obsidian's choosing.
6. In `Lint Sandbox`, run **Convert Obsidian links in this page to Azure DevOps links**.
   *Expect:* the wikilinks become `[text](/Path)` links; the rest of the page is untouched.

## 6. Compatibility linter (FR-8)

1. Open `Lint Sandbox` and run **Check this page for Azure DevOps problems**.
   *Expect:* a results pane listing the wikilink, embed, relative link, highlight, comment, tag,
   footnote, callout and task-in-table findings, each with the line it is on.
2. Click a finding. *Expect:* the editor jumps to that line.
3. Click a fix button. *Expect:* only that finding's text changes; the file is otherwise identical
   (`git diff test-vault/Lint-Sandbox.md`).
4. Run **Check every page for Azure DevOps problems**. *Expect:* the sample pages come back clean
   (they are ADO-native on purpose) except the deliberate broken link in `Sample Pages`
   (`/No-Such-Page`) and everything in `Lint Sandbox`.
5. Settings → turn one rule off, run the check again. *Expect:* that rule's findings are gone.

`Lint Sandbox` is **single use** — the fixes repair it, so it cannot trip the linter twice. For a
second round, copy `tests/fixtures/Compatibility-Fixture.md` into the vault, test against that, and
delete it afterwards. Note also that a vault-wide **Fix all** repairs `Data Model`'s table by
inserting the blank line, which is the one thing step 4.7 needs it *not* to have — so do §4 before
§6, or put that line back.

## 7. Git — the end-to-end test (FR-7)

This publishes to the real scratch wiki. That is the point.

Steps 3 and 4 have already happened once: the sample pages were published on 2026-08-11 in two
commits (`d4a69b6`, `bec754b`), pushed clean, with `.obsidian/` correctly left out and commit
messages built from decoded titles — "wiki: edited Lint Sandbox, Release Notes - 2026 Q3, Sample
Pages and 5 more pages…". So start at step 4 (look at the portal) and use step 3 for the next edit.

1. Look at the status bar. *Expect:* branch `wikiMaster`, and a count of changed pages. It must
   **not** count `Test-Wiki.md`: `git status` calls that file modified because of a line-ending
   quirk, while its content is identical, and the plugin is supposed to see through that.
2. Run **Show wiki changes**. *Expect:* the new sample pages listed as unpublished, `.obsidian/`
   not listed at all.
3. Edit one page (add a line), then run **Sync to Azure DevOps**.
   *Expect:* a progress notice, then success; the status bar's change count drops to nothing.
3a. Watch the toolbar's two buttons while step 3 runs, and again during a **Get updates**.
   *Expect:* **only the button you pressed spins.** Both go disabled — a publish fetches and rebases
   on the way, but that must not start the Get updates spinner (round 5, note 30).
4. Open the wiki in the portal:
   `https://dev.azure.com/{org}/{project}/_wiki/wikis/{project}.wiki`
   *Expect:* the new pages are there, in the tree order you set, with correct titles
   ("Release Notes - 2026 Q3", "2. FAQ?", "Sequence | Flow"), and the diagrams, TOC, table and
   image all render. **This is the acceptance test for the whole plugin.**
5. In the portal, edit a page and save. Back in Obsidian, run **Refresh from Azure DevOps**.
   *Expect:* the change arrives, with a notice saying how many pages were updated.
6. Now force a conflict: edit the *same line* of the same page in the portal and in Obsidian, then
   **Sync**. *Expect:* a conflict dialog offering, per file, "keep my version" / "take the server
   version" / "abort and ask an engineer". Try each on a separate attempt, and after each one check
   that `git -C test-vault status` is clean — never parked mid-rebase.
7. Run **Open in Azure DevOps** on `Sequence | Flow`. *Expect:* the portal opens that page (not the
   wiki root). Then **Copy Azure DevOps wiki link** and paste it in a browser — same page.
8. Settings → turn **Enable git integration** off. *Expect:* the status bar item and ribbon icons
   disappear and the identity settings vanish; turn it back on and they return, no reload.

## 8. Vault setup check (ARCHITECTURE §7)

1. Run **Check vault setup**. *Expect:* findings including "`.gitignore` does not list
   `.obsidian/`" and the line-endings warning (`core.autocrlf=true`).
2. Apply the line-endings fix. *Expect:* `Test-Wiki.md` stops showing as modified in `git status`.
3. Apply the `.gitignore` fix. *Expect:* one line appended to `.gitignore`, and `.obsidian/` no
   longer listed by `git status`.
4. Re-run the check. *Expect:* those findings are gone.

## 9. The settings freeze (the open bug)

The trace from 2026-08-11 shows no plugin work at all — the longest task in 37 seconds was
Obsidian's own click handling for opening the settings pane (385 ms). So it needs to be captured
**while it is stuck**:

1. In the vault where it happens (`AXBISDevOpsWiki`), install the current build first —
   `npm run install-plugin -- "<path to that vault>"` — then `Ctrl+R`.
2. `Ctrl+Shift+I` → **Performance** → ● Record → open the plugin's settings → wait for the freeze →
   wait for it to end → Stop. A trace that ends before the freeze cannot show it.
3. Answer this while it happens, because it splits the causes in two:
   **does it unstick by itself, and roughly after how long?** Around 60 s or 120 s means a git
   command hitting the plugin's timeouts (the network one is 120 s). Never recovering means a loop
   in the renderer.
4. Check Task Manager for `git-credential-manager.exe` or a "Sign in" window — Azure DevOps auth can
   open a dialog *behind* Obsidian, which looks exactly like a freeze.
5. Bisect: close Obsidian, edit that vault's
   `.obsidian/plugins/azure-devops-wiki/data.json`, reopen. `"gitEnabled": false` rules the git side
   in or out; `"decorateFileExplorer": false, "singleRowPerPage": false, "markChangedPages": false`
   rules out the explorer decoration. `"repairOrderOnStartup": false` is worth trying too if the
   stall is at vault open rather than at the settings pane.

## 10. Putting the vault back

The sample pages were published on 2026-08-11, so they are **committed**, not scratch files.
Uncommitted experiments are undone with:

```bash
cd test-vault
git checkout -- .            # undo edits to committed pages and .order
git clean -fd -e .obsidian   # remove pages you added but never published
```

To remove the published sample pages for good, delete them from the wiki tree in Obsidian
(**Delete wiki page**, deepest first) and Sync — or delete them in the portal and Refresh. Either
way, `Sample-Pages/` must lose its `.md` file *and* its folder, which the Delete command handles.

---

## What to send back

For anything that failed:

1. The step number and what you saw instead.
2. Anything red in the console (`Ctrl+Shift+I` → Console), copied as text.
3. For anything about page names, order or git: the output of
   `git -C test-vault status --short` and `git -C test-vault diff`.
4. For a freeze or a slow action: the trace file, recorded so that it *contains* the slow part.
