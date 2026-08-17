# Azure DevOps Wiki — Obsidian plugin

Edit a git-cloned Azure DevOps wiki as a first-class Obsidian vault: decoded page titles,
`.order`-aware page tree, ADO rendering (images, `[[_TOC_]]`, Mermaid, work items), the
familiar ADO formatting toolbar, and one-click **Refresh** / **Sync** for people who have
never used git.

**Files on disk stay 100% Azure DevOps-native.** Encoded file names, root-absolute links,
`.order` files, `::: mermaid` blocks — the plugin adapts Obsidian's interface around that
format rather than converting your wiki into something else. Push at any moment and the wiki
renders correctly in the portal; `git diff` only ever shows what you actually edited.

---

## Install

You need Git installed ([Git for Windows](https://git-scm.com/download/win)), but you do not
need to know how to use it — the plugin downloads the wiki for you.

1. **Make an empty folder** for the wiki and open it in Obsidian as a vault (*Open folder as
   vault*). Put it somewhere *outside* OneDrive, Dropbox or Google Drive — they lock files
   while uploading and will corrupt the repository — and not inside another git repository.

2. **Install the plugin.** Either:
   - **BRAT** (recommended during the beta): install the *Obsidian42 – BRAT* community
     plugin, then *Add beta plugin* and paste this repository's URL. BRAT keeps it updated.
   - **Manually:** download `main.js`, `manifest.json` and `styles.css` from the
     [latest release](../../releases/latest) into
     `{vault}/.obsidian/plugins/azure-devops-wiki/`.
   - **From source:** `npm install && npm run build && npm run install-plugin -- "C:\path\to\vault"`.

3. **Turn off Restricted mode** and enable **Azure DevOps Wiki**.

4. **Paste your wiki's address.** Because the folder is empty, the plugin offers to set it up
   as soon as it loads. In Azure DevOps open your wiki, click the **…** menu beside its name,
   choose **Clone wiki**, and paste the address it shows. The plugin works out the branch, fills
   in the organization, project and wiki name, and downloads the pages.

   Nothing appeared? Run **Set up a wiki in this vault** from the Command Palette (`Ctrl+P`).
   Already have a clone? Just open it as a vault instead — steps 1 and 4 are for starting fresh.

5. **Run `Check vault setup`** (`Ctrl+P`). It points Obsidian's link settings at the format ADO
   uses, stops git rewriting line endings, and warns you if the clone is somewhere that will
   damage it.

6. **Optional: a personal access token** (Settings → Azure DevOps Wiki). Only needed to search
   work items by title, show their names on hover, and read page comments.

---

## What it does

### Pages

| | |
|---|---|
| **Decoded titles everywhere** | `Pre%2DRelease%3A-Q&A%3F.md` reads "Pre-Release: Q&A?" in the explorer, tabs and window title. |
| **One row per page** | A page with subpages is a file *and* a folder on disk; the explorer shows one row that opens the page and still expands. |
| **Wiki pages tree** | Right sidebar, in `.order` sequence, drag to reorder, right-click for new subpage / rename / delete / set as home page. |
| **Page order from anywhere** | Right-click any page in Obsidian's own file explorer for **Move up** / **Move down** / **Set as wiki home page**, or use the two commands. Obsidian's explorer sorts alphabetically and lists folders first, so it cannot *show* the wiki's order — the **Wiki pages** tree can, and "Show in the wiki page order" jumps there. |
| **Open wiki page** | Fuzzy switcher over decoded titles and title paths. |
| **Create / rename / delete** | Titles are validated against ADO's rules before anything touches disk; renaming moves the file, the paired folder, the `.order` entry *and* every inbound link. A page Obsidian's own *New note* creates with spaces in its name is re-encoded automatically, so Azure DevOps can open it. |

### Rendering — in both reading mode and live preview

`![x](/.attachments/f.png)` images · `[Text](/Parent/Child)` links · `[[_TOC_]]` and
`[[_TOSP_]]` (generated fresh on every render, from the text you are typing) ·
`::: mermaid` diagrams · `::: video` and `::: query-table` placeholders · `#123` work items ·
`!123` pull requests · `@<mention>` · tables that ADO renders but Obsidian would not.

### Sync

**Get updates** brings in what other people published; **Publish** sends yours. Both sit at the
right-hand end of the page toolbar with a count on them, in the ribbon, and in the status bar.
Conflicts open a dialog that asks, per page, which version to keep — in those words, not in git's.
Nothing destructive is ever run: no `reset`, no `clean`, no `--force`, and a test in the suite
fails the build if one ever appears in the source.

| | |
|---|---|
| **Wiki changes** pane | What you have edited but not published yet, and the last 15 changes to the wiki — author, when, and the pages each touched. Click a page to open it. |
| **Unpublished pages are marked** | A page you have changed is highlighted in the file explorer and the wiki tree, the way an editor marks a modified file. "Changed" means the text differs from what Azure DevOps has — not merely that git noticed the file was rewritten. |
| **Publish refuses a broken new page** | A new page whose file name Azure DevOps cannot open would break in the portal for everyone and cannot be fixed there. Publish stops and points at it. |

### Compatibility checks

`Check this page for Azure DevOps problems` (or the whole wiki) finds everything that will not
survive publication — `[[wikilinks]]`, `%%comments%%` that would leak, `==highlights==`,
callouts, footnotes, broken links, Mermaid that ADO's subset cannot draw, page names ADO
cannot decode, files past its size limits — and fixes what can be fixed safely. It can also
run automatically before every sync.

---

## Commands

Everything is in the Command Palette under "Azure DevOps Wiki". The ones worth binding:

| Command | Default |
|---|---|
| Refresh from Azure DevOps / Sync to Azure DevOps | toolbar + ribbon buttons + status bar |
| Show wiki changes | ribbon button |
| Open wiki page | — |
| Move this page up / down in the wiki order | — (also on the file explorer's right-click menu) |
| Bold / Italic / Insert link | `Ctrl+B` / `Ctrl+I` / `Ctrl+K` |
| Check this page for Azure DevOps problems | — |
| Check vault setup | — |

---

## Documentation

| Doc | Purpose |
|---|---|
| [PLAN.md](PLAN.md) | Phased implementation plan and status |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Functional & non-functional requirements |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Technical design |
| [docs/ADO-WIKI-FORMAT.md](docs/ADO-WIKI-FORMAT.md) | ADO wiki on-disk format — ground truth |
| [docs/SYNTAX-MAPPING.md](docs/SYNTAX-MAPPING.md) | Obsidian ⇄ ADO syntax reference |
| [CLAUDE.md](CLAUDE.md) | Working agreement for AI-assisted development |

---

## Development

```bash
npm install
npm run dev          # watch build straight into test-vault/ (then Ctrl+R in Obsidian)
npm run build        # type-check + production build
npm test             # unit tests (pure modules + performance budgets)
npm run verify-wiki -- "C:\path\to\a\wiki.wiki"   # read-only audit of a real clone
```

`test-vault/` mirrors a real ADO wiki — encoded names, `.order` chains, `.attachments`, and
fixture pages for every piece of ADO syntax — and is the safest place to try changes.

### Releasing

Tag a version and push it; the workflow in `.github/workflows/release.yml` builds and attaches
`main.js`, `manifest.json` and `styles.css` to a GitHub release.

```bash
npm version patch          # bumps package.json, manifest.json and versions.json
git push --follow-tags
```

## Licence

MIT.
