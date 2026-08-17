/**
 * Azure DevOps wiki page **comments** — the REST half of the page activity pane.  [PURE]
 *
 * Comments are not in the git repository. Microsoft's own documentation is explicit: *"The
 * internal database stores comments"*, and they are recorded per branch. So unlike every other
 * feature in this plugin, there is nothing on disk to read — this is the one place a PAT is not
 * optional, and the pane says so rather than showing an empty list.
 *
 * Two calls are needed for one page, because the comment routes are keyed by a numeric page id
 * and everything else here is keyed by a path:
 *
 *   GET  {org}/{project}/_apis/wiki/wikis/{wiki}/pages?path=/A/B          → { id }
 *   GET  {org}/{project}/_apis/wiki/wikis/{wiki}/pages/{id}/comments      → { comments: [...] }
 *   POST {org}/{project}/_apis/wiki/wikis/{wiki}/pages/{id}/comments      ← { text }
 *
 * The comment routes are a **preview** API and carry their own api-version, separate from the
 * `7.1` the work-item client uses — mixing them up returns 400 with a message about the version,
 * which is why the two constants are named rather than inlined.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */

/** The wiki REST surface is GA; page comments are still preview and version separately. */
export const WIKI_API_VERSION = "7.1";
export const WIKI_COMMENTS_API_VERSION = "7.1-preview.1";

export interface WikiCommentsConnection {
  organizationUrl: string;
  project: string;
  /** Wiki id or name, e.g. `MyProject.wiki`. */
  wikiName: string;
  pat: string;
}

export interface WikiComment {
  id: number;
  text: string;
  author: string;
  /** ISO timestamp, or null when the response did not carry one. */
  createdDate: string | null;
  isDeleted: boolean;
  /** Set for a reply; null for a top-level comment. */
  parentId: number | null;
}

export function isCommentsConfigured(connection: WikiCommentsConnection): boolean {
  return (
    connection.organizationUrl.trim().length > 0 &&
    connection.project.trim().length > 0 &&
    connection.wikiName.trim().length > 0 &&
    connection.pat.length > 0
  );
}

function trimTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function wikiBase(connection: WikiCommentsConnection): string {
  return (
    `${trimTrailingSlash(connection.organizationUrl)}/` +
    `${encodeURIComponent(connection.project.trim())}/_apis/wiki/wikis/` +
    `${encodeURIComponent(connection.wikiName.trim())}`
  );
}

/**
 * The lookup that turns a wiki path into the numeric id the comment routes need.
 *
 * `encodeURIComponent` over the whole path, slashes included: this is a query-string *value*, and
 * an ADO page title legitimately contains `?`, `&`, `#` and `%` (ADO-WIKI-FORMAT §2). Leaving the
 * separators bare here is the difference between finding `/A/B` and asking for a page called `A`.
 */
export function pageLookupUrl(connection: WikiCommentsConnection, wikiPath: string): string {
  return (
    `${wikiBase(connection)}/pages` +
    `?path=${encodeURIComponent(wikiPath)}&api-version=${WIKI_API_VERSION}`
  );
}

export function commentsUrl(connection: WikiCommentsConnection, pageId: number): string {
  return (
    `${wikiBase(connection)}/pages/${pageId}/comments` +
    `?api-version=${WIKI_COMMENTS_API_VERSION}&excludeDeleted=true&$top=200`
  );
}

export function addCommentUrl(connection: WikiCommentsConnection, pageId: number): string {
  return (
    `${wikiBase(connection)}/pages/${pageId}/comments` +
    `?api-version=${WIKI_COMMENTS_API_VERSION}`
  );
}

/** The page id out of a page lookup, or null when the response is not one. */
export function pageIdFrom(body: unknown): number | null {
  const id = (body as { id?: unknown } | null)?.id;
  return typeof id === "number" ? id : null;
}

interface RawComment {
  id?: unknown;
  text?: unknown;
  parentId?: unknown;
  isDeleted?: unknown;
  createdDate?: unknown;
  createdBy?: { displayName?: unknown; uniqueName?: unknown };
}

/**
 * Comments out of a list response, oldest first — the order a conversation reads in.
 *
 * Everything is checked rather than trusted: this is a preview API whose shape may change, and a
 * pane that throws on an unexpected field would be worse than one showing a comment without an
 * author.
 */
export function commentsFrom(body: unknown): WikiComment[] {
  const raw = (body as { comments?: unknown } | null)?.comments;
  if (!Array.isArray(raw)) return [];

  const comments: WikiComment[] = [];
  for (const item of raw as RawComment[]) {
    if (typeof item?.id !== "number") continue;
    comments.push({
      id: item.id,
      text: typeof item.text === "string" ? item.text : "",
      author: authorOf(item),
      createdDate: typeof item.createdDate === "string" ? item.createdDate : null,
      isDeleted: item.isDeleted === true,
      parentId: typeof item.parentId === "number" ? item.parentId : null,
    });
  }
  // `excludeDeleted` is asked for, but a tombstone still comes back on some server versions.
  return comments.filter((comment) => !comment.isDeleted).sort(byCreatedThenId);
}

function authorOf(item: RawComment): string {
  const created = item.createdBy;
  if (typeof created?.displayName === "string" && created.displayName.length > 0) {
    return created.displayName;
  }
  if (typeof created?.uniqueName === "string") return created.uniqueName;
  return "";
}

function byCreatedThenId(a: WikiComment, b: WikiComment): number {
  if (a.createdDate && b.createdDate && a.createdDate !== b.createdDate) {
    return a.createdDate < b.createdDate ? -1 : 1;
  }
  return a.id - b.id;
}

/**
 * The wiki path a page's decoded title path corresponds to — what the lookup takes.
 *
 * ADO wants the **decoded** title (`/Sample Pages/2. FAQ?`), not the encoded file name, because
 * the API speaks in page titles. `PageEntry.titlePath` is already that, minus the leading slash.
 */
export function wikiPathForLookup(titlePath: string): string {
  const trimmed = titlePath.replace(/^\/+/, "");
  return `/${trimmed}`;
}
