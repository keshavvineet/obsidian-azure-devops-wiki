# Scoping: more than one wiki in one vault

Status: **scoping only, nothing built.** Written for PLAN.md feature request 1 ("a way to add mklink
links or multiple wikis under the same vault… a button to pick a folder and add it").

The ask has two halves, and they are wildly different in size:

| Half | Size |
|---|---|
| A button that picks a folder and makes a junction into the vault | ~a day |
| Making the plugin correct once there is more than one wiki in the vault | a full phase, ~7 coupling clusters |

The second half is the whole cost, and it is why this document exists: **the junction button on its
own would produce a vault that silently publishes wrong content.** Section 1 is the evidence.

---

## 1. What Windows and git actually do — measured, not assumed

Run on this machine (Windows 11, Git for Windows), two real repos, `outer/WikiB` a directory
junction to `wikiB`:

```
$ git -C outer status --porcelain
?? WikiB/                                    ← git FOLLOWS the junction

$ git -C outer add -A -- .
warning: adding embedded git repository: WikiB

$ git -C outer commit -m gitlink && git -C outer ls-tree HEAD
160000 commit e028a5b039dc785143fa0d5bed6836a0bc058c2e   WikiB     ← a gitlink, committed
100644 blob   78981922613b2afb6025042ff6bd878ac1994e85   a.md
```

Three findings, all load-bearing:

1. **Git follows a directory junction.** It does not skip it the way it skips a symlink on some
   platforms. Anything inside is visible to the outer repository.
2. **A junction to a repo becomes a gitlink.** Because the target has its own `.git`, `git add`
   records mode `160000` — a submodule entry pointing at a commit SHA. Azure DevOps' wiki has no
   concept of a submodule; that entry publishes to the whole team as a broken node.
3. **`.gitignore` is a complete fix.** With `WikiB/` ignored, `git add -A -- .` stages nothing but
   the ignore file itself. Edits made *through* the junction are still seen correctly by `wikiB`'s
   own repository.

Finding 2 is the danger: today's `stageAll()` is
`git add -A -- . :(exclude).obsidian` ([gitService.ts:365](../src/git/gitService.ts#L365)), run at
the vault root. If the vault root is itself wiki A's clone, junctioning wiki B inside it and
pressing **Publish** commits a gitlink into wiki A. Nothing in the plugin would notice, and the
portal cannot fix it.

### The consequence for the design

**The vault root must not be a wiki.** The only sound shape is a container vault holding N
junctions, each to a wiki clone, with no repository at the root at all:

```
MyWikis/                 ← the vault; NOT a git repo
  .obsidian/
  Product-Docs/          → junction to …/Product-Documentation.wiki
  Team-Handbook/         → junction to …/Team-Handbook.wiki
```

That is also the shape that breaks the most existing code, because
[vaultSetup.ts:82-89](../src/setup/vaultSetup.ts#L82-L89) raises an **error** when the vault root is
not the repo root — the current plugin would declare this vault broken on sight.

The alternative (keep wiki A at the root, junction B and C inside, `.gitignore` the mount points) is
one forgotten `.gitignore` line away from finding 2, on a repository the whole team reads. It should
not be offered.

---

## 2. Coupling inventory

Seven clusters. Each is "what has to change", not "what is nice to have".

### 2.1 One `GitService` per wiki — *small*

`GitService` is stateless apart from its `cwd`
([gitService.ts:73](../src/git/gitService.ts#L73), `cwd: this.cwd` on every `execFile` at
[:101](../src/git/gitService.ts#L101)), so N instances cost nothing. The single construction site is
[main.ts:370](../src/main.ts#L370), hard-wired to `adapter.getBasePath()`. This is the easy part and
it is misleading — it makes the feature look cheap.

### 2.2 Status fan-out — *medium*

[main.ts:79](../src/main.ts#L79) holds one flat `changedPaths: Map<string, ChangeKind>`, filled in
[onGitStatusRead](../src/main.ts#L411) from one `GitStatus`. Every consumer (status bar, toolbar,
explorer marks, wiki tree, changes pane) reads that one map — the "one funnel" decision from Phase 7
note 5, which was right for one wiki and is the thing to generalise for N. Each repo reports
*repo-relative* paths that must be prefixed with its mount folder to become vault paths before
anything merges them.

[gitStatusBar.ts:143-156](../src/git/gitStatusBar.ts#L143-L156) polls one repo every 60 s and stores
one `GitStatus | null`, where `null` means "not a repo". With N wikis that becomes N polls (see
PLAN §6's existing note about moving the poll behind window focus — do that first, or this becomes N
× 60 s of `git status` on a machine that is also running OneDrive).

### 2.3 Which wiki is this page in? — *medium, and the real design question*

`PageEntry` has **no wiki identity** ([pageIndex.ts:113-137](../src/pages/pageIndex.ts#L113-L137)),
and three of its fields are computed from the vault-relative path on the assumption that the vault
root is the wiki root:

- `wikiPath` ([:120](../src/pages/pageIndex.ts#L120)) — the `/A/B` ADO link target
- `titlePath` ([:121](../src/pages/pageIndex.ts#L121)) — feeds `wikiWebUrl`
- `parentPath` ([:123](../src/pages/pageIndex.ts#L123)) — `folderPath === "" ? null`, i.e. "a page at
  the vault root has no parent"

Under a junction, `Product-Docs/Home.md` would get `wikiPath` `/Product-Docs/Home` (wrong — it is
`/Home` in its own wiki) and `parentPath` `Product-Docs.md` (a file that does not exist). The fix is
a `wikiRoot` on every entry and mount-prefix stripping throughout — which touches
`rootPages()`, `foldersWithPages()` and the root `.order` handling in
[orderManager.ts:208-211](../src/order/orderManager.ts#L208-L211) and
[:115](../src/order/orderManager.ts#L115) (`setFirst("", …)` = "set the wiki home page", called from
[pageCommands.ts](../src/pages/pageCommands.ts)).

### 2.4 Root-absolute links and attachments — *medium*

ADO's `/Foo` links resolve from the wiki root, and
[adoLinkResolver.ts:5-7](../src/links/adoLinkResolver.ts#L5-L7) says outright that "the vault root
*is* that repository root". `pageCandidates` ([:109-118](../src/links/adoLinkResolver.ts#L109-L118))
resolves `/`-prefixed targets against the vault, and `normalizeSegments`
([:121-135](../src/links/adoLinkResolver.ts#L121-L135)) refuses to climb above it — with junctions,
`/Foo` inside wiki B must mean `Product-Docs/Foo`, and `..` must stop at the mount, not the vault.

Same assumption in every attachment path: `/.attachments/…` is vault-root-relative in
`attachmentNames.ts`, `adoLinkService.ts` and `pasteHandler.ts` (which *creates* `.attachments` at
the vault root — with N wikis it would put wiki B's pasted image into wiki A's folder, i.e. publish
it to the wrong team). `compatLinter.ts:112-153` lists only the root `.attachments`, so wiki B's
images would all be reported missing.

Cross-wiki title collisions also become likely and are unhandled
([pageIndex.ts:232](../src/pages/pageIndex.ts#L232), `adoLinkService.ts:195`).

### 2.5 Settings become per-wiki — *medium, and user-visible*

Currently one flat record ([settings.ts:10-21](../src/settings.ts#L10-L21)). Per-wiki by nature:
`project`, `wikiName`, `wikiBranch` (a wiki provisioned before the default-branch rename is on
`wikiMaster` — Phase 3 note 8, and `adoptWikiBranch` at [main.ts:300](../src/main.ts#L300) writes the
one global value), `commitMessageTemplate`, and the commit identity (already written per-repo with
`git config --local`, but only ever to `plugin.git`). Shareable: `organizationUrl` and `pat` when the
wikis are in one organization — which is the common case and worth keeping global with a per-wiki
override rather than duplicating.

Genuinely vault-wide and fine as-is: auto-refresh, `preSyncLint`, lint rule toggles, every
display/rendering toggle.

### 2.6 Two buttons become N — *medium, mostly UX*

The toolbar's `SyncControls` are all zero-arg
([toolbarView.ts:22-45](../src/toolbar/toolbarView.ts#L22-L45)). The useful property is that the
toolbar is already **per editor tab** — so "Publish" can mean "publish the wiki this page belongs
to" without any new UI, which is probably the right answer. The status bar and the changes pane need
a real decision: aggregate ("3 wikis · 5 pending" with a menu), or scope to the active page's wiki.
The changes pane also has a latent bug that becomes real here —
[wikiChangesView.ts:266-273](../src/git/wikiChangesView.ts#L266-L273) feeds a *repo-relative* path to
`index.forPath`, which expects a vault path.

### 2.7 Setup check and the linter — *small, but blocking*

[vaultSetup.ts:82-89](../src/setup/vaultSetup.ts#L82-L89) errors when `repoRoot !== vaultPath`, using
string comparison with no junction resolution ([:197-201](../src/setup/vaultSetup.ts#L197-L201)) — so
the recommended layout fails the check today. `CLOUD_FOLDERS` also only tests the vault path, so a
junction pointing *into* OneDrive would not raise the file-locking warning that the whole check
exists for — and that warning matters more here, not less.

`compatLinter.lintVault` walks `index.all()` and reports one count for everything; `.gitignore` is
read and written at the vault root only (`setupCheck.ts:45-53`), while each wiki needs its own.

Also: `scripts/verify-against-wiki.ts` walks with `entry.isDirectory()`, which is **false** for a
junction dirent, so `npm run verify-wiki` would silently skip every mounted wiki.

---

## 3. Is this a separate plugin?

The request asks. Split it:

- **The junction button alone** — pick a folder, create a junction, tell Obsidian to rescan — is
  generic, tiny, and plausibly already exists in the community plugin list. Worth searching before
  building. It is also the half that is *unsafe on its own*, per §1.
- **Everything in §2** is wiki-specific and cannot leave this plugin.

So: not a separate plugin, and the button should not ship before §2.2–§2.4 exist, because a vault
with two wikis and a single-wiki plugin publishes to the wrong repository.

---

## 4. Recommended order, if it goes ahead

1. **Decide the layout** — container vault, no repo at the root (§1). Everything else depends on it.
2. **`wikiRoot` on `PageEntry`** and a `wikis()` registry on the index (§2.3). Pure, testable, and
   every later step reads it. Nothing user-visible yet.
3. **N `GitService`s + merged status** (§2.1, §2.2), with the status-bar poll moved behind window
   focus at the same time.
4. **Mount-relative links and attachments** (§2.4) — the correctness cliff; needs its own test pass
   against a two-wiki fixture.
5. **Per-wiki settings** (§2.5) and the setup check (§2.7).
6. **The junction button and the N-wiki UI** (§2.6) — last, when the vault behind it is correct.

Steps 2–4 are the phase. Step 1 is a conversation, and step 6 is the day's work the request
originally asked for.
