/** All user-facing text lives here (NFR-6: localization-ready). */
export const S = {
  commands: {
    newPage: "Create wiki page",
    newSubpage: "Create subpage",
    renamePage: "Rename wiki page",
    deletePage: "Delete wiki page",
    movePageUp: "Move this page up in the wiki order",
    movePageDown: "Move this page down in the wiki order",
    repairOrder: "Repair .order files",
    openWikiPage: "Open wiki page",
    openWikiTree: "Show wiki page tree",
    openWikiChanges: "Show wiki changes",
    openPageActivity: "Show comments and history for this page",
    refresh: "Refresh from Azure DevOps",
    sync: "Sync to Azure DevOps",
    convertPageLinks: "Convert Obsidian links in this page to Azure DevOps links",
    convertVaultLinks: "Convert Obsidian links in every page to Azure DevOps links",
    openInAdo: "Open in Azure DevOps",
    copyAdoLink: "Copy Azure DevOps wiki link",
    copyWikiPath: "Copy wiki-relative path",
    lintFile: "Check this page for Azure DevOps problems",
    lintVault: "Check every page for Azure DevOps problems",
    openLintResults: "Show Azure DevOps compatibility results",
    setupCheck: "Check vault setup",
  },
  /** The compatibility linter (FR-8). */
  lint: {
    title: "Compatibility",
    scanning: "Checking pages…",
    scopeFile: "This page",
    scopeVault: "Whole wiki",
    rescan: "Check again",
    fixAll: "Fix all",
    fix: "Fix",
    clean: "Nothing to fix — this content is Azure DevOps-native.",
    cleanVault: "Nothing to fix — every page is Azure DevOps-native.",
    notScanned: "Run a check to see how this wiki will render on Azure DevOps.",
    summary: (errors: number, warnings: number, infos: number) =>
      `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}, ${infos} note${infos === 1 ? "" : "s"}`,
    scanned: (pages: number) => `${pages} page${pages === 1 ? "" : "s"} checked`,
    severityLabel: { error: "Error", warn: "Warning", info: "Note" } as const,
    showAll: "All",
    fixedCount: (count: number) =>
      count === 0
        ? "Nothing was changed."
        : `Fixed ${count} problem${count === 1 ? "" : "s"}. Check the result before syncing.`,
    staleFindings: (path: string) =>
      `"${path}" changed since the check ran, so nothing was altered. Check it again.`,
    attachmentTooLarge: (name: string, size: number, limit: number) =>
      `"${name}" is ${(size / (1024 * 1024)).toFixed(1)} MB; Azure DevOps rejects attachments over ${Math.round(limit / (1024 * 1024))} MB.`,
    attachmentTooLargeAdvice: "Compress it, or link to it somewhere else.",
    orphanAttachment: (name: string) => `No page links to "${name}".`,
    orphanAttachmentAdvice:
      "It is still published with the wiki. Delete it if it is left over from an edit.",
    preSyncHeading: "Some pages will not render correctly on Azure DevOps",
    preSyncBody: (errors: number) =>
      `${errors} problem${errors === 1 ? "" : "s"} that break rendering ${errors === 1 ? "was" : "were"} found. ` +
      "You can sync anyway, or stop and fix them first.",
    preSyncContinue: "Sync anyway",
    preSyncStop: "Stop and show me",
    disabledRulesName: "Checks to skip",
    disabledRulesDesc: "Untick a check to stop it reporting. Nothing else changes.",
  },
  /** The vault setup check (ARCHITECTURE §7). */
  setup: {
    title: "Vault setup",
    allGood: "This vault is set up correctly for an Azure DevOps wiki.",
    recheck: "Check again",
    applyAll: "Fix everything",
    apply: "Fix",
    gitignoreName: ".obsidian/ is not in .gitignore",
    gitignoreDesc:
      "Obsidian stores its settings in .obsidian/. Without this line they become wiki content " +
      "that everyone on the team sees. (Syncing already refuses to publish them, but any other " +
      "git tool would.)",
    gitignoreFix: "Add .obsidian/, .trash/ and .DS_Store to .gitignore",
    cloudName: (service: string) => `This wiki is inside ${service}`,
    cloudDesc:
      "File-syncing services lock files while they upload them, which corrupts a git repository " +
      "sooner or later. Clone the wiki somewhere outside it — a folder such as C:\\wikis.",
    cloudAdvice: "Nothing here can fix this; the clone has to move.",
    wikilinksName: 'Obsidian is set to write [[wikilinks]]',
    wikilinksDesc:
      "Azure DevOps shows [[Page]] as literal text. The plugin converts new links anyway, but " +
      "turning this off means they are never written in the first place.",
    wikilinksFix: "Use markdown links",
    linkFormatName: "New links are not absolute",
    linkFormatDesc:
      "Azure DevOps wiki links are root-absolute (/Parent/Child). Obsidian is set to write " +
      "shortest-possible or relative paths.",
    linkFormatFix: "Use absolute paths",
    sourceModeName: "Editing is set to Source mode",
    sourceModeDesc:
      "In Source mode Obsidian shows the raw markdown while you edit — no tables, no images, no " +
      "table of contents, and none of this plugin's Azure DevOps rendering. Live Preview shows " +
      "the page as the wiki will.",
    sourceModeFix: "Use Live Preview",
    lineEndingsName: "Git is converting line endings in this wiki",
    lineEndingsDesc:
      "This clone has core.autocrlf=true, so git writes Windows line endings into the pages but " +
      "Obsidian always saves Unix ones. Every page you edit then stays marked as unpublished for " +
      "good, even when not a single character differs.",
    lineEndingsFix: "Stop converting line endings in this wiki only",
    extensionsName: '"Detect all file extensions" is on',
    extensionsDesc:
      "It makes Obsidian show page files as 'Name.md' and interferes with the decoded titles.",
    extensionsFix: "Turn it off",
    notARepoName: "This vault is not a git clone",
    notARepoDesc:
      "Refresh and Sync need one. Open the folder your wiki was cloned into, not a copy of it.",
    rootName: "The vault is not the repository root",
    rootDesc:
      "Azure DevOps page paths are relative to the repository root, so the vault has to be " +
      "opened at that folder or every link resolves one level off.",
  },
  /** Labels for the ADO syntax the plugin renders in place of raw text. */
  render: {
    tocTitle: "Contents",
    tocEmpty: "This page has no headings yet.",
    tocChip: "Contents",
    tocIgnored: "Second table of contents — Azure DevOps renders only the first one.",
    subpagesTitle: "Subpages",
    subpagesEmpty: "This page has no subpages yet.",
    subpagesChip: "Subpages",
    macroChipHint: "Azure DevOps generates this list when the page is published.",
    videoLabel: "Video",
    queryTableLabel: "Azure DevOps query results",
    queryTableHint: "Live results are rendered by Azure DevOps.",
    openInAdo: "Open in Azure DevOps",
    missingAttachmentLabel: "Attachment not in this copy of the wiki",
    missingAttachment: (name: string) =>
      `${name} is linked here, but the file is not in the .attachments folder. ` +
      "Click Get updates to fetch it from Azure DevOps.",
    connectionMissing:
      "Set the organization URL and project in the plugin settings to link work items.",
    brokenLink: (target: string) => `No wiki page at ${target}`,
  },
  toolbar: {
    heading: "Heading level",
    bold: "Bold",
    italic: "Italic",
    strikethrough: "Strikethrough",
    inlineCode: "Inline code",
    codeBlock: "Code block",
    quote: "Quote",
    bulletList: "Bulleted list",
    numberedList: "Numbered list",
    taskList: "Task list",
    table: "Insert table",
    horizontalRule: "Horizontal rule",
    link: "Insert link",
    image: "Insert image",
    toc: "Insert table of contents",
    mermaid: "Insert Mermaid diagram",
    math: "Insert math",
    workItem: "Insert work item reference",
    workItemSearch: "Insert work item reference (type to search)",
    /**
     * The two sync buttons live in the page toolbar as well as in the ribbon, deliberately
     * labelled with words rather than arrows: "which way does this go" is the one thing a
     * functional user must never have to guess.
     */
    getUpdates: "Get updates",
    getUpdatesHint: "Bring everyone else's latest pages from Azure DevOps into this folder.",
    getUpdatesWaiting: (n: number) =>
      `${n} update${n === 1 ? "" : "s"} waiting in Azure DevOps. Click to bring ${n === 1 ? "it" : "them"} in.`,
    publish: "Publish",
    publishHint: "Send your edits to Azure DevOps so the rest of the team can see them.",
    publishPending: (n: number) =>
      `${n} change${n === 1 ? "" : "s"} on this computer are not in Azure DevOps yet. Click to publish ${n === 1 ? "it" : "them"}.`,
    publishNothing: "Everything you have edited is already in Azure DevOps.",
    syncBusy: "A refresh or publish is already running…",
  },
  /** The "Wiki changes" sidebar: pages not published yet, and what changed recently. */
  changes: {
    title: "Wiki changes",
    pendingHeading: (n: number) =>
      n === 0 ? "Not published yet" : `Not published yet (${n})`,
    nothingPending: "Everything you have edited is in Azure DevOps.",
    notReadYet: "Checking what has changed…",
    noRepo: "This vault is not a clone of an Azure DevOps wiki, so there is nothing to compare.",
    recentHeading: "Changed recently",
    loading: "Reading the wiki history…",
    noHistory: "No history yet.",
    unknownTime: "at an unknown time",
    commitMeta: (author: string, when: string, pages: number) =>
      pages === 0
        ? `${author} · ${when}`
        : `${author} · ${when} · ${pages} page${pages === 1 ? "" : "s"}`,
    pageGone: "This page is no longer in the wiki.",
    kindLabel: {
      modified: "Edited",
      added: "New",
      deleted: "Deleted",
      renamed: "Renamed",
      untracked: "New",
      conflicted: "Needs a decision",
    } as const,
  },
  tree: {
    title: "Wiki pages",
    empty: "No wiki pages here yet.",
    emptyHint: 'Use the "Create wiki page" command to add the first page.',
    expand: "Show subpages",
    collapse: "Hide subpages",
    renameHint:
      'This is the page title. Use the "Rename wiki page" command to change it — it also ' +
      "renames the file the Azure DevOps way and fixes every link to this page.",
  },
  /** The "Page activity" pane: this page's history and its Azure DevOps comments (FR-9.3). */
  activity: {
    title: "Page activity",
    noPage: "Open a wiki page to see its history and comments.",
    loading: "Loading…",
    commentsHeading: "Comments",
    noComments: "No comments on this page yet.",
    unknownAuthor: "Someone",
    unknownTime: "at an unknown time",
    commentPlaceholder: "Add a comment…",
    postComment: "Comment",
    posting: "Posting…",
    postHint: "Posted to Azure DevOps straight away — comments are not part of the wiki's files.",
    notConfigured:
      "Comments live in Azure DevOps rather than in the wiki's files, so this needs the " +
      "organization URL, project, wiki name and a personal access token.",
    unauthorized:
      "Azure DevOps refused the personal access token. It may have expired, or it may not have " +
      "the Wiki (Read & Write) scope that comments need.",
    notPublished:
      "Azure DevOps does not have this page yet — publish it and its comments will appear here.",
    commentsFailed: "Could not reach Azure DevOps for the comments on this page.",
    openSettings: "Open settings",
    retry: "Try again",
    historyHeading: "History",
    noHistory: "No history for this page in this copy of the wiki.",
    noRepo: "This vault is not a git clone, so there is no history to show.",
    commitMeta: (author: string, when: string) => `${author} · ${when}`,
  },
  menu: {
    openInNewTab: "Open in new tab",
    newSubpage: "New subpage",
    rename: "Rename…",
    delete: "Delete",
    moveUp: "Move up",
    moveDown: "Move down",
    setHomePage: "Set as wiki home page",
    showInWikiTree: "Show in the wiki page order",
  },
  switcher: {
    placeholder: "Find a wiki page by title…",
    openHint: "open",
    newTabHint: "open in new tab",
  },
  settings: {
    connectionHeading: "Azure DevOps connection",
    organizationUrlName: "Organization URL",
    organizationUrlDesc: "e.g. https://dev.azure.com/contoso",
    projectName: "Project",
    wikiNameName: "Wiki name",
    wikiNameDesc: "Used for 'Open in Azure DevOps' links, e.g. MyProject.wiki",
    patName: "Personal access token",
    patDesc:
      "Needed for #-search and hover titles on work items (scope: Work Items Read). Stored in " +
      "plugin data as plain text — an ADO_WIKI_PAT environment variable always overrides it, " +
      "so a shared machine does not need a token saved here at all.",
    identityHeading: "Commit identity",
    userNameName: "Name for new commits",
    userNameDesc: "Applies to this repository only. Leave as-is to use your global git identity.",
    userEmailName: "Email for new commits",
    userEmailDesc: "Applies to this repository only.",
    forgetCredentialName: "Forget the saved Azure DevOps sign-in",
    forgetCredentialDesc:
      "Clears the credential your git installation has cached for this wiki, so the next " +
      "Refresh or Sync asks you to sign in again. Nothing is changed until then.",
    forgetCredentialButton: "Forget",
    forgetCredentialDone: "Forgot the saved sign-in for this wiki.",
    forgetCredentialFailed: "Could not clear the saved sign-in — is this vault a git repository?",
    toolbarName: "Show formatting toolbar",
    toolbarDesc: "A row of buttons above the editor mirroring Azure DevOps' own toolbar.",
    displayHeading: "Display",
    decorateName: "Show decoded page titles",
    decorateDesc:
      "Display page titles instead of encoded file names in the file explorer, tab headers " +
      "and window title. Turn this off to see the file names exactly as they are on disk.",
    singleRowName: "One row per page in the file explorer",
    singleRowDesc:
      "A page that has subpages is stored as a file and a folder, so Obsidian's explorer lists " +
      "it twice. This shows the folder row only, and clicking it opens the page — as Azure " +
      "DevOps does. The arrow still expands the subpages.",
    markChangedName: "Mark pages that are not published yet",
    markChangedDesc:
      "A page you have edited but not yet synced is highlighted in the file explorer and the " +
      'wiki tree, the way a code editor marks a modified file. The "Wiki changes" pane lists ' +
      "them all in one place.",
    promptForNameName: "Ask for the page title when creating a page",
    promptForNameDesc:
      "Obsidian's own New note and New folder ask for the title first, so the page is saved with " +
      "a name Azure DevOps can open straight away instead of being created as Untitled and " +
      "renamed afterwards. A wiki has no folders, so New folder makes a page that holds subpages.",
    preSyncLintName: "Check compatibility before syncing",
    preSyncLintOff: "Never",
    preSyncLintWarn: "Warn me, let me decide",
    preSyncLintBlock: "Stop the sync if something breaks rendering",
    preSyncLintDesc:
      "Runs the checks below over the pages you are about to publish. Only errors — content " +
      "Azure DevOps renders wrongly — ever stop a sync.",
    gitHeading: "Azure DevOps sync",
    gitEnabledName: "Enable Refresh and Sync",
    gitEnabledDesc:
      "Show the wiki status bar, ribbon buttons and git commands. Turn this off if you " +
      "prefer to manage this repository with your own git tooling.",
    wikiBranchName: "Wiki branch",
    wikiBranchDesc:
      "Refresh and Sync only run on this branch. Provisioned wikis use wikiMain, or " +
      "wikiMaster if they were created before Azure DevOps renamed it — the plugin picks " +
      'that up automatically. A "publish code as wiki" repository can use any branch.',
    autoRefreshOnOpenName: "Refresh when the vault opens",
    autoRefreshOnOpenDesc: "Pull the latest pages shortly after Obsidian starts.",
    autoRefreshIntervalName: "Refresh every (minutes)",
    autoRefreshIntervalDesc: "0 turns automatic refreshing off.",
    autoSyncOnCloseName: "Sync when Obsidian closes",
    autoSyncOnCloseDesc:
      "Publish pending edits on quit. If someone else changed the same page, the sync stops " +
      "and leaves your work committed locally — nothing is lost, and the next Refresh asks " +
      "you what to keep.",
    commitTemplateName: "Commit message",
    commitTemplateDesc: "Placeholders: {files}, {date}, {user}.",
    editingHeading: "Editing",
    wikilinkConversionName: "Convert Obsidian links",
    wikilinkConversionDesc:
      "Azure DevOps shows [[Some Page]] as literal text. Converting turns it into " +
      "[Some Page](/Some-Page), which renders in both places. A link to a page that does not " +
      "exist yet is always left alone.",
    wikilinkConversionInsert: "As soon as the link is written",
    wikilinkConversionSave: "When you leave the page",
    wikilinkConversionOff: "Never (use the commands instead)",
    renderingHeading: "Rendering",
    renderWorkItemsName: "Link work items and pull requests",
    renderWorkItemsDesc:
      "Show #123 and !123 as links into Azure DevOps. Needs the organization URL and project " +
      "above. An escaped \\#123 always stays plain text.",
    renderMentionsName: "Show mentions",
    renderMentionsDesc: "Render @<user> as a mention instead of raw text.",
    repairTablesName: "Repair tables that need a blank line",
    repairTablesDesc:
      "Azure DevOps renders a table that starts directly under a line of text; Obsidian needs " +
      "an empty line in between and otherwise shows the rows as text. This fixes the display " +
      "only — the page on disk is never changed.",
  },
  modals: {
    newPageTitle: "New wiki page",
    /** Obsidian's "New folder" — in a wiki that is a page that will hold subpages. */
    newSectionTitle: "New wiki page (with subpages)",
    newSubpageTitle: (parent: string) => `New subpage of "${parent}"`,
    renameTitle: "Rename wiki page",
    titleLabel: "Page title",
    titlePlaceholder: "How to contribute",
    parentLabel: "Under",
    parentRoot: "Top level of the wiki",
    fileNamePreview: (fileName: string) => `Saved as ${fileName}`,
    create: "Create",
    rename: "Rename",
    cancel: "Cancel",
    deleteConfirmTitle: "Delete wiki page",
    deleteConfirmBody: (title: string) =>
      `"${title}" will be moved to trash and removed from .order. This is committed to Azure DevOps on your next sync.`,
    delete: "Delete",
  },
  notices: {
    noActivePage: "Open a wiki page first.",
    notAWikiPage: "This file is not a wiki page.",
    noWikiPages: "This vault has no wiki pages yet.",
    homePageSet: (title: string) => `"${title}" is now the wiki home page.`,
    pageCreated: (title: string) => `Created "${title}".`,
    pageRenamed: (from: string, to: string) => `Renamed "${from}" to "${to}".`,
    linksUpdated: (count: number, files: number) =>
      `Updated ${count} link${count === 1 ? "" : "s"} in ${files} page${files === 1 ? "" : "s"}.`,
    pageDeleted: (title: string) => `Deleted "${title}".`,
    deleteHasSubpages: (title: string, count: number) =>
      `"${title}" still has ${count} subpage${count === 1 ? "" : "s"}. Delete or move them first.`,
    orderRepaired: (folders: number, added: number, removed: number) =>
      folders === 0
        ? "All .order files already match the pages on disk."
        : `Repaired ${folders} .order file${folders === 1 ? "" : "s"}: ${added} page${added === 1 ? "" : "s"} added, ${removed} stale entr${removed === 1 ? "y" : "ies"} removed.`,
    failed: (action: string, reason: string) => `Could not ${action}: ${reason}`,
    attachmentTooLarge: (name: string, limit: number) =>
      `"${name}" is larger than Azure DevOps allows for an attachment (${Math.round(limit / (1024 * 1024))} MB). It was not added.`,
    noWikilinks: "No Obsidian links to convert — this is already Azure DevOps markdown.",
    wikilinksConverted: (links: number, files: number) =>
      files <= 1
        ? `Converted ${links} link${links === 1 ? "" : "s"} to Azure DevOps form.`
        : `Converted ${links} link${links === 1 ? "" : "s"} in ${files} pages to Azure DevOps form.`,
    wikilinksUnresolved: (count: number) =>
      `${count} link${count === 1 ? "" : "s"} left unchanged — no page of that name exists yet.`,
    blockRefsDropped: (count: number) =>
      `${count} block reference${count === 1 ? "" : "s"} dropped: Azure DevOps has no equivalent.`,
    badPageName: (name: string, suggestion: string) =>
      `Azure DevOps cannot open a page called "${name}" — its file name is not in the wiki's ` +
      `own form. It should be "${suggestion}".`,
    badPageNameFix: "Fix the name…",
    badFolderName: (folder: string, suggestion: string, page: string) =>
      `Azure DevOps cannot open "${page}", because the folder "${folder}" above it is not in ` +
      `the wiki's own form — it should be "${suggestion}". Renaming the page will not help; ` +
      "rename the page that owns the folder and the folder follows.",
    badFolderNameFix: "Rename the parent page…",
    folderIsNowAPage: (title: string) =>
      `An Azure DevOps wiki has pages, not folders, so the folder you made is now a page ` +
      `called "${title}". Anything you put inside it becomes one of its subpages.`,
    foldersAreNowPages: (count: number) =>
      `${count} new folders are now wiki pages — Azure DevOps has no folders, only pages with ` +
      "subpages. Whatever you put inside them becomes a subpage.",
    badPageNames: (count: number) =>
      `${count} pages have file names Azure DevOps cannot open. Nothing is broken on this ` +
      "computer; they will not render in the wiki.",
    badPageNameShowAll: "Show me",
    badPageNamesBlockSync: (count: number) =>
      `Not published: ${count} new page${count === 1 ? "" : "s"} ` +
      `${count === 1 ? "has a name" : "have names"} Azure DevOps cannot open, and the portal ` +
      "cannot fix that afterwards. Rename them (the list is open on the right) and publish again.",
    pageNameFixed: (oldName: string, title: string) =>
      `Renamed "${oldName}" so Azure DevOps can open it. The page is still called "${title}" — ` +
      "only the file name behind it changed, because the wiki spells page names without spaces.",
    orderMoved: (title: string, direction: "up" | "down") =>
      `Moved "${title}" ${direction} in the wiki page order.`,
    orderAtEdge: (title: string) => `"${title}" is already at that end of its page order.`,
    copiedAdoLink: "Copied the Azure DevOps wiki link.",
    copiedWikiPath: "Copied the wiki-relative path.",
  },
  /**
   * Git, in the words of someone who has never used git: "Azure DevOps" rather than
   * "the remote", "your version" rather than "ours", and never the word "rebase" outside a
   * message that is deliberately handing the problem to an engineer.
   */
  git: {
    statusPrefix: "Wiki",
    statusUnavailable: "Wiki: no repository",
    statusUnavailableDetail:
      "This vault is not a git clone of an Azure DevOps wiki, so Refresh and Sync are off.",
    branchLabel: "Branch",
    detached: "no branch",
    unknownBranch: "unknown",
    cleanDetail: "No unsaved changes",
    dirtyDetail: (n: number) => `${n} local change${n === 1 ? "" : "s"} not yet synced`,
    behindDetail: (n: number) => `${n} update${n === 1 ? "" : "s"} waiting in Azure DevOps`,
    aheadDetail: (n: number) => `${n} commit${n === 1 ? "" : "s"} ready to push`,
    conflictDetail: (n: number) => `${n} file${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} your decision`,
    neverRefreshed: "Not refreshed yet this session",
    lastRefreshed: (relative: string) => `Last checked ${relative}`,
    clickForActions: "Click for wiki actions",
    justNow: "just now",
    minutesAgo: (n: number) => `${n} min ago`,
    hoursAgo: (n: number) => `${n} h ago`,
    daysAgo: (n: number) => `${n} d ago`,
    // Commit-message fragments.
    andJoin: " and ",
    andMorePages: (n: number) => ` and ${n} more page${n === 1 ? "" : "s"}`,
    attachmentCount: (n: number) => `${n} attachment${n === 1 ? "" : "s"}`,
    otherFileCount: (n: number) => `${n} file${n === 1 ? "" : "s"}`,
    busy: {
      refreshing: "refreshing…",
      syncing: "syncing…",
      conflict: "needs your decision",
    },
    menu: {
      refresh: "Refresh from Azure DevOps",
      sync: "Sync to Azure DevOps",
      settings: "Wiki settings",
    },
    notices: {
      upToDate: "Your wiki is up to date.",
      refreshed: (n: number) =>
        n === 0 ? "Refreshed — no page changes." : `Refreshed: ${n} page${n === 1 ? "" : "s"} updated.`,
      nothingToSync: "Nothing to sync — everything is already in Azure DevOps.",
      synced: (n: number) =>
        n === 0
          ? "Synced to Azure DevOps."
          : `Synced ${n} page${n === 1 ? "" : "s"} to Azure DevOps.`,
      committedOffline: (n: number) =>
        `Saved ${n} page${n === 1 ? "" : "s"} on this computer — Azure DevOps could not be reached. ` +
        "Sync again when you are back online.",
      conflictAborted: "Nothing was changed. Your pages are exactly as they were.",
      conflictAbortedSync:
        "Your edits are saved on this computer but not published. Ask an engineer to help " +
        "merge the changes.",
    },
    conflict: {
      heading: "Someone else changed the same pages",
      intro:
        "Azure DevOps has a different version of the pages below. Choose which version to " +
        "keep for each one. The version you do not keep stays in the page history.",
      keepMine: "Keep my version",
      takeServer: "Take server version",
      allMine: "Keep mine for all",
      allServer: "Take server for all",
      apply: "Apply",
      abort: "Cancel and ask an engineer",
      abortHint:
        "Cancelling undoes the update completely and leaves your pages untouched.",
    },
    errors: {
      busy: "A wiki refresh or sync is already running.",
      blocked: "Wiki sync is not available right now.",
      disabled: 'Refresh and Sync are switched off — turn on "Enable Refresh and Sync" in the plugin settings.',
      blockedByLint: "Sync cancelled: fix the compatibility problems first.",
      gitMissing:
        "Git is not installed, or not on the PATH. Refresh and Sync need it; ask IT to " +
        "install Git for Windows.",
      notARepo:
        "This vault is not a git clone, so there is nothing to sync. Open the folder your " +
        "wiki was cloned into.",
      operationInProgress: (state: string) =>
        `Git is in the middle of a ${state} in this folder. Ask an engineer to finish it, ` +
        "then try again.",
      detachedHead: (branch: string) =>
        `This clone is not on a branch, so it cannot sync. Ask an engineer to switch it back ` +
        `to ${branch}.`,
      wrongBranch: (current: string, expected: string) =>
        `You are on branch "${current}", but the wiki lives on "${expected}". Switch branches, ` +
        "or change the wiki branch in the plugin settings.",
      noUpstream: (branch: string) =>
        `Branch "${branch}" is not linked to Azure DevOps, so there is nowhere to sync to. ` +
        "Ask an engineer to set its upstream.",
      unreachable:
        "Could not reach Azure DevOps. Check your connection or VPN — your pages are safe " +
        "on this computer.",
      refreshFailed: "Could not refresh from Azure DevOps.",
      stageFailed: "Could not prepare your changes for syncing.",
      commitFailed: "Could not save your changes.",
      pushFailed: "Could not publish your changes to Azure DevOps.",
      pushRejectedHint: "Someone else published first — click Refresh, then Sync again.",
      resolveFailed: (files: string) =>
        `Could not apply your choice for: ${files}. Ask an engineer to finish the merge.`,
      cannotAbort:
        "These changes cannot be undone automatically. Your work is safe, but an engineer " +
        "needs to sort out the merge.",
      abortFailed: "Could not undo the update. Ask an engineer to check the repository.",
      tooManyConflictRounds:
        "Too many conflicting changes to work through here. Ask an engineer to merge them.",
      timedOut: "Azure DevOps did not respond in time. Try again in a moment.",
      unexpected: "Something went wrong talking to git.",
    },
  },
} as const;
