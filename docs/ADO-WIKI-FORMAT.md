# Azure DevOps Wiki — On-Disk Format (Ground Truth)

This document is the single source of truth for how an ADO wiki Git repository is laid out.
Verified against Microsoft docs **and** a real production wiki (`AXBISDevOpsWiki`) on 2026-08-07.
All plugin code that touches file names, `.order`, links or attachments must conform to this.

## 1. Repository shape

```
<Project>.wiki/                     ← repo name; default branch: wikiMain (older wikis: wikiMaster)
├── .attachments/                   ← ALL attachments, wiki-wide, flat folder at root
│   ├── image-aafc8a83-….png        ← "<original-stem>-<guid>.<ext>"
│   └── ==image_0==-2026884b-….png  ← original stems can contain any allowed chars
├── .order                          ← page sequence for the root level (one per folder)
├── .gitignore                      ← optional, normal git file
├── Page-One.md                     ← a root-level page, title "Page One"
├── Page-One/                       ← paired folder: exists IFF the page has subpages
│   ├── .order                      ← sequence of Page One's subpages
│   ├── Sub-Page.md
│   └── Sub-Page/                   ← nesting recurses the same way
│       └── …
└── Pre%2DRelease-RCA-Categories.md ← title "Pre-Release RCA Categories"
```

Key structural facts:

- **A page = one `.md` file.** Its *subpages* live in a sibling folder with the **exact same
  name** (minus `.md`). The folder exists only when there are subpages.
- **`.order` file** (no extension) in every folder that needs a non-alphabetical sequence:
  one page name per line, **without** `.md`, in display order, case-sensitive, must match
  file names exactly (encoded form). Pages missing from `.order` are appended alphabetically
  by ADO when rendering. The **first line of the root `.order` is the wiki home page**.
- **`.attachments/`** is a single flat folder at the repo root. The ADO editor names files
  `<original-name-stem>-<guid>.<extension>` (guid = full 36-char UUID, lowercase).
- A folder that contains only subfolders (no `.md`/`.order`) renders blank in ADO — always
  keep at least the `.order` file in parent folders.

### 1.1 Real-world drift (measured 2026-08-07, `Product-Engineering.wiki`, 96 pages)

Anyone can commit to a wiki repo, so a *live* wiki contains things the portal would never
write. Both of these were found in production and neither is an error to repair blindly:

- **`.order` entries with a `.md` extension**, mixed in with correct ones
  (`Product-Documentation/5.-ECM-Agent`: 13 such lines plus 6 valid ones, and 2 pages listed
  only in the invalid form). ADO ignores entries that do not match a page name, so those
  pages render **alphabetically at the end** — exactly what an unlisted page does. Reconciling
  such a file (drop non-matching entries, append the real pages) is therefore safe and
  matches what readers already see.
- **File names containing literal spaces** (`25PI3_3.8 Add business impact to Staging
  Journal.md`), i.e. never encoded by the portal. They are valid on disk and display as-is;
  they simply do not round-trip through `encodeTitle` (spaces would become hyphens). Treat
  them as display-only: show the name as it is, and let a rename canonicalise it.

Verification of the codec against the same repo: **96/96 page names round-trip exactly**, and
every escape in §2 except `%2A` occurs in real names (`%2D`×35, `%3A`×8, `%22`×4, `%3C`/`%3E`×2,
`%3F`×2, `%7C`×1). Literal `&`, `(`, `)`, `+`, `_` and unicode quotes all appear unencoded.

## 2. Page title ⇄ file name codec

The file name is the URL-encoded page title with space→hyphen. **Bidirectional table:**

| Title char | File name | Notes |
|---|---|---|
| space | `-` | the core substitution |
| `-` | `%2D` | because `-` means space |
| `:` | `%3A` | NTFS-illegal, must encode |
| `*` | `%2A` | NTFS-illegal |
| `?` | `%3F` | NTFS-illegal |
| `|` | `%7C` | NTFS-illegal |
| `"` | `%22` | NTFS-illegal |
| `<` `>` | `%3C` `%3E` | NTFS-illegal |
| everything else | literal | incl. unicode (`“ ” é`), `& ( ) . , ' !` — seen in production |

**Decode** = replace `-`→space then percent-decode the escapes above (order matters: decode
`%2D`→`-` *after* `-`→space, or do a single-pass tokenizer — single-pass is the required
implementation, see `src/naming/`).

**Forbidden in titles** (reject at input): `/`, `\`, `#`, unicode control/surrogate chars,
leading or trailing `.`, empty/whitespace-only titles.
**Limits:** full repo path ≤ 235 chars; page file ≤ 18 MB; attachment ≤ 19 MB.
**Uniqueness:** case-sensitive, per folder.

Production examples (from AXBISDevOpsWiki):

| File name | Displayed title |
|---|---|
| `Pre%2DRelease-RCA-Categories.md` | Pre-Release RCA Categories |
| `4.-Design-%2D-Connectors` (folder) | 4. Design - Connectors |
| `12.2.3-Feature-Break-Down-&-User-Stories-(MVP)` | 12.2.3 Feature Break Down & User Stories (MVP) |
| `233458-%2D-RCA-EDI-orders-processed-in-D365-but-files-remained-in-Azure-“Work”-folder.md` | 233458 - RCA EDI orders processed in D365 but files remained in Azure “Work” folder |

⚠️ Note the last two: `&`, `(`, `)` and curly unicode quotes are stored **literally**.
Only the seven NTFS-illegal characters plus hyphen are percent-encoded.

## 3. In-page link formats (as stored in `.md` files)

| Kind | Stored form | Notes |
|---|---|---|
| Image/attachment | `![image.png](/.attachments/image-<guid>.png)` | root-absolute, leading `/` |
| Page link | `[Display](/Parent-Page/Child-Page)` | root-absolute, **no `.md`**, encoded segment names |
| Relative page link | `[Display](target.md)` or `./page-2.md` | supported, less common |
| External | `[Display](https://…)` | bare http(s) URLs auto-link in ADO |
| Anchor | `[Display](#header-anchor)` | lowercase, spaces→`-`, most punctuation→`-` (ADO's algorithm ≈ GitHub's but converts `:? " @ , #` to hyphens) |
| Work item | `#123` (plain text) | ADO renders as WI link; escape as `\#123` for a literal |
| PR | `!123` | pull request link (rare in wikis) |
| Mention | `@<GUID>` or `@<alias>` | inserted by the ADO editor; stored with angle brackets |

## 4. ADO-specific block syntax

| Feature | Syntax | Obsidian native? |
|---|---|---|
| Table of contents | `[[_TOC_]]` on its own line | ✗ (looks like a wikilink) |
| Table of subpages | `[[_TOSP_]]` | ✗ |
| Mermaid | `::: mermaid` … `:::` **or** ```` ```mermaid ```` fence | fence ✓ / `:::` ✗ |
| Math | `$inline$` (KaTeX); block = ```` ```math ```` fence, `$$block$$` also renders | ✓ (MathJax — minor divergences) |
| Video | `::: video` `<url>` `:::` | ✗ |
| Query results | `::: query-table <query-guid>` `:::` | ✗ |
| Checklists | `- [ ]` / `- [x]` | ✓ |
| Emoji | `:smile:` shortcodes | ✗ (renders literal) |
| Inline HTML | most basic tags incl. `<br>`, `<mark>`, `<details>` | ✓ (mostly) |

Authoring guidance for new content: prefer ```` ```mermaid ```` fences (both render it);
the plugin must still *render* `::: mermaid` for existing pages.

### 4.1 TOC and Mermaid details (Microsoft markdown-guidance, verified 2026-08-10)

- **`[[_TOC_]]` is case-sensitive.** `[[_toc_]]` does not render a TOC on ADO, so the plugin must
  not render one for it either.
- **Only the first `[[_TOC_]]` on a page is rendered**; further instances are ignored.
- The TOC is built from `#`-style headings only (HTML headings are ignored) and uses the heading's
  **text**, stripped of markdown/HTML formatting. Its title on the page is "Contents".
- ADO supports a *subset* of Mermaid: `graph` works, `flowchart` does not, and long arrows
  (`---->`) and most HTML inside diagrams are unsupported. Obsidian renders all of it, so a
  diagram that works locally can still fail on ADO — a Phase 6 lint rule.

## 5. Git specifics

- Default branch: **`wikiMain`** on wikis provisioned recently, **`wikiMaster`** on older ones —
  Azure DevOps never renamed the branch of existing wikis. *Verified 2026-08-10 against a
  production wiki clone whose project name contains a space: it is on `wikiMaster` with upstream
  `origin/wikiMaster`.* Treat both as wiki branches; "publish code as wiki" repos use
  any branch at all, so the branch must stay a setting.
- Clone URL: `https://dev.azure.com/{org}/{project}/_git/{project}.wiki` (or `_git/{repo}`).
  Note the project segment is URL-encoded in the remote (`My%20Project`).
- Auth: Git Credential Manager / PAT — handled entirely by the user's git installation.
- The ADO web editor commits directly to the wiki branch; concurrent edits therefore surface as
  normal git conflicts on pull. Page-level conflicts are line-based like any Markdown file.
- `git status --porcelain=v2 --branch` on a real wiki clone reports exactly the four
  `# branch.*` headers the status parser expects (oid / head / upstream / ab).

## 6. Web URL construction (for "Open in ADO")

```
https://dev.azure.com/{org}/{project}/_wiki/wikis/{wikiName}/?pagePath=/{url-encoded page path}
```

`pagePath` uses the *title* path (spaces, not hyphens) URL-encoded — e.g.
`?pagePath=/Product Documentation/A. Connectivity Studio`. Verify against a live wiki
during Phase 5 (deep-link handling has org-specific quirks; the stable fallback is the
path-based form `…/_wiki/wikis/{wikiName}/{pageId}/{Page-Name}` when the page id is unknown).
