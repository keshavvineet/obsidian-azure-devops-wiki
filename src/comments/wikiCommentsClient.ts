import { requestUrl } from "obsidian";
import { basicAuthHeader } from "../workitems/adoClient";
import {
  addCommentUrl,
  commentsFrom,
  commentsUrl,
  isCommentsConfigured,
  pageIdFrom,
  pageLookupUrl,
  wikiPathForLookup,
  type WikiComment,
  type WikiCommentsConnection,
} from "./wikiComments";

/**
 * The network side of wiki page comments. URL building and response parsing live in the pure
 * module beside this; everything here is the call itself and the failure vocabulary.
 *
 * `requestUrl` rather than `fetch`, for the same reason as `adoClient`: it bypasses CORS from the
 * Electron renderer.
 *
 * Failures are **typed, not thrown**. A comments pane has four ordinary ways to be empty — no
 * token, a token that has expired, a page the portal does not know about yet (it has never been
 * published), and a network that is down — and each needs different words. Throwing would collapse
 * them into one "something went wrong" that tells nobody what to do.
 */
export type CommentsResult =
  | { ok: true; pageId: number; comments: WikiComment[] }
  | { ok: false; reason: "not-configured" | "unauthorized" | "no-such-page" | "failed"; detail?: string };

export type AddCommentResult =
  | { ok: true; comment: WikiComment | null }
  | { ok: false; reason: "unauthorized" | "failed"; detail?: string };

export class WikiCommentsClient {
  /** titlePath → page id. The id is stable for the life of a page and every read needs it. */
  private readonly pageIds = new Map<string, number>();

  constructor(private readonly connection: () => WikiCommentsConnection) {}

  /** A page that has been renamed or deleted must not answer from a stale id. */
  forgetPageIds(): void {
    this.pageIds.clear();
  }

  async list(titlePath: string): Promise<CommentsResult> {
    const connection = this.connection();
    if (!isCommentsConfigured(connection)) return { ok: false, reason: "not-configured" };

    const pageId = await this.pageIdFor(connection, titlePath);
    if (typeof pageId !== "number") return pageId;

    const response = await this.get(connection, commentsUrl(connection, pageId));
    if (!response.ok) return response;
    return { ok: true, pageId, comments: commentsFrom(response.body) };
  }

  async add(titlePath: string, text: string): Promise<AddCommentResult> {
    const connection = this.connection();
    if (!isCommentsConfigured(connection)) return { ok: false, reason: "failed" };

    const pageId = await this.pageIdFor(connection, titlePath);
    if (typeof pageId !== "number") {
      return { ok: false, reason: pageId.reason === "unauthorized" ? "unauthorized" : "failed" };
    }

    try {
      const response = await requestUrl({
        url: addCommentUrl(connection, pageId),
        method: "POST",
        headers: { ...this.headers(connection), "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        throw: false,
      });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, reason: "unauthorized" };
      }
      if (response.status >= 300) {
        return { ok: false, reason: "failed", detail: messageOf(response.json) };
      }
      // The posted comment comes back, but the pane re-reads the list anyway — one round trip
      // more, and it picks up anything somebody else added while this was being typed.
      return { ok: true, comment: commentsFrom({ comments: [response.json] })[0] ?? null };
    } catch (error) {
      return { ok: false, reason: "failed", detail: detailOf(error) };
    }
  }

  /** @returns the id, or the failure to hand straight back to the caller. */
  private async pageIdFor(
    connection: WikiCommentsConnection,
    titlePath: string,
  ): Promise<number | Extract<CommentsResult, { ok: false }>> {
    const cached = this.pageIds.get(titlePath);
    if (cached !== undefined) return cached;

    const response = await this.get(connection, pageLookupUrl(connection, wikiPathForLookup(titlePath)));
    if (!response.ok) return response;

    const id = pageIdFrom(response.body);
    if (id === null) return { ok: false, reason: "no-such-page" };
    this.pageIds.set(titlePath, id);
    return id;
  }

  private async get(
    connection: WikiCommentsConnection,
    url: string,
  ): Promise<{ ok: true; body: unknown } | Extract<CommentsResult, { ok: false }>> {
    try {
      const response = await requestUrl({
        url,
        method: "GET",
        headers: this.headers(connection),
        throw: false,
      });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, reason: "unauthorized" };
      }
      // 404 on the lookup means the page is not in the portal — usually because it has been
      // created here and not published yet, which is worth saying in those words.
      if (response.status === 404) return { ok: false, reason: "no-such-page" };
      if (response.status >= 300) {
        return { ok: false, reason: "failed", detail: messageOf(response.json) };
      }
      return { ok: true, body: response.json };
    } catch (error) {
      return { ok: false, reason: "failed", detail: detailOf(error) };
    }
  }

  private headers(connection: WikiCommentsConnection): Record<string, string> {
    return { Authorization: basicAuthHeader(connection.pat), Accept: "application/json" };
  }
}

/** Azure DevOps puts the useful part of an error in `message`; anything else is noise. */
function messageOf(body: unknown): string | undefined {
  const message = (body as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : undefined;
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
